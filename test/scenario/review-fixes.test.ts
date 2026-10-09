/**
 * Regression tests for the independent review of the persistence layer.
 * Finding numbers refer to that review (1 = Scope binding ... 12 = schema gate).
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
	LedgerTooLargeError,
	rebuildProjection,
} from "../../src/application/sqlite/projection.ts";
import {
	precheckAssertionRows,
	precheckTransitionPlan,
} from "../../src/application/sqlite/prechecks.ts";
import { planMerge } from "../../src/domains/identity/index.ts";
import { getEntity, listEvents } from "../../src/domains/identity/sqlite.ts";
import { getHead } from "../../src/domains/assertions/sqlite.ts";
import { getGate } from "../../src/domains/lifecycle/sqlite.ts";
import { getEpoch, readCurrent } from "../../src/domains/projection/sqlite.ts";
import {
	readWorldSnapshot,
	validateWorldUsage,
	type WorldDb,
} from "../../src/sqlite.ts";
import type { TestStore } from "../support/sqlite-store.ts";
import {
	MARKER,
	count,
	forgetChunk,
	leaks,
	markedClaim,
	quantPrediction,
	sourceRoot,
	srcKey,
	states,
} from "./forget-fixture.ts";
import {
	A,
	B,
	access,
	adoptPlan,
	apply,
	claim,
	dump,
	envelope,
	hasher as hasherForTest,
	hostChecks,
	openWorld,
	ref,
	state,
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
const register = (key: string, assertion: unknown) =>
	envelope(
		key,
		{ kind: "assertion.register", assertion },
		{ hostChecks: states() },
	);
/** A normal forget is reopened through the public operation, not the repository. */
const reopen = (store: TestStore, forgetId = "fg-1") => {
	const result = run(
		store,
		envelope(
			`reopen-${forgetId}`,
			{ kind: "forget.reopen", forgetId, externalDeletionConfirmed: true },
			{ hostChecks: states() },
		),
	);
	expect(result.status).toBe("applied");
};
const bScope = {
	scope: B,
	access: access(["scope-b"]),
	hostChecks: hostChecks([state({ scopeKey: "scope-b" })]),
};

describe("1 assertion writes are bound to the envelope Scope", () => {
	test("transition naming another Scope is refused with no change anywhere", () => {
		const store = world();
		run(store, register("a-1", claim({ id: "claim-1" })));
		run(store, {
			...envelope("b-1", {
				kind: "assertion.register",
				assertion: claim({ id: "claim-1", scope: B }),
			}),
			...bScope,
		});
		const before = dump(store);
		const attack = envelope("x-1", {
			kind: "assertion.transition",
			plan: { ...adoptPlan("claim-1", 1), scope: B },
		});
		expect(run(store, attack)).toEqual({
			status: "rejected",
			reasonCode: "SCOPE_MISMATCH",
		});
		expect(dump(store)).toEqual(before);
		store.read((db) => {
			expect(getHead(db, B, "claim-1")?.currentRevision).toBe(1);
		});
	});
	test("register with another Scope in the payload gives the same answer whether or not it exists there", () => {
		const store = world();
		run(store, {
			...envelope("b-1", {
				kind: "assertion.register",
				assertion: claim({ id: "claim-1", scope: B }),
			}),
			...bScope,
		});
		const before = dump(store);
		const existing = run(
			store,
			register("x-1", claim({ id: "claim-1", scope: B })),
		);
		const missing = run(
			store,
			register("x-2", claim({ id: "claim-zzz", scope: B })),
		);
		expect(existing).toEqual({
			status: "rejected",
			reasonCode: "SCOPE_MISMATCH",
		});
		expect(missing).toEqual(existing);
		expect(dump(store)).toEqual(before);
	});
	test("an inconsistent transition plan is refused before any DML", () => {
		const store = world();
		run(store, register("a-1", claim()));
		const before = dump(store);
		for (const tweak of [
			{ to: "disputed" },
			{ from: "active" },
			{ nextLifecycle: "retracted" },
			{ nextRevision: 5 },
			{ action: "nonsense" },
		]) {
			const result = run(
				store,
				envelope("x-1", {
					kind: "assertion.transition",
					plan: { ...adoptPlan("claim-1", 1), ...tweak },
				}),
			);
			expect(result.status).toBe("rejected");
		}
		expect(dump(store)).toEqual(before);
		store.read((db) => {
			expect(
				precheckTransitionPlan(db, A, adoptPlan("claim-1", 1), undefined),
			).toBeNull();
		});
	});
});

