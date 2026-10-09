import { describe, expect, test } from "bun:test";
import { insertTombstone } from "../../src/domains/lifecycle/sqlite.ts";
import type { WorldDb } from "../../src/sqlite.ts";
import { failingDb, InjectedFailure } from "../support/failing-db.ts";
import type { TestStore } from "../support/sqlite-store.ts";
import {
	A,
	TABLES,
	apply,
	claim,
	envelope,
	hostChecks,
	openWorld,
	probe,
	ref,
	state,
} from "./world-fixture.ts";

const EXTRACTION_TABLES = [
	"world_inbox",
	"world_input_manifest",
	"world_manifest_dependency",
	"world_checkpoint",
] as const;
const dumpAll = (store: TestStore) =>
	store.read((db) =>
		Object.fromEntries(
			[...TABLES, ...EXTRACTION_TABLES].map((table) => [
				table,
				db.query(`SELECT * FROM ${table} ORDER BY rowid`).all(),
			]),
		),
	);
const count = (store: TestStore, table: string) =>
	store.read(
		(db) =>
			(db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n,
	);

const feed = {
	scopeKeys: ["scope-a", "scope-b"],
	kind: "conversation",
	cursorRestoreEpoch: "r1",
};
const dep = (n: number) => ref({ id: `src-${n}` });
const states = (count = 3) =>
	hostChecks(
		Array.from({ length: count }, (_, i) => state({ id: `src-${i + 1}` })),
	);
const receive = (
	key: string,
	eventId: string,
	seq: number,
	cursor: string,
	over: Record<string, unknown> = {},
) =>
	envelope(
		key,
		{
			kind: "inbox.receive",
			feed,
			event: { eventId, seq, payload: { text: "音声サービスは9月から" } },
			receivedCursor: cursor,
		},
		{ hostChecks: states(), ...over },
	);
const candidate = (id: string, extra: Record<string, unknown> = {}) =>
	claim({
		id,
		evidence: [
			{
				evidenceId: `ev-${id}`,
				kind: "user_statement",
				stance: "supports",
				source: dep(1),
				rootEvidenceId: `root-${id}`,
			},
		],
		inputManifest: [dep(1)],
		rootEvidenceIds: [`root-${id}`],
		...extra,
	});
/** Canonical payloads reject undefined, so absent fields are omitted. */
const withoutUndefined = (value: Record<string, unknown>) =>
	Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
const settle = (
	key: string,
	eventId: string,
	over: Record<string, unknown> = {},
	op: Record<string, unknown> = {},
	count = 3,
) =>
	envelope(
		key,
		withoutUndefined({
			kind: "candidate.settle",
			feed,
			eventId,
			disposition: "applied",
			manifest: {
				manifestId: `m-${eventId}`,
				dependencies: [dep(1), dep(2), dep(3)],
			},
			assertions: [candidate(`c-${eventId}`)],
			appliedCursor: `a-${eventId}`,
			...op,
		}),
		{ hostChecks: states(count), ...over },
	);
const seed = (store: TestStore) =>
	store.write((db) => {
		expect(apply(db, receive("r-1", "e-100", 100, "c-100")).status).toBe(
			"applied",
		);
		expect(apply(db, receive("r-2", "e-105", 105, "c-105")).status).toBe(
			"applied",
		);
	});

describe("inbox.receive", () => {
	test("A28 seq gap 100 -> 105 is tolerated; duplicate event adds no row; cursors stay opaque", () => {
		const store = openWorld();
		try {
			seed(store);
			expect(count(store, "world_inbox")).toBe(2);
			store.write((db) => {
				const again = apply(db, receive("r-3", "e-100", 100, "c-100"));
				expect(again.status).toBe("applied");
			});
			expect(count(store, "world_inbox")).toBe(2);
			const cp = store.read((db) =>
				db
					.query("SELECT received_cursor, applied_cursor FROM world_checkpoint")
					.all(),
			);
			expect(cp).toEqual([
				{
					received_cursor: "c-105",
					applied_cursor: null,
				},
			]);
		} finally {
			store.close();
		}
	});
	test("A28 a failure while saving the receipt cursor rolls the intake back; the cursor does not advance", () => {
		const store = openWorld();
		try {
			const before = dumpAll(store);
			// DML order: inbox insert (1), checkpoint insert (2), operation receipt (3).
			expect(() =>
				store.write((db) => {
					probe(db);
					apply(failingDb(db, 2), receive("r-1", "e-100", 100, "c-100"));
				}),
			).toThrow(InjectedFailure);
			expect(dumpAll(store)).toEqual(before);
		} finally {
			store.close();
		}
	});
	test("an older restoreEpoch cursor is refused before any DML", () => {
		const store = openWorld();
		try {
			const before = dumpAll(store);
			store.write((db) => {
				const stale = envelope(
					"r-1",
					{
						kind: "inbox.receive",
						feed: { ...feed, cursorRestoreEpoch: "r0" },
						event: { eventId: "e-1", seq: 1, payload: 1 },
						receivedCursor: "c-1",
					},
					{ hostChecks: states() },
				);
				expect(apply(db, stale)).toEqual({
					status: "rejected",
					reasonCode: "STALE_RESTORE_EPOCH",
				});
			});
			expect(dumpAll(store)).toEqual(before);
		} finally {
			store.close();
		}
	});
});

describe("candidate.settle", () => {
	test("A28 received and applied positions are separate; A20 manifest keeps every input dependency", () => {
		const store = openWorld();
		try {
			seed(store);
			store.write((db) => {
				probe(db);
				expect(
					apply(db, settle("s-1", "e-100", {}, { appliedCursor: "c-100" }))
						.status,
				).toBe("applied");
			});
			const cp = store.read((db) =>
				db
					.query("SELECT received_cursor, applied_cursor FROM world_checkpoint")
					.all(),
			);
			expect(cp).toEqual([
				{ received_cursor: "c-105", applied_cursor: "c-100" },
			]);
			const inbox = store.read((db) =>
				db.query("SELECT event_id, status FROM world_inbox ORDER BY seq").all(),
			);
			expect(inbox).toEqual([
				{ event_id: "e-100", status: "applied" },
				{ event_id: "e-105", status: "received" },
			]);
			// src-2 and src-3 were inputs but never cited: still in the manifest.
			expect(count(store, "world_manifest_dependency")).toBe(3);
			expect(count(store, "world_assertion")).toBe(1);
			expect(
				store.read(
					(db) =>
						(
							db.query("SELECT epoch FROM world_scope_epoch").get() as {
								epoch: number;
							}
						).epoch,
				),
			).toBeGreaterThan(0);
			expect(count(store, "world_current")).toBe(1);
		} finally {
			store.close();
		}
	});
	test("A20 33 unique input dependencies are rejected with nothing written", () => {
		const store = openWorld();
		try {
			seed(store);
			const before = dumpAll(store);
			store.write((db) => {
				const many = Array.from({ length: 33 }, (_, i) => dep(i + 1));
				const result = apply(
					db,
					settle(
						"s-1",
						"e-100",
						{},
						{ manifest: { manifestId: "m-big", dependencies: many } },
						33,
					),
				);
				expect(result).toEqual({
					status: "rejected",
					reasonCode: "LIMIT_EXCEEDED",
				});
			});
			expect(dumpAll(store)).toEqual(before);
			store.write((db) => {
				const exactly = Array.from({ length: 32 }, (_, i) => dep(i + 1));
				expect(
					apply(
						db,
						settle(
							"s-2",
							"e-100",
							{},
							{ manifest: { manifestId: "m-32", dependencies: exactly } },
							32,
						),
					).status,
				).toBe("applied");
			});
			expect(count(store, "world_manifest_dependency")).toBe(32);
		} finally {
			store.close();
		}
	});
	test("a candidate whose input is not in the manifest, or batch of 9, is rejected whole", () => {
		const store = openWorld();
		try {
			seed(store);
			const before = dumpAll(store);
			store.write((db) => {
				const outside = candidate("c-x", { inputManifest: [dep(1), dep(9)] });
				expect(
					apply(db, settle("s-1", "e-100", {}, { assertions: [outside] }, 9)),
				).toEqual({ status: "rejected", reasonCode: "INPUT_NOT_IN_MANIFEST" });
				const nine = Array.from({ length: 9 }, (_, i) => candidate(`c-${i}`));
				expect(
					apply(db, settle("s-2", "e-100", {}, { assertions: nine })),
				).toEqual({ status: "rejected", reasonCode: "LIMIT_EXCEEDED" });
				expect(apply(db, settle("s-3", "e-none"))).toEqual({
					status: "rejected",
					reasonCode: "EVENT_NOT_FOUND",
				});
				const adopted = candidate("c-act", { lifecycle: "active" });
				expect(
					apply(db, settle("s-4", "e-100", {}, { assertions: [adopted] })),
				).toEqual({ status: "rejected", reasonCode: "INVALID_INPUT" });
			});
			expect(dumpAll(store)).toEqual(before);
		} finally {
			store.close();
		}
	});
	test("A29 a held event stays received-like and never blocks later settle or correction work", () => {
		const store = openWorld();
		try {
			seed(store);
			store.write((db) => {
				expect(
					apply(
						db,
						settle(
							"s-h",
							"e-100",
							{},
							{
								disposition: "held",
								manifest: undefined,
								assertions: [],
								appliedCursor: undefined,
							},
						),
					).status,
				).toBe("applied");
			});
			const status = (id: string) =>
				store.read(
					(db) =>
						(
							db
								.query("SELECT status FROM world_inbox WHERE event_id = ?")
								.get(id) as { status: string }
						).status,
				);
			expect(status("e-100")).toBe("held");
			expect(
				store.read((db) =>
					db.query("SELECT applied_cursor FROM world_checkpoint").all(),
				),
			).toEqual([{ applied_cursor: null }]);
			// The later event is processed independently while e-100 is held.
			store.write((db) => {
				expect(
					apply(db, settle("s-2", "e-105", {}, { appliedCursor: "c-105" }))
						.status,
				).toBe("applied");
			});
			expect(status("e-105")).toBe("applied");
			// The held event can still be rejected afterwards (final).
			store.write((db) => {
				expect(
					apply(
						db,
						settle(
							"s-3",
							"e-100",
							{},
							{
								disposition: "rejected",
								manifest: undefined,
								assertions: [],
								appliedCursor: "c-100",
							},
						),
					).status,
				).toBe("applied");
				expect(
					apply(
						db,
						settle(
							"s-4",
							"e-100",
							{},
							{ manifest: { manifestId: "m-z", dependencies: [dep(1)] } },
						),
					),
				).toEqual({ status: "rejected", reasonCode: "EVENT_ALREADY_SETTLED" });
			});
			expect(status("e-100")).toBe("rejected");
		} finally {
			store.close();
		}
	});
	test("a late candidate whose input source was forgotten is rejected before any DML", () => {
		const store = openWorld();
		try {
			seed(store);
			store.write((db) => {
				insertTombstone(db, A, {
					kind: "source",
					id: JSON.stringify(["conversation", "message", "src-2", null]),
					forgetId: "f-1",
					reasonCode: "SOURCE_FORGOTTEN",
				});
			});
			const before = dumpAll(store);
			store.write((db) => {
				expect(apply(db, settle("s-1", "e-100"))).toEqual({
					status: "rejected",
					reasonCode: "TOMBSTONED",
				});
				// Snapshot says forgotten (non-cited dependency): same denial family.
				const forgotten = hostChecks([
					state(),
					state({ id: "src-2", status: "forgotten" }),
					state({ id: "src-3" }),
				]);
				const other = apply(
					db,
					settle("s-2", "e-100", { hostChecks: forgotten }),
				);
				expect(other.status).toBe("rejected");
			});
			expect(dumpAll(store)).toEqual(before);
		} finally {
			store.close();
		}
	});
	test("A23 an exception at every DML stage of a settle rolls everything back, host_probe included", () => {
		const store = openWorld();
		try {
			seed(store);
			const before = dumpAll(store);
			let stages = 0;
			for (let failAt = 1; failAt < 40; failAt++) {
				let failed = false;
				try {
					store.write((db) => {
						probe(db);
						apply(failingDb(db, failAt), settle("s-1", "e-100"));
					});
				} catch (error) {
					if (!(error instanceof InjectedFailure)) throw error;
					failed = true;
				}
				if (!failed) break;
				stages += 1;
				expect(dumpAll(store)).toEqual(before);
			}
			expect(stages).toBeGreaterThanOrEqual(8);
			// The loop's last iteration committed the successful run.
			const after = dumpAll(store);
			expect(after["world_assertion"]).toHaveLength(1);
			expect(after["world_manifest_dependency"]).toHaveLength(3);
			expect(after["world_operation"]).toHaveLength(3);
			expect(after["host_probe"]).toHaveLength(1);
		} finally {
			store.close();
		}
	});
	test("A26 replaying the same settle key is a no_op; different content conflicts", () => {
		const store = openWorld();
		try {
			seed(store);
			const first = store.write((db) => apply(db, settle("s-1", "e-100")));
			expect(first.status).toBe("applied");
			const before = dumpAll(store);
			store.write((db) => {
				const again = apply(db, settle("s-1", "e-100"));
				expect(again).toEqual({
					status: "no_op",
					receipt: (first as { receipt: { ref: string } }).receipt,
				});
				expect(
					apply(db, settle("s-1", "e-100", {}, { appliedCursor: "other" })),
				).toEqual({ status: "rejected", reasonCode: "OPERATION_KEY_CONFLICT" });
			});
			expect(dumpAll(store)).toEqual(before);
		} finally {
			store.close();
		}
	});
	test("a write outside a transaction still throws for the new operations", () => {
		const untouched = {
			inTransaction: false,
			exec() {
				throw new Error("sql_touched");
			},
			query() {
				throw new Error("sql_touched");
			},
		} as unknown as WorldDb;
		expect(() => apply(untouched, receive("r", "e", 1, "c"))).toThrow();
		expect(() => apply(untouched, settle("s", "e"))).toThrow();
	});
});
