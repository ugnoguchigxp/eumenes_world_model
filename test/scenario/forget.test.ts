import { describe, expect, test } from "bun:test";
import {
	getForget,
	getTombstone,
	isGateOpen,
} from "../../src/domains/lifecycle/sqlite.ts";
import { getEpoch, readCurrent } from "../../src/domains/projection/sqlite.ts";
import { getAssertion } from "../../src/domains/assertions/sqlite.ts";
import {
	WorldTransactionRequiredError,
	readWorldSnapshot,
	type WorldDb,
} from "../../src/sqlite.ts";
import { failingDb, InjectedFailure } from "../support/failing-db.ts";
import { dump } from "./world-fixture.ts";
import type { TestStore } from "../support/sqlite-store.ts";
import {
	MARKER,
	count,
	forgetChunk,
	leaks,
	markedClaim,
	outcomeFor,
	quantPrediction,
	seedAssertion,
	sourceRoot,
	src,
	srcKey,
	states,
} from "./forget-fixture.ts";
import {
	A,
	access,
	apply,
	claim,
	envelope,
	hostChecks,
	openWorld,
} from "./world-fixture.ts";

const feed = {
	scopeKeys: ["scope-a", "scope-b"],
	kind: "conversation",
	cursorRestoreEpoch: "r1",
};
const register = (key: string, assertion: unknown) =>
	envelope(
		key,
		{ kind: "assertion.register", assertion },
		{ hostChecks: states() },
	);
const receive = (key: string, eventId: string, seq: number, text: string) =>
	envelope(
		key,
		{
			kind: "inbox.receive",
			feed,
			event: { eventId, seq, payload: { text } },
			receivedCursor: `c-${seq}`,
		},
		{ hostChecks: states() },
	);
const settle = (key: string, eventId: string, over: Record<string, unknown>) =>
	envelope(
		key,
		{
			kind: "candidate.settle",
			feed,
			eventId,
			disposition: "applied",
			manifest: {
				manifestId: `m-${eventId}`,
				dependencies: [src(1), src(2), src(3)],
			},
			assertions: [markedClaim(`c-${eventId}`, 1)],
			appliedCursor: `a-${eventId}`,
			...over,
		},
		{ hostChecks: states() },
	);

/**
 * claim-1 (src-1, keeps), claim-2 (cites src-1, also READS uncited src-2),
 * claim-3 (src-3, unrelated), a prediction + outcome on claim-1, and a
 * settled event e-1 whose manifest saw src-1..3 and produced candidate c-e-1.
 */
function seed(store: TestStore) {
	store.write((db) => {
		const ok = (r: { status: string }) => expect(r.status).toBe("applied");
		ok(apply(db, register("s-1", markedClaim("claim-1", 1, [1], false))));
		ok(apply(db, register("s-2", markedClaim("claim-2", 1, [1, 2], true))));
		ok(apply(db, register("s-3", markedClaim("claim-3", 3, [3], false))));
		ok(
			apply(
				db,
				envelope(
					"s-4",
					{
						kind: "prediction.register",
						input: {
							prediction: quantPrediction("pred-1", "cmp-1"),
							dueAt: 5000,
							basis: { assertionId: "claim-1", revision: 1 },
						},
					},
					{ hostChecks: states() },
				),
			),
		);
		ok(
			apply(
				db,
				envelope(
					"s-5",
					{
						kind: "outcome.register",
						input: {
							predictionId: "pred-1",
							outcome: outcomeFor("out-1", "cmp-1"),
						},
					},
					{ hostChecks: states() },
				),
			),
		);
		ok(apply(db, receive("s-6", "e-1", 100, MARKER)));
		ok(apply(db, settle("s-7", "e-1", {})));
	});
}
const heads = (store: TestStore) =>
	store.read((db) =>
		(
			db.query("SELECT id FROM world_assertion_head ORDER BY id").all() as {
				id: string;
			}[]
		).map((row) => row.id),
	);