describe("2 a completed forget accepts no more roots", () => {
	function twoClaims(store: TestStore) {
		run(store, register("r-1", markedClaim("c1", 1)));
		run(store, register("r-2", markedClaim("c2", 2)));
	}
	test("later chunk of a complete forgetId is rejected and erases nothing", () => {
		const store = world();
		twoClaims(store);
		const first = run(store, forgetChunk("f-1", "fg-1", [sourceRoot(1)]));
		expect(first.status).toBe("applied");
		const before = dump(store);
		const second = run(store, forgetChunk("f-2", "fg-1", [sourceRoot(2)]));
		expect(second).toEqual({
			status: "rejected",
			reasonCode: "FORGET_ALREADY_COMPLETE",
		});
		expect(dump(store)).toEqual(before);
		expect(count(store, "world_assertion")).toBe(1);
		// exact replay of the first chunk is still a no_op
		expect(run(store, forgetChunk("f-1", "fg-1", [sourceRoot(1)])).status).toBe(
			"no_op",
		);
	});
	test("empty roots on a new forgetId are invalid and leave the gate alone", () => {
		const store = world();
		twoClaims(store);
		const before = dump(store);
		expect(run(store, forgetChunk("f-1", "fg-9", []))).toEqual({
			status: "rejected",
			reasonCode: "INVALID_INPUT",
		});
		expect(dump(store)).toEqual(before);
	});
});

describe("3 and 4 forgetting merged entities", () => {
	function twoEntities(store: TestStore, secret = false) {
		for (const [id, name, aliases] of [
			["e-1", "alpha", ["alpha-alias"]],
			["e-2", secret ? MARKER : "beta", secret ? [`${MARKER}-alias`] : []],
		] as const)
			expect(
				run(
					store,
					envelope(`reg-${id}`, {
						kind: "entity.register",
						entity: { id, displayName: name, aliases, externalRefs: [] },
					}),
				).status,
			).toBe("applied");
		const plan = store.read((db) => {
			const planned = planMerge({
				scope: A,
				operationId: "merge-1",
				representativeId: "e-1",
				targetIds: ["e-1", "e-2"],
				expectedRevisions: { "e-1": 1, "e-2": 1 },
				evidence: ["ev"],
				entities: [getEntity(db, A, "e-1")!, getEntity(db, A, "e-2")!],
			});
			if (!planned.ok || planned.value.status !== "planned")
				throw new Error("plan");
			return planned.value.plan;
		});
		expect(
			run(store, envelope("merge", { kind: "entity.merge", plan })).status,
		).toBe("applied");
	}
	test("3: forgetting the representative takes its members along and completes", () => {
		const store = world();
		twoEntities(store);
		const result = run(
			store,
			forgetChunk("f-1", "fg-1", [{ kind: "entity", id: "e-1", revision: 1 }]),
		);
		expect(result).toMatchObject({
			status: "applied",
			forget: { state: "complete", pending: 0 },
		});
		expect(count(store, "world_entity")).toBe(0);
		expect(count(store, "world_alias")).toBe(0);
		expect(count(store, "world_identity_event")).toBe(0);
		expect(count(store, "world_tombstone")).toBe(2);
	});
	test("4: forgetting a merged member scrubs its text from the representative and events", () => {
		const store = world();
		twoEntities(store, true);
		expect(leaks(store, MARKER).length).toBeGreaterThan(0);
		const result = run(
			store,
			forgetChunk("f-1", "fg-1", [{ kind: "entity", id: "e-2", revision: 1 }]),
		);
		expect(result).toMatchObject({ forget: { state: "complete" } });
		expect(leaks(store, MARKER)).toEqual([]);
		store.read((db) => {
			const rep = getEntity(db, A, "e-1")!;
			expect(rep.displayName).toBe("alpha");
			expect(rep.aliases).toContain("alpha-alias");
			expect(rep.aliases.join()).not.toContain(MARKER);
			expect(rep.revision).toBeGreaterThan(2);
			expect(getEntity(db, A, "e-2")).toBeUndefined();
			expect(JSON.stringify(listEvents(db, A, 10))).not.toContain(MARKER);
		});
	});
});

