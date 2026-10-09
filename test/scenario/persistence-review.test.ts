/**
 * Regression tests for review round 1 of the persistence layer (findings are
 * numbered as in that review).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { projectLedger } from "../../src/application/sqlite/projection.ts";
import { verifyDependencies } from "../../src/application/sqlite/restore.ts";
import {
	planAssertionTransition,
	type TransitionRequest,
} from "../../src/domains/assertions/index.ts";
import {
	getAssertion,
	listScopeAssertions,
} from "../../src/domains/assertions/sqlite.ts";
import { planMerge } from "../../src/domains/identity/index.ts";
import { getEntity } from "../../src/domains/identity/sqlite.ts";
import {
	beginForget,
	getGate,
	insertTombstone,
} from "../../src/domains/lifecycle/sqlite.ts";
import { getEpoch, readCurrent } from "../../src/domains/projection/sqlite.ts";
import {
	applyWorldOperation,
	readWorldSnapshot,
	type WorldDb,
} from "../../src/sqlite.ts";
import { failingDb } from "../support/failing-db.ts";
import { openTestStore, type TestStore } from "../support/sqlite-store.ts";
import {
	MARKER,
	count,
	forgetChunk,
	leaks,
	markedClaim,
	srcKey,
	srcState,
	states,
} from "./forget-fixture.ts";
import {
	A,
	NOW,
	access,
	adoptPlan,
	apply,
	claim,
	dump,
	envelope,
	hasher,
	hostChecks,
	openWorld,
} from "./world-fixture.ts";

const stores: TestStore[] = [];
afterEach(() => {
	for (const store of stores.splice(0)) store.close();
});
function world(): TestStore {
	const store = openWorld("file");
	stores.push(store);
	return store;
}
const run = (store: TestStore, input: unknown) =>
	store.write((db) => apply(db, input));
const register = (key: string, assertion: unknown, host = states()) =>
	envelope(
		key,
		{ kind: "assertion.register", assertion },
		{ hostChecks: host },
	);
const reopen = (store: TestStore, forgetId: string) =>
	run(
		store,
		envelope(
			`reopen-${forgetId}`,
			{ kind: "forget.reopen", forgetId, externalDeletionConfirmed: true },
			{ hostChecks: states() },
		),
	);
function plan(store: TestStore, id: string, request: TransitionRequest) {
	return store.read((db) => {
		const head = getAssertion(db, A, id)!;
		const planned = planAssertionTransition({
			contractVersion: 1,
			scope: A,
			current: {
				id,
				revision: head.revision,
				scope: A,
				lifecycle: head.lifecycle,
				origin: head.origin,
			},
			expectedRevision: head.revision,
			request,
			registeredAdoptionRules: [],
		});
		if (!planned.ok || planned.value.status !== "planned")
			throw new Error(`plan ${id}: ${JSON.stringify(planned)}`);
		return planned.value.plan;
	});
}
const transition = (key: string, p: unknown, host = states()) =>
	envelope(
		key,
		{ kind: "assertion.transition", plan: p },
		{ hostChecks: host },
	);

describe("1 forget merge chains of any depth", () => {
	test("e-3 into e-2 into e-1: forgetting the top completes in one go", () => {
		const store = world();
		for (const id of ["e-1", "e-2", "e-3"])
			expect(
				run(
					store,
					envelope(`reg-${id}`, {
						kind: "entity.register",
						entity: { id, displayName: id, aliases: [], externalRefs: [] },
					}),
				).status,
			).toBe("applied");
		const merge = (key: string, rep: string, ids: string[], rev: number[]) => {
			const merged = store.read((db) => {
				const planned = planMerge({
					scope: A,
					operationId: key,
					representativeId: rep,
					targetIds: ids,
					expectedRevisions: Object.fromEntries(
						ids.map((id, i) => [id, rev[i]!]),
					),
					evidence: ["ev"],
					entities: ids.map((id) => getEntity(db, A, id)!),
				});
				if (!planned.ok || planned.value.status !== "planned")
					throw new Error(JSON.stringify(planned));
				return planned.value.plan;
			});
			expect(
				run(store, envelope(key, { kind: "entity.merge", plan: merged }))
					.status,
			).toBe("applied");
		};
		merge("m-1", "e-2", ["e-2", "e-3"], [1, 1]);
		const e2 = store.read((db) => getEntity(db, A, "e-2")!.revision);
		merge("m-2", "e-1", ["e-1", "e-2"], [1, e2]);
		const result = run(
			store,
			forgetChunk("f-1", "fg-1", [{ kind: "entity", id: "e-1", revision: 1 }]),
		);
		expect(result).toMatchObject({
			status: "applied",
			forget: { state: "complete", pending: 0 },
		});
		expect(count(store, "world_entity")).toBe(0);
		expect(count(store, "world_tombstone")).toBe(3);
	});
});

describe("2 a dispute names stored targets; incremental equals rebuild", () => {
	test("dispute against a missing target is rejected before any DML", () => {
		const store = world();
		run(store, register("r1", markedClaim("c1", 1, [1], false)));
		run(store, transition("a1", adoptPlan("c1", 1)));
		const dispute = plan(store, "c1", {
			action: "dispute",
			contradicts: [{ id: "claim-X", revision: 1 }],
		});
		const before = dump(store);
		const counted = store.write((db) => {
			const probe = failingDb(db, 0);
			const result = apply(probe, transition("d1", dispute));
			return { result, dml: probe.dmlCount };
		});
		expect(counted.result).toEqual({
			status: "rejected",
			reasonCode: "CONTRADICTION_TARGET_NOT_FOUND",
		});
		expect(counted.dml).toBe(0);
		expect(dump(store)).toEqual(before);
	});

	test("seeded random sequence incl. dispute, retract and invalidate keeps the projection equal to a rebuild", () => {
		const store = world();
		let seed = 20261009;
		const rnd = (n: number) => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return seed % n;
		};
		const ids = Array.from({ length: 10 }, (_, i) => `c${i}`);
		ids.forEach((id, i) =>
			expect(
				run(
					store,
					register(`r-${id}`, markedClaim(id, 1 + (i % 3), [1], false)),
				).status,
			).toBe("applied"),
		);
		let invalidated = 0;
		let disputed = 0;
		let key = 0;
		for (let step = 0; step < 40; step++) {
			const id = ids[rnd(ids.length)]!;
			const head = store.read((db) => getAssertion(db, A, id)!);
			const k = `s-${key++}`;
			if (head.lifecycle === "candidate") {
				run(store, transition(k, plan(store, id, adoptReq(k))));
			} else if (head.lifecycle === "active") {
				const choice = rnd(3);
				if (choice === 0) {
					const other = ids.find((o) => o !== id)!;
					const target = store.read((db) => getAssertion(db, A, other)!);
					const applied = run(
						store,
						transition(
							k,
							plan(store, id, {
								action: "dispute",
								contradicts: [{ id: other, revision: target.revision }],
							}),
						),
					);
					if (applied.status === "applied") disputed++;
				} else if (choice === 1) {
					const applied = run(
						store,
						envelope(
							k,
							{
								kind: "invalidate",
								reasonCode: "INPUT_VERSION_INVALIDATED",
								targets: [{ id, expectedRevision: head.revision }],
							},
							{ hostChecks: states() },
						),
					);
					if (applied.status === "applied") invalidated++;
				}
			}
		}
		// The interesting branches really ran.
		expect(invalidated).toBeGreaterThan(0);
		expect(disputed).toBeGreaterThan(0);
		const incremental = store.read((db) => ({
			rows: db
				.query(
					"SELECT assertion_id, assertion_revision, payload_json FROM world_current WHERE principal = 'p-a' ORDER BY 1, 2",
				)
				.all(),
			epoch: getEpoch(db, A),
		}));
		const heads = store.read((db) => {
			const out: unknown[] = [];
			for (let after: string | undefined; ;) {
				const page = listScopeAssertions(db, A, {
					limit: 500,
					...(after ? { afterId: after } : {}),
				});
				out.push(...page.items);
				if (!page.truncated) break;
				after = page.items.at(-1)!.id;
			}
			return out;
		});
		const pure = projectLedger(heads as never, A, {
			hasher,
			clock: NOW,
			hostChecks: hostChecks(),
		} as never);
		expect(incremental.rows.length).toBe(pure.entries.length);
		const rebuilt = run(
			store,
			envelope("rebuild-1", { kind: "rebuild" }, { hostChecks: states() }),
		);
		expect(rebuilt.status).toBe("applied");
		const after = store.read((db) => ({
			rows: db
				.query(
					"SELECT assertion_id, assertion_revision, payload_json FROM world_current WHERE principal = 'p-a' ORDER BY 1, 2",
				)
				.all(),
			epoch: getEpoch(db, A),
		}));
		expect(after).toEqual(incremental);
	});
});
const adoptReq = (op: string): TransitionRequest => ({
	action: "adopt",
	adoption: { kind: "explicit", operationId: `adopt-${op}` },
	subjectConfirmedByHost: true,
});

describe("3 entity forget reaches mentions; tombstoned entities stay out", () => {
	function seed(store: TestStore) {
		for (const id of ["e-alice", "e-bob"])
			run(
				store,
				envelope(`ent-${id}`, {
					kind: "entity.register",
					entity: {
						id,
						displayName: id === "e-alice" ? MARKER : "bob",
						aliases: [],
						externalRefs: [],
					},
				}),
			);
		const rel = markedClaim("rel-1", 1, [1], false, {
			subjectId: "e-bob",
			payload: { kind: "relation", relation: "causes", objectId: "e-alice" },
		});
		expect(run(store, register("rel", rel)).status).toBe("applied");
		const ref = markedClaim("ref-1", 1, [1], false, {
			subjectId: "e-bob",
			predicate: "knows",
			payload: {
				kind: "value",
				value: { kind: "entity", entityId: "e-alice" },
			},
		});
		expect(run(store, register("ref", ref)).status).toBe("applied");
	}
	test("assertions naming the entity as object or entity-ref value go with it", () => {
		const store = world();
		seed(store);
		expect(count(store, "world_edge")).toBe(1);
		const gone = run(
			store,
			forgetChunk("f-1", "fg-1", [
				{ kind: "entity", id: "e-alice", revision: 1 },
			]),
		);
		expect(gone).toMatchObject({ forget: { state: "complete" } });
		expect(count(store, "world_assertion")).toBe(0);
		expect(count(store, "world_edge")).toBe(0);
		expect(leaks(store, MARKER)).toEqual([]);
	});
	test("after reopening, a late assertion about the forgotten entity is refused (subject and object)", () => {
		const store = world();
		seed(store);
		run(
			store,
			forgetChunk("f-1", "fg-1", [
				{ kind: "entity", id: "e-alice", revision: 1 },
			]),
		);
		expect(reopen(store, "fg-1").status).toBe("applied");
		const asSubject = markedClaim("late-1", 1, [1], false, {
			subjectId: "e-alice",
		});
		expect(run(store, register("late-1", asSubject))).toEqual({
			status: "rejected",
			reasonCode: "TOMBSTONED",
		});
		const asObject = markedClaim("late-2", 1, [1], false, {
			subjectId: "e-bob",
			payload: { kind: "relation", relation: "causes", objectId: "e-alice" },
		});
		expect(run(store, register("late-2", asObject))).toEqual({
			status: "rejected",
			reasonCode: "TOMBSTONED",
		});
	});
	test("a snapshot never returns an assertion that names a tombstoned entity", () => {
		const store = world();
		run(
			store,
			register("c", markedClaim("c1", 1, [1], false, { subjectId: "e-z" })),
		);
		store.write((db) =>
			insertTombstone(db, A, {
				kind: "entity",
				id: "e-z",
				forgetId: "fg-x",
				reasonCode: "FORGET_REQUESTED",
			}),
		);
		const result = store.read((db) =>
			readWorldSnapshot(db, {
				contractVersion: 1,
				access: access(),
				scope: A,
				asOf: NOW,
				hostChecks: hostChecks(),
			}),
		);
		expect(result).toEqual({ status: "blocked", reasonCode: "TOMBSTONED" });
	});
});

describe("4 a retraction's reason source is a recorded dependency", () => {
	const reasonRef = () => srcRefOf(2);
	test("the reason source is guarded, recorded, and reached by a source forget", () => {
		const store = world();
		run(store, register("r1", markedClaim("c1", 1, [1], true)));
		const retract = plan(store, "c1", {
			action: "retract",
			reasonSource: reasonRef(),
		});
		// src-2 unknown to the host: the guard refuses (indistinguishable code).
		expect(
			run(store, transition("t0", retract, hostChecks([srcState(1)]))),
		).toEqual({ status: "rejected", reasonCode: "SOURCE_NOT_AVAILABLE" });
		expect(run(store, transition("t1", retract)).status).toBe("applied");
		const inputs = store.read((db) =>
			db
				.query(
					"SELECT source_key FROM world_assertion_input WHERE assertion_id = 'c1' AND assertion_revision = 2",
				)
				.all()
				.map((row) => (row as { source_key: string }).source_key),
		);
		expect(inputs).toContain(srcKey(2));
		const gone = run(
			store,
			forgetChunk("f-1", "fg-1", [
				{ kind: "source", id: srcKey(2), revision: 1 },
			]),
		);
		expect(gone).toMatchObject({ forget: { state: "complete" } });
		expect(count(store, "world_assertion")).toBe(0);
		expect(leaks(store, MARKER)).toEqual([]);
	});
	test("a tombstoned reason source blocks a later retraction", () => {
		const store = world();
		run(store, register("r1", markedClaim("c1", 1, [1], false)));
		store.write((db) =>
			insertTombstone(db, A, {
				kind: "source",
				id: srcKey(2),
				forgetId: "fg-x",
				reasonCode: "SOURCE_FORGOTTEN",
			}),
		);
		const retract = plan(store, "c1", {
			action: "retract",
			reasonSource: reasonRef(),
		});
		expect(run(store, transition("t1", retract))).toEqual({
			status: "rejected",
			reasonCode: "TOMBSTONED",
		});
	});
});
function srcRefOf(n: number) {
	const s = srcState(n);
	return {
		namespace: s.namespace as string,
		kind: s.kind as string,
		id: s.id as string,
		revision: s.revision as string,
		digest: s.digest as string,
	};
}

describe("5 restore verification is not capped at 16,000 dependencies", () => {
	test("17,003 distinct dependencies are verified (and a lowered ceiling reports too large)", () => {
		const store = world();
		run(store, register("r1", markedClaim("c1", 1, [1, 2, 3], false)));
		store.write((db) => {
			db.query(
				`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 17000)
				 INSERT INTO world_assertion_input (principal, scope_key, assertion_id, assertion_revision, source_key, source_revision)
				 SELECT 'p-a', 'scope-a', 'c1', 1, 'bulk-' || i, 'rev-1' FROM n`,
			).run();
		});
		const context = { hasher, clock: NOW, hostChecks: states() } as never;
		const started = performance.now();
		const verdict = store.read((db) => verifyDependencies(db, A, context));
		expect(verdict).toEqual({ unaccounted: 17003, tooLarge: false });
		expect(performance.now() - started).toBeLessThan(10_000);
		expect(
			store.read((db) => verifyDependencies(db, A, context, 1000)),
		).toEqual(expect.objectContaining({ tooLarge: true }));
	});
});

describe("6 forget.reopen", () => {
	const op = (key: string, forgetId: string, confirmed = true) =>
		envelope(
			key,
			{
				kind: "forget.reopen",
				forgetId,
				externalDeletionConfirmed: confirmed,
			},
			{ hostChecks: states() },
		);
	function forgotten(store: TestStore) {
		run(store, register("r1", markedClaim("c1", 1, [1], false)));
		return run(
			store,
			forgetChunk("f-1", "fg-1", [
				{ kind: "source", id: srcKey(1), revision: 1 },
			]),
		);
	}
	test("preconditions, then reopen, then idempotent replay", () => {
		const store = world();
		forgotten(store);
		expect(run(store, op("o0", "no-such"))).toEqual({
			status: "rejected",
			reasonCode: "FORGET_NOT_FOUND",
		});
		expect(run(store, op("o1", "fg-1", false))).toEqual({
			status: "blocked",
			reasonCode: "EXTERNAL_DELETION_UNCONFIRMED",
		});
		expect(store.read((db) => getGate(db, A))?.state).toBe("closed");
		const opened = run(store, op("o2", "fg-1"));
		expect(opened.status).toBe("applied");
		expect(store.read((db) => getGate(db, A))?.state).toBe("open");
		expect(run(store, op("o2", "fg-1")).status).toBe("no_op");
	});
	test("a pending forget cannot be reopened", () => {
		const store = world();
		store.write((db) => {
			beginForget(db, A, {
				forgetId: "fg-p",
				reasonCode: "FORGET_REQUESTED",
			});
		});
		expect(run(store, op("o1", "fg-p"))).toEqual({
			status: "blocked",
			reasonCode: "FORGET_NOT_COMPLETE",
		});
	});
	test("a gate held by a restore is not reopened through forget.reopen", () => {
		const store = world();
		forgotten(store);
		const begun = store.write((db) =>
			apply(
				db,
				envelope(
					"rb",
					{ kind: "restore.begin" },
					{
						hostChecks: { ...states(), restoreEpoch: "r2" },
					},
				),
			),
		);
		expect(begun.status).toBe("applied");
		const refused = store.write((db) =>
			apply(
				db,
				envelope(
					"o1",
					{
						kind: "forget.reopen",
						forgetId: "fg-1",
						externalDeletionConfirmed: true,
					},
					{ hostChecks: { ...states(), restoreEpoch: "r2" } },
				),
			),
		);
		expect(refused).toEqual({
			status: "blocked",
			reasonCode: "GATE_HELD_BY_OTHER_PROCEDURE",
		});
	});
});

describe("9 refusals perform zero DML", () => {
	function dmlOf(store: TestStore, input: unknown) {
		return store.write((db) => {
			const probe = failingDb(db, 0);
			const result = apply(probe, input);
			return { result, dml: probe.dmlCount };
		});
	}
	test("representative rejected / blocked results touched nothing", () => {
		const store = world();
		run(store, register("r1", markedClaim("c1", 1, [1], false)));
		run(store, transition("a1", adoptPlan("c1", 1)));
		const before = dump(store);
		const cases: [string, unknown, string][] = [
			[
				"scope mismatch",
				register(
					"x1",
					claim({ id: "c9", scope: { principal: "p-a", scopeKey: "scope-b" } }),
				),
				"SCOPE_MISMATCH",
			],
			[
				"revision conflict",
				register("x2", markedClaim("c1", 1, [1], false)),
				"REVISION_CONFLICT",
			],
			[
				"key conflict",
				register("r1", markedClaim("c1", 1, [1], true)),
				"OPERATION_KEY_CONFLICT",
			],
			[
				"missing dispute target",
				transition(
					"x4",
					plan(store, "c1", {
						action: "dispute",
						contradicts: [{ id: "none", revision: 1 }],
					}),
				),
				"CONTRADICTION_TARGET_NOT_FOUND",
			],
			[
				"reopen of unknown forget",
				envelope(
					"x5",
					{
						kind: "forget.reopen",
						forgetId: "n",
						externalDeletionConfirmed: true,
					},
					{ hostChecks: states() },
				),
				"FORGET_NOT_FOUND",
			],
			["empty forget", forgetChunk("x6", "fg-9", []), "INVALID_INPUT"],
			[
				"closed gate (host)",
				register("x7", markedClaim("c2", 1, [1], false), {
					...states(),
					gate: "closed",
				} as never),
				"GATE_CLOSED",
			],
		];
		for (const [label, input, reason] of cases) {
			const { result, dml } = dmlOf(store, input);
			expect({
				label,
				reason: (result as { reasonCode?: string }).reasonCode,
			}).toEqual({ label, reason });
			expect({ label, dml }).toEqual({ label, dml: 0 });
		}
		expect(dump(store)).toEqual(before);
	});
});

describe("12 schema gate without any migration", () => {
	test("blocked SCHEMA_INCOMPATIBLE instead of a raw SQLite error", () => {
		const store = openTestStore({ migrations: [] });
		try {
			expect(
				store.write((db) => applyWorldOperation(db, {}, { hasher })),
			).toEqual({ status: "blocked", reasonCode: "SCHEMA_INCOMPATIBLE" });
			expect(store.read((db) => readWorldSnapshot(db as WorldDb, {}))).toEqual({
				status: "blocked",
				reasonCode: "SCHEMA_INCOMPATIBLE",
			});
		} finally {
			store.close();
		}
	});
});

// keep imports used by type-only paths honest
void readCurrent;