const run = (store: TestStore, input: unknown) =>
	store.write((db) => apply(db, input));

describe("A11/A31 forgetting a source", () => {
	test("an UNCITED input source removes everything derived from what the model saw", () => {
		const store = openWorld();
		try {
			seed(store);
			expect(leaks(store, MARKER).length).toBeGreaterThan(0);
			const epoch = store.read((db) => getEpoch(db, A)?.epoch);
			const result = run(
				store,
				forgetChunk("f-1", "forget-1", [sourceRoot(2)]),
			);
			expect(result).toMatchObject({
				status: "applied",
				forget: { state: "complete", pending: 0 },
			});
			// claim-2 read src-2; c-e-1 and the manifest saw it; e-1 fed them.
			expect(heads(store)).toEqual(["claim-1", "claim-3"]);
			expect(count(store, "world_input_manifest")).toBe(0);
			expect(count(store, "world_manifest_dependency")).toBe(0);
			expect(count(store, "world_inbox")).toBe(0);
			// claim-1 / claim-3 and the prediction on claim-1 do not read src-2.
			expect(count(store, "world_prediction")).toBe(1);
			expect(leaks(store, MARKER)).toEqual([]);
			expect(store.read((db) => getEpoch(db, A)?.epoch)).toBeGreaterThan(
				epoch!,
			);
			// Minimal metadata only.
			store.read((db) => {
				expect(getTombstone(db, A, { kind: "source", id: srcKey(2) })).toEqual({
					kind: "source",
					id: srcKey(2),
					forgetId: "forget-1",
					reasonCode: "FORGET_REQUESTED",
				});
				expect(getForget(db, A, "forget-1")).toMatchObject({
					state: "complete",
					reasonCode: "FORGET_REQUESTED",
				});
				// Gate stays closed until the host reopens via restore/rebuild.
				expect(isGateOpen(db, A)).toBe(false);
			});
			const tombstoneColumns = store.read((db) =>
				(
					db.query("PRAGMA table_info(world_tombstone)").all() as {
						name: string;
					}[]
				).map((c) => c.name),
			);
			expect(tombstoneColumns).toEqual([
				"principal",
				"scope_key",
				"kind",
				"id",
				"forget_id",
				"reason_code",
			]);
		} finally {
			store.close();
		}
	});

	test("a CITED source takes the prediction and outcome with it; unrelated claims stay", () => {
		const store = openWorld();
		try {
			seed(store);
			const result = run(
				store,
				forgetChunk("f-1", "forget-1", [sourceRoot(1)]),
			);
			expect(result).toMatchObject({ forget: { state: "complete" } });
			expect(heads(store)).toEqual(["claim-3"]);
			expect(count(store, "world_prediction")).toBe(0);
			expect(count(store, "world_outcome")).toBe(0);
			expect(count(store, "world_evidence")).toBe(1);
			store.read((db) => {
				expect(readCurrent(db, A, { limit: 10 }).rows.length).toBe(1);
				expect(getAssertion(db, A, "claim-1")).toBeUndefined();
				for (const kind of ["assertion", "prediction"] as const)
					expect(
						getTombstone(db, A, {
							kind,
							id: kind === "assertion" ? "claim-1" : "pred-1",
						}),
					).toBeDefined();
			});
			expect(leaks(store, MARKER)).toEqual([]);
		} finally {
			store.close();
		}
	});

	test("A31 a late candidate / registration for the forgotten source is refused, bodies are gone", () => {
		const store = openWorld();
		try {
			seed(store);
			run(store, forgetChunk("f-1", "forget-1", [sourceRoot(1)]));
			// Gate is closed while the Scope is unpublished.
			expect(
				run(store, register("late-1", markedClaim("late", 1, [1], true))),
			).toEqual({ status: "blocked", reasonCode: "GATE_CLOSED" });
			// Even once the host reopens the Scope, the tombstone refuses it.
			expect(
				run(
					store,
					envelope(
						"reopen-1",
						{
							kind: "forget.reopen",
							forgetId: "forget-1",
							externalDeletionConfirmed: true,
						},
						{ hostChecks: states() },
					),
				).status,
			).toBe("applied");
			const late = run(
				store,
				register("late-2", markedClaim("late", 1, [1], true)),
			);
			expect(late).toEqual({ status: "rejected", reasonCode: "TOMBSTONED" });
			expect(JSON.stringify(late)).not.toContain(MARKER);
			expect(
				run(store, receive("late-3", "e-9", 109, "x")).status,
			).toBeDefined();
			const settled = run(
				store,
				settle("late-4", "e-9", { assertions: [markedClaim("late", 1, [1])] }),
			);
			expect(settled).toMatchObject({ status: "rejected" });
			// Public reads show no body and no forgotten claim.
			const snapshot = store.read((db) =>
				readWorldSnapshot(db, {
					contractVersion: 1,
					access: access(),
					scope: A,
					asOf: 1791500000000,
					hostChecks: hostChecks(),
				}),
			);
			expect(JSON.stringify(snapshot)).not.toContain(MARKER);
			expect(leaks(store, MARKER)).toEqual([]);
			expect(count(store, "world_assertion")).toBe(1);
		} finally {
			store.close();
		}
	});

	test("an entity root removes the entity, its aliases and the claims about it", () => {
		const store = openWorld();
		try {
			store.write((db) => {
				expect(
					apply(
						db,
						envelope("e-0", {
							kind: "entity.register",
							entity: {
								id: "svc-1",
								displayName: MARKER,
								aliases: [`${MARKER}別名`],
								externalRefs: [],
							},
						}),
					).status,
				).toBe("applied");
				expect(
					apply(db, register("e-1", markedClaim("claim-1", 1, [1], true)))
						.status,
				).toBe("applied");
				expect(
					apply(db, register("e-2", markedClaim("claim-3", 3, [3], false)))
						.status,
				).toBe("applied");
			});
			const result = run(
				store,
				forgetChunk("f-1", "forget-e", [
					{ kind: "entity", id: "svc-1", revision: 1 },
				]),
			);
			expect(result).toMatchObject({ forget: { state: "complete" } });
			// Both claims have subject svc-1.
			expect(heads(store)).toEqual([]);
			expect(count(store, "world_entity")).toBe(0);
			expect(count(store, "world_alias")).toBe(0);
			expect(leaks(store, MARKER)).toEqual([]);
		} finally {
			store.close();
		}
	});
});

