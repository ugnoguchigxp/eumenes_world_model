/**
 * A32 restore and rebuild. The journal adapter in test/support/restore-fixture.ts
 * is a FIXTURE (memory / temp file): product journal durability is NOT
 * accepted here (P3-05). The "old database" is a store that never saw the
 * forgets the newer journal records.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { listScopeAssertions } from "../../src/domains/assertions/sqlite.ts";
import { projectLedger } from "../../src/application/sqlite/projection.ts";
import { markInbox, recordInbox } from "../../src/domains/extraction/sqlite.ts";
import { getGate, getTombstone } from "../../src/domains/lifecycle/sqlite.ts";
import { getEpoch, readCurrent } from "../../src/domains/projection/sqlite.ts";
import type {
	HostChecks,
	WorldDb,
	WorldOperationResult,
} from "../../src/sqlite.ts";
import { failingDb, InjectedFailure } from "../support/failing-db.ts";
import {
	createJournal,
	type JournalFixture,
} from "../support/restore-fixture.ts";
import type { TestStore } from "../support/sqlite-store.ts";
import {
	count,
	markedClaim,
	srcKey,
	srcState,
	states,
} from "./forget-fixture.ts";
import {
	A,
	B,
	NOW,
	access,
	apply,
	dump,
	envelope,
	hasher,
	openWorld,
	probe,
} from "./world-fixture.ts";

const stores: TestStore[] = [];
const journals: JournalFixture[] = [];
afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	for (const journal of journals.splice(0)) journal.dispose();
});

const feed = {
	scopeKeys: ["scope-a"],
	kind: "conversation",
	cursorRestoreEpoch: "r1",
};
const hostFor = (epoch: string) => ({ ...states(3), restoreEpoch: epoch });

function step(
	store: TestStore,
	key: string,
	operation: unknown,
	epoch = "r2",
	scopeOver: Record<string, unknown> = {},
	withProbe = true,
): WorldOperationResult {
	return store.write((db) => {
		if (withProbe) probe(db);
		return apply(
			db,
			envelope(key, operation, { hostChecks: hostFor(epoch), ...scopeOver }),
		);
	});
}
const sources = [srcKey(1), srcKey(2), srcKey(3)];
const regAll = (status: string, keys = sources) => ({
	kind: "restore.register",
	registrations: keys.map((sourceKey) => ({ sourceKey, status })),
});
const reconcile = (journal: JournalFixture, final = true) => {
	const head = journal.head();
	return {
		kind: "restore.reconcile",
		journal: { seq: head.seq, final, tombstones: head.tombstones },
	};
};

/** Old database: three claims from three sources, one received feed cursor. */
function oldDb(): TestStore {
	const store = openWorld("file");
	stores.push(store);
	store.write((db) => {
		for (const n of [1, 2, 3]) {
			const result = apply(
				db,
				envelope(
					`reg-${n}`,
					{
						kind: "assertion.register",
						assertion: markedClaim(`c${n}`, n),
					},
					{ hostChecks: states() },
				),
			);
			expect(result.status).toBe("applied");
		}
		const received = apply(
			db,
			envelope(
				"recv-1",
				{
					kind: "inbox.receive",
					feed,
					event: { eventId: "ev-1", seq: 100, payload: { text: "x" } },
					receivedCursor: "c-100",
				},
				{ hostChecks: states() },
			),
		);
		expect(received.status).toBe("applied");
	});
	return store;
}
const journalWithForgottenSource2 = () => {
	const journal = createJournal({ file: true });
	journals.push(journal);
	journal.append([
		{
			ref: { kind: "source", id: srcKey(2), revision: 1 },
			forgetId: "forget-J1",
			reasonCode: "SOURCE_FORGOTTEN",
		},
	]);
	return journal;
};
const gate = (store: TestStore) => store.read((db) => getGate(db, A));
const assertionIds = (store: TestStore) =>
	store.read((db) =>
		listScopeAssertions(db, A, { limit: 100 }).items.map((a) => a.id),
	);
const stored = (store: TestStore) =>
	store.read((db) => ({
		current: readCurrent(db, A, { limit: 500 }).rows,
		epoch: getEpoch(db, A),
	}));