describe("5 forgotten candidates cannot be received or settled again", () => {
	const feed = {
		scopeKeys: ["scope-a"],
		kind: "conversation",
		cursorRestoreEpoch: "r1",
	};
	const receive = (key: string) =>
		envelope(
			key,
			{
				kind: "inbox.receive",
				feed,
				event: { eventId: "ev-9", seq: 9, payload: { text: MARKER } },
				receivedCursor: "c-9",
			},
			{ hostChecks: states() },
		);
	test("receive and settle after a candidate tombstone are TOMBSTONED", () => {
		const store = world();
		expect(run(store, receive("rcv-1")).status).toBe("applied");
		const gone = run(
			store,
			forgetChunk("f-1", "fg-1", [
				{ kind: "candidate", id: "ev-9", revision: 1 },
			]),
		);
		expect(gone).toMatchObject({ forget: { state: "complete" } });
		reopen(store);
		expect(run(store, receive("rcv-2"))).toEqual({
			status: "rejected",
			reasonCode: "TOMBSTONED",
		});
		const settle = run(
			store,
			envelope(
				"set-1",
				{
					kind: "candidate.settle",
					feed,
					eventId: "ev-9",
					disposition: "held",
					assertions: [],
				},
				{ hostChecks: states() },
			),
		);
		expect(settle).toEqual({ status: "rejected", reasonCode: "TOMBSTONED" });
		expect(count(store, "world_inbox")).toBe(0);
		expect(leaks(store, MARKER)).toEqual([]);
	});
});

describe("6 prediction basis", () => {
	const predict = (key: string, id: string, over: Record<string, unknown>) =>
		envelope(key, {
			kind: "prediction.register",
			input: {
				prediction: quantPrediction(id, `cmp-${id}`),
				dueAt: 5000,
				...over,
			},
		});
	test("unknown basis is refused; tombstoned basis is refused; forget erases every revision", () => {
		const store = world();
		run(store, register("r-1", markedClaim("c1", 1)));
		const before = dump(store);
		expect(
			run(
				store,
				predict("p-0", "pred-0", {
					basis: { assertionId: "nope", revision: 1 },
				}),
			),
		).toEqual({ status: "rejected", reasonCode: "BASIS_NOT_FOUND" });
		expect(dump(store)).toEqual(before);
		const basis = { assertionId: "c1", revision: 1 };
		expect(run(store, predict("p-1", "pred-1", { basis })).status).toBe(
			"applied",
		);
		const rev2 = {
			...quantPrediction("pred-1", "cmp-pred-1"),
			revision: 2,
			measurementTolerance: 3,
		};
		expect(
			run(
				store,
				envelope("p-2", {
					kind: "prediction.register",
					input: { prediction: rev2, dueAt: 5000, basis },
				}),
			).status,
		).toBe("applied");
		expect(count(store, "world_prediction")).toBe(2);
		run(store, forgetChunk("f-1", "fg-1", [sourceRoot(1)]));
		expect(count(store, "world_prediction")).toBe(0);
		reopen(store);
		expect(run(store, predict("p-3", "pred-3", { basis }))).toEqual({
			status: "rejected",
			reasonCode: "TOMBSTONED",
		});
	});
});

describe("7 forget keeps the projection equal to a rebuild, incrementally", () => {
	test("projection rows, refutations and digest match a full rebuild after forget", () => {
		const store = world();
		run(store, register("r-t", markedClaim("t", 1, [1], false)));
		run(
			store,
			register(
				"r-x",
				markedClaim("x", 2, [2], false, {
					contradicts: [{ id: "t", revision: 1 }],
				}),
			),
		);
		run(store, register("r-y", markedClaim("y", 3, [3], false)));
		run(store, forgetChunk("f-1", "fg-1", [sourceRoot(2)]));
		reopen(store);
		const snapshot = () =>
			store.read((db) => ({
				current: readCurrent(db, A, { limit: 100 }),
				epoch: getEpoch(db, A),
			}));
		const incremental = snapshot();
		expect(JSON.stringify(incremental.current)).not.toContain('"x"');
		const rebuilt = run(
			store,
			envelope("rb", { kind: "rebuild" }, { hostChecks: states() }),
		);
		expect(rebuilt.status).toBe("applied");
		const full = snapshot();
		expect(full.current).toEqual(incremental.current);
		expect(full.epoch?.materialDigest).toBe(incremental.epoch?.materialDigest);
		expect(full.epoch?.epoch).toBe(incremental.epoch?.epoch);
	});
});

describe("7b a ledger beyond the ceiling is refused before any rebuild DML", () => {
	test("rebuildProjection throws LedgerTooLargeError and leaves the projection untouched", () => {
		const store = world();
		run(store, register("r-1", markedClaim("c1", 1)));
		run(store, register("r-2", markedClaim("c2", 2)));
		const before = dump(store);
		const context = {
			hasher: hasherForTest,
			clock: 1,
			hostChecks: hostChecks(),
		};
		expect(() =>
			store.write((db) => rebuildProjection(db, A, context as never, 1)),
		).toThrow(LedgerTooLargeError);
		expect(dump(store)).toEqual(before);
	});
});