describe("A29 forget does not wait for anything", () => {
	test("a held inbox event, World OFF (gate flag), a model-less host and a changed policy do not block it", () => {
		const store = openWorld();
		try {
			seed(store);
			run(store, receive("h-1", "e-held", 105, MARKER));
			run(
				store,
				envelope(
					"h-2",
					{
						kind: "candidate.settle",
						feed,
						eventId: "e-held",
						disposition: "held",
						assertions: [],
					},
					{ hostChecks: states() },
				),
			);
			expect(count(store, "world_inbox")).toBe(2);
			const result = run(
				store,
				forgetChunk("f-1", "forget-off", [sourceRoot(2)], {
					hostChecks: { ...states(), gate: "closed", policyRevision: "pol-9" },
					// access still names the old policy: only forget ignores the mismatch
				}),
			);
			expect(result).toMatchObject({
				status: "applied",
				forget: { state: "complete" },
			});
			// The held event stays received/held; it was never in the closure.
			const held = store.read((db) =>
				db
					.query("SELECT status FROM world_inbox WHERE event_id = 'e-held'")
					.get(),
			);
			expect(held).toEqual({ status: "held" });
			// The unrelated forbidden-scope access is still refused.
			expect(
				run(
					store,
					forgetChunk("f-2", "forget-x", [sourceRoot(3)], {
						scope: { principal: "p-a", scopeKey: "scope-z" },
					}),
				),
			).toEqual({ status: "rejected", reasonCode: "SCOPE_NOT_PERMITTED" });
		} finally {
			store.close();
		}
	});
});