describe("A32 restore after an older database", () => {
	test("old DB + newer journal: gate closes, cursors drop, tombstone re-applied, projection rebuilt, gate reopens", () => {
		const store = oldDb();
		const journal = journalWithForgottenSource2();
		expect(assertionIds(store)).toEqual(["c1", "c2", "c3"]);
		expect(count(store, "world_checkpoint")).toBe(1);

		const begun = step(store, "b", { kind: "restore.begin" });
		expect(begun.status).toBe("applied");
		expect(gate(store)).toMatchObject({
			state: "closed",
			reasonCode: "RESTORE_IN_PROGRESS",
			restoreEpoch: "r2",
		});
		expect(count(store, "world_checkpoint")).toBe(0);

		// Normal operations are refused while the restore holds the gate.
		expect(
			step(store, "n", {
				kind: "assertion.register",
				assertion: markedClaim("c9", 1),
			}),
		).toEqual({ status: "blocked", reasonCode: "GATE_CLOSED" });

		step(store, "r", regAll("registered", [srcKey(1), srcKey(3)]));
		// Finishing before the journal is reconciled keeps the gate closed.
		expect(step(store, "f0", { kind: "restore.finish" })).toMatchObject({
			status: "blocked",
			reasonCode: "JOURNAL_NOT_RECONCILED",
		});
		const reconciled = step(store, "j", reconcile(journal));
		expect(reconciled.status).toBe("applied");
		expect(assertionIds(store)).toEqual(["c1", "c3"]);
		store.read((db) => {
			expect(
				getTombstone(db, A, { kind: "source", id: srcKey(2) }),
			).toMatchObject({
				reasonCode: "SOURCE_FORGOTTEN",
			});
		});

		const finished = step(store, "f", { kind: "restore.finish" });
		expect(finished).toMatchObject({
			status: "applied",
			restore: { state: "complete" },
		});
		expect(gate(store)).toMatchObject({ state: "open", restoreEpoch: "r2" });
	});

	test("rebuilt projection equals the pure projection of the ledger", () => {
		const store = oldDb();
		const journal = journalWithForgottenSource2();
		expect(fullRestoreSync(store, journal).status).toBe("applied");
		store.read((db) => {
			const ledger = listScopeAssertions(db, A, { limit: 100 }).items;
			const epoch = getEpoch(db, A)!;
			const pure = projectLedger(
				ledger,
				A,
				{
					hasher,
					clock: NOW,
					hostChecks: hostFor("r2") as unknown as HostChecks,
				},
				epoch.epoch - 0,
			);
			const rows = readCurrent(db, A, { limit: 500 }).rows;
			expect(
				rows
					.map((r) => [r.assertionId, r.assertionRevision, r.lifecycle])
					.sort(),
			).toEqual(
				pure.entries
					.map((r) => [r.assertionId, r.assertionRevision, r.lifecycle])
					.sort(),
			);
			expect(epoch.materialDigest).toBe(pure.materialDigest);
		});
	});

	test("a dependency the old DB remembered no edge for is re-registered as TOMBSTONED: derived items go, never counted as registered", () => {
		const store = oldDb();
		const journal = createJournal();
		journals.push(journal);
		journal.append([]);
		step(store, "b", { kind: "restore.begin" });
		step(store, "r1", regAll("registered", [srcKey(1), srcKey(2)]));
		// Memory says src-3 was tombstoned; the old DB knew nothing of it.
		expect(step(store, "r2", regAll("tombstoned", [srcKey(3)]))).toMatchObject({
			status: "applied",
		});
		expect(assertionIds(store)).toEqual(["c1", "c2"]);
		store.read((db) => {
			expect(
				getTombstone(db, A, { kind: "source", id: srcKey(3) }),
			).toBeDefined();
		});
		step(store, "j", reconcile(journal));
		expect(step(store, "f", { kind: "restore.finish" }).status).toBe("applied");
		// A later registration of the forgotten source is refused for good.
		const late = step(
			store,
			"late",
			{ kind: "assertion.register", assertion: markedClaim("c7", 3) },
			"r2",
		);
		expect(late).toEqual({ status: "rejected", reasonCode: "TOMBSTONED" });
	});

	test("unknown or unreported dependencies keep the gate closed (counts only)", () => {
		const store = oldDb();
		const journal = journalWithForgottenSource2();
		step(store, "b", { kind: "restore.begin" });
		const unknown = step(store, "r", regAll("unknown", [srcKey(1), srcKey(3)]));
		expect(unknown).toMatchObject({
			status: "applied",
			restore: { unknown: 2 },
		});
		step(store, "j", reconcile(journal));
		const refused = step(store, "f", { kind: "restore.finish" });
		expect(refused).toEqual({
			status: "blocked",
			reasonCode: "DEPENDENCIES_UNACCOUNTED",
			restore: { state: "pending", unaccounted: 2 },
		});
		expect(JSON.stringify(refused)).not.toContain("src-");
		expect(gate(store)?.state).toBe("closed");
		// Registering them completes the restore.
		step(store, "r2", regAll("registered", [srcKey(1), srcKey(3)]));
		expect(step(store, "f2", { kind: "restore.finish" }).status).toBe(
			"applied",
		);
		expect(gate(store)?.state).toBe("open");
	});

	test("a report for a key the ledger never recorded is refused before any write", () => {
		const store = oldDb();
		step(store, "b", { kind: "restore.begin" });
		const before = dump(store);
		expect(
			step(
				store,
				"x",
				regAll("registered", ["not-a-dependency"]),
				"r2",
				{},
				false,
			),
		).toEqual({
			status: "rejected",
			reasonCode: "DEPENDENCY_NOT_IN_LEDGER",
		});
		expect(dump(store)).toEqual(before);
	});

	test("restoreEpoch must match: steps under another epoch are blocked", () => {
		const store = oldDb();
		step(store, "b", { kind: "restore.begin" });
		const before = dump(store);
		expect(
			step(store, "x", regAll("registered", [srcKey(1)]), "r1", {}, false),
		).toEqual({
			status: "blocked",
			reasonCode: "RESTORE_NOT_IN_PROGRESS",
		});
		expect(
			step(store, "y", { kind: "restore.finish" }, "r9", {}, false),
		).toEqual({
			status: "blocked",
			reasonCode: "RESTORE_NOT_IN_PROGRESS",
		});
		expect(dump(store)).toEqual(before);
	});

	test("a cursor issued under the pre-restore epoch is refused afterwards", () => {
		const store = oldDb();
		const journal = journalWithForgottenSource2();
		expect(fullRestoreSync(store, journal).status).toBe("applied");
		const stale = step(
			store,
			"stale",
			{
				kind: "inbox.receive",
				feed,
				event: { eventId: "ev-2", seq: 101, payload: { text: "y" } },
				receivedCursor: "c-101",
			},
			"r2",
		);
		expect(stale.status).toBe("rejected");
		// The pre-restore received event was released with its payload.
		expect(count(store, "world_inbox")).toBe(0);
	});

	test("a rolled-back journal sequence keeps the gate closed and changes nothing", () => {
		const store = oldDb();
		const journal = journalWithForgottenSource2();
		journal.append([]);
		journal.append([]); // seq 3
		expect(fullRestoreSync(store, journal).status).toBe("applied");
		// A second restore with a journal copy that went back to seq 1.
		step(store, "b2", { kind: "restore.begin" }, "r3");
		journal.rollbackTo(1);
		const before = dump(store);
		const refused = step(store, "j2", reconcile(journal), "r3", {}, false);
		expect(refused).toEqual({
			status: "blocked",
			reasonCode: "JOURNAL_ROLLED_BACK",
		});
		expect(dump(store)).toEqual(before);
		expect(gate(store)).toMatchObject({ state: "closed", restoreEpoch: "r3" });
		expect(step(store, "f2", { kind: "restore.finish" }, "r3")).toMatchObject({
			status: "blocked",
		});
	});

	test("a rollback to an old DB never removes tombstones: the journal re-applies them", () => {
		const store = oldDb();
		const journal = journalWithForgottenSource2();
		expect(fullRestoreSync(store, journal).status).toBe("applied");
		store.read((db) => {
			expect(
				getTombstone(db, A, { kind: "source", id: srcKey(2) }),
			).toBeDefined();
		});
		// The same journal against a second, even older database state.
		const older = oldDb();
		expect(fullRestoreSync(older, journal, "o").status).toBe("applied");
		older.read((db) => {
			expect(
				getTombstone(db, A, { kind: "source", id: srcKey(2) }),
			).toBeDefined();
		});
		expect(assertionIds(older)).toEqual(["c1", "c3"]);
	});

	test("a crash in any step leaves the gate closed and the step resumable", () => {
		for (const stepName of ["reconcile", "finish"] as const) {
			const store = oldDb();
			const journal = journalWithForgottenSource2();
			step(store, "b", { kind: "restore.begin" });
			step(store, "r", regAll("registered", [srcKey(1), srcKey(3)]));
			if (stepName === "finish") step(store, "j", reconcile(journal));
			const operation =
				stepName === "reconcile"
					? reconcile(journal)
					: { kind: "restore.finish" };
			let stages = 0;
			for (let failAt = 1; failAt < 80; failAt++) {
				const before = dump(store);
				let threw = false;
				try {
					store.write((db: WorldDb) => {
						probe(db);
						const wrapped = failingDb(db, failAt);
						const result = apply(
							wrapped,
							envelope(`crash-${stepName}`, operation, {
								hostChecks: hostFor("r2"),
							}),
						);
						if (wrapped.dmlCount < failAt) stages = failAt - 1;
						return result;
					});
				} catch (error) {
					threw = error instanceof InjectedFailure;
					if (!threw) throw error;
				}
				if (!threw) break;
				expect(dump(store)).toEqual(before);
				expect(gate(store)?.state).toBe("closed");
			}
			expect(stages).toBeGreaterThan(1);
			// The first failure-free run is the resumed step: it completed.
			if (stepName === "reconcile")
				expect(step(store, "f", { kind: "restore.finish" }).status).toBe(
					"applied",
				);
			expect(gate(store)?.state).toBe("open");
		}
	});

	test("rerunning the whole restore gives the same result (idempotent)", () => {
		const store = oldDb();
		const journal = journalWithForgottenSource2();
		expect(fullRestoreSync(store, journal, "a").status).toBe("applied");
		const first = stored(store);
		const ids = assertionIds(store);
		expect(fullRestoreSync(store, journal, "b").status).toBe("applied");
		expect(assertionIds(store)).toEqual(ids);
		expect(stored(store)).toEqual(first);
		expect(gate(store)?.state).toBe("open");
		// Same operation key and content: no_op with the same receipt.
		const again = step(store, "a-fin", { kind: "restore.finish" });
		expect(again.status).toBe("no_op");
	});

	test("another Scope is untouched by a restore of this one", () => {
		const store = oldDb();
		const journal = journalWithForgottenSource2();
		store.write((db) => {
			const other = apply(
				db,
				envelope(
					"b-1",
					{
						kind: "assertion.register",
						assertion: markedClaim("cb", 2, [2], true, { scope: B }),
					},
					{
						scope: B,
						access: { ...access(["scope-b"]) },
						hostChecks: {
							...states(),
							sourceSnapshot: {
								states: [srcState(2)].map((s) => ({
									...s,
									scopeKey: "scope-b",
								})),
							},
						},
					},
				),
			);
			expect(other.status).toBe("applied");
		});
		const rowsB = () =>
			store.read((db) => ({
				a: listScopeAssertions(db, B, { limit: 100 }).items.map((x) => x.id),
				gate: getGate(db, B),
				epoch: getEpoch(db, B),
			}));
		const before = rowsB();
		expect(fullRestoreSync(store, journal).status).toBe("applied");
		expect(rowsB()).toEqual(before);
		expect(before.a).toEqual(["cb"]);
	});

	test("the journal page size is bounded", () => {
		const store = oldDb();
		step(store, "b", { kind: "restore.begin" });
		const entries = Array.from({ length: 201 }, (_, i) => ({
			ref: { kind: "source", id: `s-${i}`, revision: 1 },
			forgetId: "f",
			reasonCode: "SOURCE_FORGOTTEN",
		}));
		expect(
			step(store, "big", {
				kind: "restore.reconcile",
				journal: { seq: 1, final: true, tombstones: entries },
			}),
		).toEqual({ status: "rejected", reasonCode: "INVALID_INPUT" });
	});
});

