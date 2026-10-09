import { describe, expect, test } from "bun:test";
import {
	buildWorldSlice,
	toSliceReceipt,
} from "../../src/domains/projection/index.ts";
import { getAssertion, getHead } from "../../src/domains/assertions/sqlite.ts";
import { getEpoch } from "../../src/domains/projection/sqlite.ts";
import { closeGate } from "../../src/domains/lifecycle/sqlite.ts";
import { readWorldSnapshot, validateWorldUsage } from "../../src/sqlite.ts";
import { failingDb, InjectedFailure } from "../support/failing-db.ts";
import type { TestStore } from "../support/sqlite-store.ts";
import { markedClaim, srcKey, states } from "./forget-fixture.ts";
import {
	A,
	access,
	adopt,
	apply,
	dump,
	envelope,
	hasher,
	hostChecks,
	openWorld,
	probe,
	registerClaim,
} from "./world-fixture.ts";

const register = (key: string, assertion: unknown) =>
	envelope(
		key,
		{ kind: "assertion.register", assertion },
		{ hostChecks: states() },
	);
const invalidate = (
	key: string,
	op: Record<string, unknown>,
	over: Record<string, unknown> = {},
) =>
	envelope(
		key,
		{ kind: "invalidate", reasonCode: "SOURCE_RETRACTED", targets: [], ...op },
		{ hostChecks: states(), ...over },
	);
const run = (store: TestStore, input: unknown) =>
	store.write((db) => apply(db, input));
const epoch = (store: TestStore) =>
	store.read((db) => getEpoch(db, A)?.epoch ?? 0);
const lifecycle = (store: TestStore, id: string) =>
	store.read((db) => getAssertion(db, A, id)?.lifecycle);

function seed(store: TestStore) {
	store.write((db) => {
		for (const [i, a] of [
			markedClaim("claim-1", 1, [1], false),
			markedClaim("claim-2", 1, [1, 2], false),
			markedClaim("claim-3", 3, [3], false),
		].entries())
			expect(apply(db, register(`s-${i}`, a)).status).toBe("applied");
		expect(apply(db, adopt("s-adopt", "claim-1", 1)).status).toBe("applied");
	});
}

