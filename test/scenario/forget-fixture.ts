import { sourceIdentityKey } from "../../src/domains/assertions/index.ts";
import {
	insertAssertion,
	insertEvidence,
	insertInputs,
} from "../../src/domains/assertions/sqlite.ts";
import {
	insertPrediction,
	insertOutcome,
} from "../../src/domains/scenarios/sqlite.ts";
import type { WorldDb } from "../../src/sqlite.ts";
import type { TestStore } from "../support/sqlite-store.ts";
import {
	A,
	apply,
	claim,
	envelope,
	hostChecks,
	ref,
	state,
} from "./world-fixture.ts";

/** Unique body text planted in every payload kind; never used as an ID. */
export const MARKER = "機密マーカーZX9-forget";

export const src = (n: number) => ref({ id: `src-${n}` });
export const srcKey = (n: number) => sourceIdentityKey(src(n));
export const srcState = (n: number) => state({ id: `src-${n}` });
export const states = (count = 3) =>
	hostChecks(Array.from({ length: count }, (_, i) => srcState(i + 1)));

/** A claim cites `cited`, reads `inputs`; its body is MARKER only if `leaky`. */
export const markedClaim = (
	id: string,
	cited: number,
	inputs: number[] = [cited],
	leaky = true,
	extra: Record<string, unknown> = {},
) =>
	claim({
		id,
		subjectId: "svc-1",
		predicate: `p-${id}`,
		payload: {
			kind: "value",
			value: { kind: "string", value: leaky ? MARKER : `keep-${id}` },
		},
		evidence: [
			{
				evidenceId: `ev-${id}`,
				kind: "user_statement",
				stance: "supports",
				source: src(cited),
				rootEvidenceId: `root-${id}`,
			},
		],
		inputManifest: inputs.map(src),
		rootEvidenceIds: [`root-${id}`],
		...extra,
	});

export const forgetChunk = (
	key: string,
	forgetId: string,
	roots: unknown[],
	over: Record<string, unknown> = {},
	reasonCode = "FORGET_REQUESTED",
) =>
	envelope(
		key,
		{ kind: "forget.chunk", forgetId, reasonCode, roots },
		{ hostChecks: states(), ...over },
	);
export const sourceRoot = (n: number) => ({
	kind: "source",
	id: srcKey(n),
	revision: 1,
});

export const quantPrediction = (id: string, comparison: string) => ({
	kind: "quantitative",
	predictionId: id,
	revision: 1,
	comparisonId: comparison,
	conditions: {
		subjectId: "svc-1",
		metric: "latency",
		unit: "ms",
		statistic: "p95",
		configuration: "cfg-1",
		inputProfile: "in-1",
	},
	baselineRef: "base-1",
	baselineValue: 100,
	expectedWindow: { startMs: 1000, endMs: 2000 },
	expectedDirection: "decreases",
	measurementTolerance: 2,
	origin: "runtime_observation",
});
export const outcomeFor = (id: string, comparison: string) => ({
	kind: "outcome",
	outcomeId: id,
	revision: 1,
	comparisonId: comparison,
	predictionRevision: 1,
	conditions: quantPrediction("x", comparison).conditions,
	baselineRef: "base-1",
	window: { startMs: 1000, endMs: 2000 },
	value: 90,
});

/** Test-host seeding straight through the domain repositories (bulk setup). */
export function seedAssertion(
	db: WorldDb,
	assertion: ReturnType<typeof markedClaim>,
	prediction = false,
): void {
	const id = assertion.id;
	if (insertAssertion(db, assertion).status === "rejected")
		throw new Error(`seed assertion ${id}`);
	const at = { id, revision: assertion.revision };
	insertEvidence(db, A, at, assertion.evidence);
	insertInputs(db, A, at, assertion.inputManifest);
	if (prediction) {
		const p = quantPrediction(`pred-${id}`, `cmp-${id}`);
		insertPrediction(db, A, {
			prediction: p as never,
			dueAt: 5000,
			basis: { assertionId: id, revision: 1 },
		});
	}
}
export { insertOutcome };

export const TEXT_TABLES = (store: TestStore): string[] =>
	store.read((db) =>
		(
			db
				.query(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'world_%' ORDER BY name",
				)
				.all() as { name: string }[]
		).map((row) => row.name),
	);

/** Every TEXT/BLOB column of every world_ table that contains `needle`. */
export function leaks(store: TestStore, needle: string): string[] {
	const found: string[] = [];
	store.read((db) => {
		for (const table of TEXT_TABLES(store)) {
			const columns = db.query(`PRAGMA table_info(${table})`).all() as {
				name: string;
				type: string;
			}[];
			for (const column of columns) {
				if (!["TEXT", "BLOB"].includes(column.type.toUpperCase())) continue;
				const hit = db
					.query(
						`SELECT count(*) AS n FROM ${table} WHERE CAST(${column.name} AS TEXT) LIKE ?`,
					)
					.get(`%${needle}%`) as { n: number };
				if (hit.n > 0) found.push(`${table}.${column.name}`);
			}
		}
	});
	return found;
}
export const count = (store: TestStore, table: string): number =>
	store.read(
		(db) =>
			(db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n,
	);
export { apply };
