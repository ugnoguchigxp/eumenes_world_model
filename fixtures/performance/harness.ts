import { createHash } from "node:crypto";
import { rebuildProjection } from "../../src/application/sqlite/projection.ts";
import {
	applyWorldOperation,
	readWorldSnapshot,
} from "../../src/application/sqlite/index.ts";
import type { CanonicalHasher } from "../../src/contracts/index.ts";
import {
	getAssertion,
	getHead,
	insertAssertion,
	insertEvidence,
	insertInputs,
	listAssertionsBySourceKeys,
	listBySubject,
	listScopeAssertions,
} from "../../src/domains/assertions/sqlite.ts";
import { listManifestsBySourceKeys } from "../../src/domains/extraction/sqlite.ts";
import {
	getEpoch,
	readCurrent,
	readEdgesFrom,
	readEdgesTo,
} from "../../src/domains/projection/sqlite.ts";
import { listPredictionsByBasisAssertion } from "../../src/domains/scenarios/sqlite.ts";
import { buildWorldSlice } from "../../src/domains/projection/index.ts";
import type { WorldDb } from "../../src/infrastructure/sqlite/db.ts";
import type { TestStore } from "../../test/support/sqlite-store.ts";
import {
	PERF_NOW,
	PERF_SCOPE,
	claimAt,
	sourceStates,
	type GenOptions,
} from "./generator.ts";

export const hasher: CanonicalHasher = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");

export const access = {
	principal: PERF_SCOPE.principal,
	scopeKeys: [PERF_SCOPE.scopeKey],
	purpose: "world",
	policyRevision: "pol-1",
};
export const hostChecks = (sources = 50) => ({
	sourceSnapshot: { states: sourceStates(sources) },
	forgetEpoch: "f1",
	restoreEpoch: "r1",
	policyRevision: "pol-1",
});
export const context = (sources = 50) =>
	({ hasher, clock: PERF_NOW, hostChecks: hostChecks(sources) }) as never;

export interface SeedTimings {
	readonly generateAndInsertMs: number;
	readonly rebuildMs: number;
}

/**
 * Loads a synthetic ledger through the repository ports (not through
 * applyWorldOperation), then runs ONE full paged projection rebuild. Timed
 * apart from every query measurement.
 */
export function seedWorld(
	store: TestStore,
	options: GenOptions,
	chunk = 5000,
): SeedTimings {
	const t0 = performance.now();
	for (let from = 0; from < options.claims; from += chunk)
		store.write((db) => {
			const to = Math.min(options.claims, from + chunk);
			for (let i = from; i < to; i++) {
				const claim = claimAt(i, options);
				const first = insertAssertion(db, claim as never);
				if (first.status === "rejected")
					throw new Error(`seed rejected ${first.reasonCode}`);
				const ref = { id: claim.id, revision: 1 };
				insertEvidence(db, PERF_SCOPE, ref, claim.evidence as never);
				insertInputs(db, PERF_SCOPE, ref, claim.inputManifest as never);
			}
		});
	const t1 = performance.now();
	store.write((db) => rebuildProjection(db, PERF_SCOPE, context()));
	const t2 = performance.now();
	return { generateAndInsertMs: t1 - t0, rebuildMs: t2 - t1 };
}

export interface SliceRun {
	readonly status: string;
	readonly fetchedRows: number;
	readonly expandedRows: number;
	readonly partial: boolean;
	readonly outputBytes: number;
	readonly units: number;
}

/** One representative Slice read: bounded snapshot on the readonly reader + pure Slice. */
export function sliceOnce(
	store: TestStore,
	focus: readonly string[],
	extra: {
		depth?: number;
		budget?: { candidates: number; expansions: number };
		db?: (db: WorldDb) => WorldDb;
	} = {},
): SliceRun {
	return store.read((rawDb) => {
		const db = extra.db ? extra.db(rawDb) : rawDb;
		const read = readWorldSnapshot(db, {
			contractVersion: 1,
			access,
			scope: PERF_SCOPE,
			asOf: PERF_NOW,
			hostChecks: hostChecks(),
			focus: { subjectIds: [...focus], depth: extra.depth ?? 2 },
			...(extra.budget ? { budget: extra.budget } : {}),
		});
		if (read.status !== "ready") throw new Error(`read ${read.reasonCode}`);
		const slice = buildWorldSlice(
			{ contractVersion: 1, snapshot: read.snapshot, request: {} },
			hasher,
		);
		if (!slice.ok) throw new Error(`slice ${slice.code}`);
		const value = slice.value as unknown as {
			status: string;
			units?: unknown[];
		};
		return {
			status: value.status,
			fetchedRows: read.coverage.fetchedRows,
			expandedRows: read.coverage.expandedRows,
			partial: read.coverage.partial,
			outputBytes: new TextEncoder().encode(JSON.stringify(value.units ?? []))
				.length,
			units: value.units?.length ?? 0,
		};
	});
}