describe("immediate correction: invalidate", () => {
	test("stops the old revision at once, advances the epoch and rejects an old Slice", () => {
		const store = openWorld();
		try {
			seed(store);
			const current = {
				contractVersion: 1,
				access: access(),
				scope: A,
				hostChecks: states(),
			};
			const receipt = store.read((db) => {
				const read = readWorldSnapshot(db, {
					contractVersion: 1,
					access: access(),
					scope: A,
					asOf: 1791500000000,
					hostChecks: states(),
				});
				if (read.status !== "ready") throw new Error(read.reasonCode);
				const slice = buildWorldSlice(
					{ contractVersion: 1, snapshot: read.snapshot, request: {} },
					hasher,
				);
				if (!slice.ok) throw new Error(slice.code);
				return toSliceReceipt(slice.value);
			});
			const before = epoch(store);
			const result = run(
				store,
				invalidate("i-1", {
					targets: [{ id: "claim-1", expectedRevision: 2 }],
				}),
			);
			expect(result.status).toBe("applied");
			expect(lifecycle(store, "claim-1")).toBe("invalidated");
			expect(store.read((db) => getHead(db, A, "claim-1"))).toEqual({
				id: "claim-1",
				currentRevision: 3,
			});
			expect(epoch(store)).toBe(before + 1);
			// The invalidated claim is no longer projected.
			expect(
				store.read(
					(db) =>
						db
							.query(
								"SELECT count(*) AS n FROM world_current WHERE assertion_id = 'claim-1'",
							)
							.get() as { n: number },
				),
			).toEqual({ n: 0 });
			store.write((db) => {
				expect(validateWorldUsage(db, receipt, current).status).toBe("blocked");
			});
			// Other Scope data is not involved at all.
			expect(lifecycle(store, "claim-3")).toBe("candidate");
		} finally {
			store.close();
		}
	});

	test("refusals happen before any DML: stale revision, unknown, terminal, bad input", () => {
		const store = openWorld();
		try {
			seed(store);
			run(
				store,
				invalidate("i-0", {
					targets: [{ id: "claim-1", expectedRevision: 2 }],
				}),
			);
			const before = dump(store);
			const cases: [Record<string, unknown>, string][] = [
				[
					{ targets: [{ id: "claim-3", expectedRevision: 7 }] },
					"REVISION_CONFLICT",
				],
				[
					{ targets: [{ id: "nope", expectedRevision: 1 }] },
					"ASSERTION_NOT_FOUND",
				],
				[
					{ targets: [{ id: "claim-1", expectedRevision: 3 }] },
					"TERMINAL_STATE",
				],
				[
					{
						reasonCode: "WHATEVER",
						targets: [{ id: "claim-3", expectedRevision: 1 }],
					},
					"INVALID_INPUT",
				],
				[{ targets: [] }, "INVALID_INPUT"],
				[
					{
						targets: [
							{ id: "claim-3", expectedRevision: 1 },
							{ id: "claim-3", expectedRevision: 1 },
						],
					},
					"INVALID_INPUT",
				],
			];
			store.write((db) => {
				for (const [i, [op, code]] of cases.entries())
					expect(apply(db, invalidate(`bad-${i}`, op))).toEqual({
						status: "rejected",
						reasonCode: code,
					});
			});
			expect(dump(store)).toEqual(before);
		} finally {
			store.close();
		}
	});

	test("A23 an exception at every DML stage rolls back with the host rows", () => {
		const store = openWorld();
		try {
			seed(store);
			const before = dump(store);
			const op = invalidate("i-1", {
				targets: [
					{ id: "claim-1", expectedRevision: 2 },
					{ id: "claim-3", expectedRevision: 1 },
				],
			});
			let stages = 0;
			for (let failAt = 1; failAt < 60; failAt++) {
				let threw = false;
				try {
					store.write((db) => {
						probe(db);
						apply(failingDb(db, failAt), op);
						throw new Error("completed"); // never commit this attempt
					});
				} catch (error) {
					threw = error instanceof InjectedFailure;
					if (!threw && (error as Error).message !== "completed") throw error;
				}
				if (!threw) break;
				stages++;
				expect(dump(store)).toEqual(before);
			}
			expect(stages).toBeGreaterThanOrEqual(6);
			expect(run(store, op).status).toBe("applied");
			expect(lifecycle(store, "claim-3")).toBe("invalidated");
		} finally {
			store.close();
		}
	});

	test("a source sweep stops every dependent without naming it; terminal ones are skipped", () => {
		const store = openWorld();
		try {
			seed(store);
			// claim-2 READS src-2 (uncited); nothing else does.
			const result = run(
				store,
				invalidate("sweep-1", { sourceKeys: [srcKey(2)] }),
			);
			expect(result.status).toBe("applied");
			expect(lifecycle(store, "claim-2")).toBe("invalidated");
			expect(lifecycle(store, "claim-1")).toBe("active");
			expect(lifecycle(store, "claim-3")).toBe("candidate");
			// A second sweep finds nothing alive: no new revision, epoch unchanged.
			const settled = epoch(store);
			expect(
				run(store, invalidate("sweep-2", { sourceKeys: [srcKey(2)] })).status,
			).toBe("applied");
			expect(epoch(store)).toBe(settled);
			expect(
				store.read((db) => getHead(db, A, "claim-2"))?.currentRevision,
			).toBe(2);
		} finally {
			store.close();
		}
	});

	test("A29 a pending extraction event does not delay the correction; replay is a no_op", () => {
		const store = openWorld();
		try {
			seed(store);
			store.write((db) => {
				const feed = {
					scopeKeys: ["scope-a"],
					kind: "conversation",
					cursorRestoreEpoch: "r1",
				};
				expect(
					apply(
						db,
						envelope(
							"ev-1",
							{
								kind: "inbox.receive",
								feed,
								event: { eventId: "e-9", seq: 9, payload: { text: "x" } },
								receivedCursor: "c-9",
							},
							{ hostChecks: states() },
						),
					).status,
				).toBe("applied");
			});
			const op = invalidate("i-1", {
				targets: [{ id: "claim-3", expectedRevision: 1 }],
			});
			const first = run(store, op);
			expect(first.status).toBe("applied");
			expect(lifecycle(store, "claim-3")).toBe("invalidated");
			const settled = dump(store);
			const again = run(store, op);
			expect(again.status).toBe("no_op");
			expect((again as { receipt: unknown }).receipt).toEqual(
				(first as { receipt: unknown }).receipt,
			);
			expect(dump(store)).toEqual(settled);
			// Same key, different content -> conflict.
			expect(
				run(
					store,
					invalidate("i-1", {
						targets: [{ id: "claim-1", expectedRevision: 2 }],
					}),
				),
			).toEqual({ status: "rejected", reasonCode: "OPERATION_KEY_CONFLICT" });
		} finally {
			store.close();
		}
	});

	test("a closed gate blocks a correction like any other write; no transaction, no write", () => {
		const store = openWorld();
		try {
			seed(store);
			store.write((db) => {
				closeGate(db, A, { reasonCode: "MAINTENANCE", restoreEpoch: "r1" });
			});
			expect(
				run(
					store,
					invalidate("i-1", {
						targets: [{ id: "claim-3", expectedRevision: 1 }],
					}),
				),
			).toEqual({ status: "blocked", reasonCode: "GATE_CLOSED" });
			expect(lifecycle(store, "claim-3")).toBe("candidate");
			void hostChecks;
			void registerClaim;
		} finally {
			store.close();
		}
	});
});