describe("8 a forget during a restore keeps the restore gate reason", () => {
	test("restore.register still works after an interleaved forget", () => {
		const store = world();
		run(store, register("r-1", markedClaim("c1", 1)));
		run(store, register("r-2", markedClaim("c2", 2)));
		const host = { ...states(2), restoreEpoch: "r2" };
		const step = (key: string, operation: unknown) =>
			run(store, envelope(key, operation, { hostChecks: host }));
		expect(step("rs-1", { kind: "restore.begin" }).status).toBe("applied");
		const during = step("fg-op", {
			kind: "forget.chunk",
			forgetId: "fg-1",
			reasonCode: "FORGET_REQUESTED",
			roots: [sourceRoot(2)],
		});
		expect(during.status).toBe("applied");
		store.read((db) => {
			expect(getGate(db, A)).toMatchObject({
				state: "closed",
				reasonCode: "RESTORE_IN_PROGRESS",
			});
		});
		const registered = step("rs-2", {
			kind: "restore.register",
			registrations: [{ sourceKey: srcKey(1), status: "registered" }],
		});
		expect(registered.status).toBe("applied");
	});
});

describe("9 foreseeable bad input is rejected before any DML", () => {
	test("duplicate evidence id and conflicting input revisions", () => {
		const store = world();
		const evidence = claim().evidence[0]!;
		const before = dump(store);
		expect(
			run(
				store,
				register("d-1", claim({ evidence: [evidence, { ...evidence }] })),
			),
		).toEqual({ status: "rejected", reasonCode: "DUPLICATE_EVIDENCE" });
		expect(dump(store)).toEqual(before);
		expect(
			precheckAssertionRows(
				claim({ inputManifest: [ref(), ref({ revision: "rev-2" })] }),
			),
		).toEqual({
			status: "rejected",
			reasonCode: "CONFLICTING_INPUT_REVISIONS",
		});
		// settle: manifest dependencies are part of every assertion's inputs
		expect(
			precheckAssertionRows(claim(), [ref({ revision: "rev-2" })]),
		).toEqual({
			status: "rejected",
			reasonCode: "CONFLICTING_INPUT_REVISIONS",
		});
	});
});

describe("10 source guards", () => {
	test("only available (or changed -> mismatch) states pass", () => {
		const store = world();
		const odd = run(
			store,
			envelope(
				"o-1",
				{ kind: "assertion.register", assertion: claim() },
				{
					hostChecks: hostChecks([state({ status: "weird" })]),
				},
			),
		);
		expect(odd).toEqual({
			status: "rejected",
			reasonCode: "SOURCE_NOT_AVAILABLE",
		});
		const changed = run(
			store,
			envelope(
				"o-2",
				{ kind: "assertion.register", assertion: claim() },
				{
					hostChecks: hostChecks([state({ status: "changed" })]),
				},
			),
		);
		expect(changed).toEqual({
			status: "rejected",
			reasonCode: "SOURCE_VERSION_MISMATCH",
		});
		expect(count(store, "world_assertion")).toBe(0);
	});
	test("a source forgotten as kind 'state' blocks later registration", () => {
		const store = world();
		run(store, register("r-1", markedClaim("c1", 1)));
		run(
			store,
			forgetChunk("f-1", "fg-1", [
				{ kind: "state", id: srcKey(1), revision: 1 },
			]),
		);
		reopen(store);
		expect(run(store, register("r-2", markedClaim("c9", 1)))).toEqual({
			status: "rejected",
			reasonCode: "TOMBSTONED",
		});
	});
});

describe("12 schema compatibility gate", () => {
	const tamper = (store: TestStore, sql: string) =>
		store.write((db: WorldDb) => {
			db.exec(sql);
		});
	test("hash mismatch, future schema and missing migration all block every entry point", () => {
		for (const sql of [
			"UPDATE world_schema_info SET sha256 = '" +
				"0".repeat(64) +
				"' WHERE ordinal = 3",
			"INSERT INTO world_schema_info (ordinal, migration_id, sha256) VALUES (99, 'future-001', '" +
				"a".repeat(64) +
				"')",
			"DELETE FROM world_schema_info WHERE ordinal = 7",
		]) {
			const store = world();
			tamper(store, sql);
			const blocked = {
				status: "blocked",
				reasonCode: "SCHEMA_INCOMPATIBLE",
			} as const;
			expect(run(store, register("s-1", claim()))).toEqual(blocked);
			expect(count(store, "world_assertion")).toBe(0);
			store.write((db) => {
				expect(readWorldSnapshot(db, {})).toEqual(blocked);
				expect(validateWorldUsage(db, {}, {})).toEqual(blocked as never);
			});
		}
	});
	test("a current schema passes through", () => {
		const store = world();
		expect(run(store, register("s-1", claim())).status).toBe("applied");
	});
});