let writeCounter = 0;
/** One ordinary single-operation write: register a new candidate claim. */
export function writeOnce(
	store: TestStore,
	options: GenOptions,
	wrap: (db: WorldDb) => WorldDb = (db) => db,
): { status: string } {
	const index = options.claims + writeCounter++;
	const claim = claimAt(index, options);
	return store.write((rawDb) => {
		const result = applyWorldOperation(
			wrap(rawDb),
			{
				contractVersion: 1,
				access,
				scope: PERF_SCOPE,
				operationKey: `bench-op-${index}`,
				clock: PERF_NOW,
				hostChecks: hostChecks(),
				operation: { kind: "assertion.register", assertion: claim },
			},
			{ hasher },
		);
		if (result.status !== "applied")
			throw new Error(`write ${JSON.stringify(result)}`);
		return { status: result.status };
	});
}

/**
 * Index checks run the REPOSITORIES' real queries: every statement a real
 * function issues is captured (SQL + bound params) and explained as issued, so
 * a regression in the repository SQL fails the check. `requires` must appear
 * in at least one plan of the case; every table access must use an index.
 */
type Params = readonly unknown[];
interface Captured {
	readonly sql: string;
	readonly params: Params;
}
function capturing(inner: WorldDb): { db: WorldDb; seen: Captured[] } {
	const seen: Captured[] = [];
	const db: WorldDb = {
		get inTransaction() {
			return inner.inTransaction;
		},
		exec: (sql) => inner.exec(sql),
		query(sql) {
			const statement = inner.query(sql);
			const record = (params: Params) => seen.push({ sql, params });
			return {
				all: (...params) => (record(params), statement.all(...params)),
				get: (...params) => (record(params), statement.get(...params)),
				run: (...params) => (record(params), statement.run(...params)),
			};
		},
	};
	return { db, seen };
}

export const planCases: readonly {
	readonly name: string;
	readonly requires: string;
	readonly call: (db: WorldDb) => unknown;
}[] = [
	{
		name: "current by subject (readCurrent)",
		requires: "subject_id=?",
		call: (db) =>
			readCurrent(db, PERF_SCOPE, { subjectIds: ["s-1", "s-2"], limit: 10 }),
	},
	{
		name: "edges from (readEdgesFrom)",
		requires: "from_id=?",
		call: (db) => readEdgesFrom(db, PERF_SCOPE, ["s-1", "s-2"], 10),
	},
	{
		name: "edges to (readEdgesTo)",
		requires: "to_id=?",
		call: (db) => readEdgesTo(db, PERF_SCOPE, ["s-1", "s-2"], 10),
	},
	{
		name: "assertion head (getHead)",
		requires: "id=?",
		call: (db) => getHead(db, PERF_SCOPE, "c-1"),
	},
	{
		name: "assertion by version (getAssertion)",
		requires: "revision=?",
		call: (db) => getAssertion(db, PERF_SCOPE, "c-1", 1),
	},
	{
		name: "assertions by subject (listBySubject)",
		requires: "subject_id=?",
		call: (db) => listBySubject(db, PERF_SCOPE, "s-1", { limit: 10 }),
	},
	{
		name: "reverse lookup by source (inputs + evidence)",
		requires: "source_key=?",
		call: (db) =>
			listAssertionsBySourceKeys(db, PERF_SCOPE, ["k-1", "k-2"], 10),
	},
	{
		name: "manifest dependencies by source",
		requires: "source_key=?",
		call: (db) => listManifestsBySourceKeys(db, PERF_SCOPE, ["k-1"], 10),
	},
	{
		name: "scope epoch (getEpoch)",
		requires: "scope_key=?",
		call: (db) => getEpoch(db, PERF_SCOPE),
	},
	{
		name: "scope assertion page (listScopeAssertions)",
		requires: "id>?",
		call: (db) =>
			listScopeAssertions(db, PERF_SCOPE, { afterId: "c-1", limit: 500 }),
	},
	{
		name: "predictions by basis assertion",
		requires: "basis_assertion_id=?",
		call: (db) => listPredictionsByBasisAssertion(db, PERF_SCOPE, "c-1", 10),
	},
];

/** Plans of the statements a real repository call issues. */
export function realPlans(
	db: WorldDb,
): Record<string, { plan: string[]; indexed: boolean; statements: number }> {
	return Object.fromEntries(
		planCases.map((planCase) => {
			const { db: spy, seen } = capturing(db);
			planCase.call(spy);
			const plans = seen.map((entry) => explainAs(db, entry));
			const all = plans.flat();
			const indexed =
				seen.length > 0 &&
				plans.every((plan) => usesIndex(plan)) &&
				all.some((line) => line.includes(planCase.requires));
			return [planCase.name, { plan: all, indexed, statements: seen.length }];
		}),
	);
}
function explainAs(db: WorldDb, entry: Captured): string[] {
	return (
		db
			.query(`EXPLAIN QUERY PLAN ${entry.sql}`)
			.all(...(entry.params as never[])) as { detail: string }[]
	).map((row) => row.detail);
}

/** True when every table access in the plan goes through an index or the primary key. */
export function usesIndex(plan: readonly string[], requires = ""): boolean {
	const accesses = plan.filter((line) => /^(SEARCH|SCAN) /.test(line));
	return (
		accesses.length > 0 &&
		plan.some((line) => line.includes(requires)) &&
		accesses.every(
			(line) =>
				line.startsWith("SEARCH") ||
				/USING (COVERING )?INDEX/.test(line) ||
				/AUTOINDEX/.test(line),
		)
	);
}