describe("rebuild", () => {
	test("rebuild recomputes the projection from the ledger; an unchanged ledger keeps the epoch", () => {
		const store = oldDb();
		const before = stored(store);
		const result = store.write((db) =>
			apply(db, envelope("rb", { kind: "rebuild" }, { hostChecks: states() })),
		);
		expect(result.status).toBe("applied");
		expect(stored(store)).toEqual(before);
	});
});

function fullRestoreSync(
	store: TestStore,
	journal: JournalFixture,
	prefix = "k",
) {
	const epoch = "r2";
	// A repeat on an already open DB re-begins: the epoch token may repeat.
	step(store, `${prefix}-begin`, { kind: "restore.begin" }, epoch);
	step(
		store,
		`${prefix}-reg`,
		regAll("registered", [srcKey(1), srcKey(3)]),
		epoch,
	);
	step(store, `${prefix}-rec`, reconcile(journal), epoch);
	return step(store, `${prefix}-fin`, { kind: "restore.finish" }, epoch);
}

describe("review round 2: restore details", () => {
	test("3 events received before a restore are released with their payload and can be re-delivered", () => {
		const store = oldDb();
		expect(count(store, "world_inbox")).toBe(1);
		step(store, "b", { kind: "restore.begin" });
		expect(count(store, "world_inbox")).toBe(0);
		const journal = journalWithForgottenSource2();
		step(store, "r", regAll("registered", [srcKey(1), srcKey(3)]));
		step(store, "j", reconcile(journal));
		expect(step(store, "f", { kind: "restore.finish" }).status).toBe("applied");
		const redelivered = step(
			store,
			"again",
			{
				kind: "inbox.receive",
				feed: { ...feed, cursorRestoreEpoch: "r2" },
				event: { eventId: "ev-1", seq: 100, payload: { text: "x" } },
				receivedCursor: "c-100",
			},
			"r2",
		);
		expect(redelivered.status).toBe("applied");
		expect(count(store, "world_inbox")).toBe(1);
	});

	test("3 a final event is a duplicate by eventId and content, whatever feed or sequence redelivers it", () => {
		const store = openWorld("memory");
		stores.push(store);
		store.write((db) => {
			const first = recordInbox(db, A, {
				eventId: "ev-9",
				feedKey: "feed-r1",
				seq: 5,
				payload: { text: "t" },
			});
			expect(first.status).toBe("inserted");
			expect(markInbox(db, A, "ev-9", "applied").status).toBe("updated");
			expect(
				recordInbox(db, A, {
					eventId: "ev-9",
					feedKey: "feed-r2",
					seq: 77,
					payload: { text: "t" },
				}).status,
			).toBe("unchanged");
			expect(
				recordInbox(db, A, {
					eventId: "ev-9",
					feedKey: "feed-r2",
					seq: 77,
					payload: { text: "other" },
				}),
			).toEqual({ status: "rejected", reasonCode: "EVENT_CONFLICT" });
		});
	});

	test("6 the same operationKey under another restore epoch is a different operation, not a silent no_op", () => {
		const store = oldDb();
		const journal = journalWithForgottenSource2();
		expect(fullRestoreSync(store, journal).status).toBe("applied");
		expect(gate(store)?.state).toBe("open");
		const reused = step(store, "k-begin", { kind: "restore.begin" }, "r3");
		expect(reused).toEqual({
			status: "rejected",
			reasonCode: "OPERATION_KEY_CONFLICT",
		});
		expect(gate(store)?.state).toBe("open");
	});

	test("finish without a final journal reconcile stays blocked and closed", () => {
		const store = oldDb();
		step(store, "b", { kind: "restore.begin" });
		step(store, "r", regAll("registered", sources));
		const before = dump(store);
		expect(
			step(store, "f", { kind: "restore.finish" }, "r2", {}, false),
		).toMatchObject({
			status: "blocked",
			reasonCode: "JOURNAL_NOT_RECONCILED",
		});
		expect(gate(store)?.state).toBe("closed");
		expect(dump(store)).toEqual(before);
	});

	test("finish counts externally tombstoned dependencies as accounted", () => {
		const store = oldDb();
		const journal = createJournal();
		journals.push(journal);
		journal.append([]);
		step(store, "b", { kind: "restore.begin" });
		step(store, "r1", regAll("registered", [srcKey(1), srcKey(3)]));
		step(store, "r2", regAll("tombstoned", [srcKey(2)]));
		step(store, "j", reconcile(journal));
		expect(step(store, "f", { kind: "restore.finish" }).status).toBe("applied");
		expect(gate(store)?.state).toBe("open");
	});
});