describe("A30 long closures are chunked", () => {
	const N = 500;
	function bulk(store: TestStore) {
		store.write((db) => {
			for (let i = 1; i <= N; i++)
				seedAssertion(
					db,
					markedClaim(`bulk-${String(i).padStart(3, "0")}`, 9, [9], true),
					true,
				);
		});
	}
	const progress = (store: TestStore) =>
		store.read((db) => ({
			done: (
				db
					.query(
						"SELECT COUNT(*) AS n FROM world_forget_target WHERE state='done'",
					)
					.get() as { n: number }
			).n,
			pending: (
				db
					.query(
						"SELECT COUNT(*) AS n FROM world_forget_target WHERE state='pending'",
					)
					.get() as { n: number }
			).n,
			gate: isGateOpenIn(db),
		}));
	const isGateOpenIn = (db: WorldDb) => isGateOpen(db, A);

	test("gate closes on the first chunk, <=500 targets per chunk, resumes to completion", () => {
		const store = openWorld();
		try {
			bulk(store);
			expect(count(store, "world_assertion")).toBe(N);
			expect(count(store, "world_prediction")).toBe(N);
			const roots = [{ kind: "source", id: srcKey(9), revision: 1 }];
			let key = 0;
			let last = { done: 0, pending: 0, gate: true };
			let chunks = 0;
			let state = "pending";
			while (state === "pending") {
				chunks++;
				const result = run(
					store,
					forgetChunk(`f-${++key}`, "forget-big", roots),
				);
				expect(result.status).toBe("applied");
				const forget = (result as { forget: { state: string } }).forget;
				const now = progress(store);
				expect(now.done - last.done).toBeLessThanOrEqual(500);
				// The Scope is closed from the very first chunk on.
				expect(now.gate).toBe(false);
				last = now;
				state = forget.state;
				if (chunks > 20) throw new Error("no progress");
			}
			expect(chunks).toBeGreaterThanOrEqual(3);
			expect(last.pending).toBe(0);
			expect(count(store, "world_assertion")).toBe(0);
			expect(count(store, "world_prediction")).toBe(0);
			expect(count(store, "world_current")).toBe(0);
			expect(leaks(store, MARKER)).toEqual([]);
		} finally {
			store.close();
		}
	});

	test("a failing 2nd chunk rolls back alone, the 1st stays durable, resume completes", () => {
		const store = openWorld();
		try {
			bulk(store);
			const roots = [{ kind: "source", id: srcKey(9), revision: 1 }];
			expect(run(store, forgetChunk("f-1", "forget-big", roots))).toMatchObject(
				{ forget: { state: "pending" } },
			);
			const afterFirst = store.read((db) => ({
				assertions: count0(db, "world_assertion"),
				targets: count0(db, "world_forget_target"),
				gateOpen: isGateOpen(db, A),
			}));
			expect(afterFirst.gateOpen).toBe(false);
			// Try failing at several DML positions of chunk 2: each rolls back wholly.
			for (const failAt of [1, 3, 10, 400, 1500]) {
				expect(() =>
					store.write((db) => {
						apply(
							failingDb(db, failAt),
							forgetChunk("f-2", "forget-big", roots),
						);
					}),
				).toThrow(InjectedFailure);
				expect(
					store.read((db) => ({
						assertions: count0(db, "world_assertion"),
						targets: count0(db, "world_forget_target"),
						gateOpen: isGateOpen(db, A),
					})),
				).toEqual(afterFirst);
			}
			// Resume with the same chunk key and finish.
			let state = "pending";
			let n = 2;
			while (state === "pending") {
				const r = run(store, forgetChunk(`f-${n++}`, "forget-big", roots));
				state = (r as { forget: { state: string } }).forget.state;
				if (n > 20) throw new Error("no progress");
			}
			expect(count(store, "world_assertion")).toBe(0);
			expect(count(store, "world_prediction")).toBe(0);
			const forget = store.read((db) => getForget(db, A, "forget-big"));
			expect(forget?.state).toBe("complete");
		} finally {
			store.close();
		}
	});
});
const count0 = (db: WorldDb, table: string) =>
	(db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("A26 forget replay", () => {
	test("the same chunk key is a no_op without payload; reason conflict and tx-less are refused", () => {
		const store = openWorld();
		try {
			seed(store);
			const first = run(store, forgetChunk("f-1", "forget-1", [sourceRoot(1)]));
			const before = {
				tombstones: count(store, "world_tombstone"),
				targets: count(store, "world_forget_target"),
				operations: count(store, "world_operation"),
			};
			const again = run(store, forgetChunk("f-1", "forget-1", [sourceRoot(1)]));
			expect(again.status).toBe("no_op");
			expect((again as { receipt: unknown }).receipt).toEqual(
				(first as { receipt: unknown }).receipt,
			);
			expect(JSON.stringify(again)).not.toContain(MARKER);
			expect({
				tombstones: count(store, "world_tombstone"),
				targets: count(store, "world_forget_target"),
				operations: count(store, "world_operation"),
			}).toEqual(before);
			// Same key, different content -> conflict.
			expect(
				run(store, forgetChunk("f-1", "forget-1", [sourceRoot(3)])),
			).toEqual({ status: "rejected", reasonCode: "OPERATION_KEY_CONFLICT" });
			// Same forgetId, different reason -> refused before any DML.
			expect(
				run(
					store,
					forgetChunk(
						"f-2",
						"forget-1",
						[sourceRoot(1)],
						{},
						"SOURCE_FORGOTTEN",
					),
				),
			).toEqual({ status: "rejected", reasonCode: "FORGET_REASON_CONFLICT" });
			// A resend of the original registration does not resurrect anything.
			const resurrect = run(
				store,
				register("s-2", markedClaim("claim-2", 1, [1, 2], true)),
			);
			expect(resurrect.status).not.toBe("applied");
			expect(JSON.stringify(resurrect)).not.toContain(MARKER);
			expect(leaks(store, MARKER)).toEqual([]);
			// Outside a transaction nothing is touched.
			const detached = {
				inTransaction: false,
				exec() {
					throw new Error("sql_touched");
				},
				query() {
					throw new Error("sql_touched");
				},
			} as unknown as WorldDb;
			expect(() =>
				apply(detached, forgetChunk("f-9", "forget-9", [sourceRoot(1)])),
			).toThrow(WorldTransactionRequiredError);
			void claim;
		} finally {
			store.close();
		}
	});
});

describe("A23 forget atomicity", () => {
	test("an exception at every DML stage of a chunk leaves the database as before", () => {
		const store = openWorld();
		try {
			seed(store);
			const before = dump(store);
			let stages = 0;
			for (let failAt = 1; failAt < 400; failAt++) {
				let threw = false;
				try {
					store.write((db) => {
						apply(
							failingDb(db, failAt),
							forgetChunk("f-1", "forget-1", [sourceRoot(2)]),
						);
						throw new Error("completed");
					});
				} catch (error) {
					threw = error instanceof InjectedFailure;
					if (!threw && (error as Error).message !== "completed") throw error;
				}
				if (!threw) break;
				stages++;
				expect(dump(store)).toEqual(before);
			}
			expect(stages).toBeGreaterThan(20);
			expect(isGateOpen0(store)).toBe(true);
		} finally {
			store.close();
		}
	});
});
const isGateOpen0 = (store: TestStore) => store.read((db) => isGateOpen(db, A));
