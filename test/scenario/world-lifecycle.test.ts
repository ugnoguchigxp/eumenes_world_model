/**
 * P2-10 persistence-stage acceptance (A21-A33, SQL level).
 * One case on a fresh temp file/WAL store:
 *   register entity -> explicit adoption -> Slice -> correction -> old Slice
 *   refused -> forget (chunked to completion) -> restore/rebuild -> gate open.
 * Every step also writes a host_probe row in the SAME transaction.
 *
 * NOT accepted by this file: Eumenes Writer queue, real Memory registration,
 * journal durability (the journal here is a fixture), real models, host wiring.
 */
import { expect, test } from "bun:test";
import {
	buildWorldSlice,
	toSliceReceipt,
} from "../../src/domains/projection/index.ts";
import { getAssertion } from "../../src/domains/assertions/sqlite.ts";
import { getGate } from "../../src/domains/lifecycle/sqlite.ts";
import { getEpoch } from "../../src/domains/projection/sqlite.ts";
import {
	readWorldSnapshot,
	validateWorldUsage,
	type WorldDb,
	type WorldOperationResult,
} from "../../src/sqlite.ts";
import { createJournal } from "../support/restore-fixture.ts";
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
	NOW,
	access,
	adoptPlan,
	apply,
	envelope,
	hasher,
	openWorld,
	probe,
} from "./world-fixture.ts";

const WORLD_TABLES = [
	"world_entity",
	"world_assertion",
	"world_assertion_head",
	"world_transition",
	"world_evidence",
	"world_assertion_input",
	"world_current",
	"world_edge",
	"world_prediction",
	"world_operation",
	"world_tombstone",
];

const hostFor = (epoch: string) => ({ ...states(3), restoreEpoch: epoch });
const read = (store: TestStore) =>
	Object.fromEntries(WORLD_TABLES.map((t) => [t, count(store, t)]));
const epochOf = (store: TestStore) =>
	store.read((db) => getEpoch(db, A)?.epoch ?? 0);
const revisionOf = (store: TestStore, id: string) =>
	store.read((db) => getAssertion(db, A, id)?.revision);

test("A21-A33 world lifecycle: register -> adopt -> Slice -> correct -> forget -> restore", () => {
	const store = openWorld("file");
	const journal = createJournal({ file: true });
	let steps = 0;
	/** One host transaction: probe row first, then the World operation. */
	const step = (
		key: string,
		operation: unknown,
		epoch = "r1",
	): WorldOperationResult => {
		const result = store.write((db: WorldDb) => {
			probe(db);
			return apply(
				db,
				envelope(key, operation, { hostChecks: hostFor(epoch) }),
			);
		});
		steps += 1;
		expect(count(store, "host_probe")).toBe(steps);
		expect(count(store, "host_queue")).toBe(steps);
		return result;
	};
	const sliceReceipt = () =>
		store.read((db) => {
			const result = readWorldSnapshot(db, {
				contractVersion: 1,
				access: access(),
				scope: A,
				asOf: NOW,
				hostChecks: hostFor("r1"),
			});
			if (result.status !== "ready") throw new Error(result.reasonCode);
			const slice = buildWorldSlice(
				{ contractVersion: 1, snapshot: result.snapshot, request: {} },
				hasher,
			);
			if (!slice.ok) throw new Error(slice.code);
			return toSliceReceipt(slice.value);
		});
	const usage = (receipt: unknown, epoch = "r1") =>
		store.write((db) =>
			validateWorldUsage(db, receipt as never, {
				contractVersion: 1,
				access: access(),
				scope: A,
				hostChecks: hostFor(epoch),
			}),
		);
	/** Same operationKey + same content: no_op, nothing grows. */
	const resendIsNoOp = (key: string, operation: unknown, epoch = "r1") => {
		const before = { rows: read(store), epoch: epochOf(store) };
		const again = step(key, operation, epoch);
		expect(again.status).toBe("no_op");
		expect(read(store)).toEqual(before.rows);
		expect(epochOf(store)).toBe(before.epoch);
	};

	try {
		// 1. Entity.
		const entity = {
			kind: "entity.register",
			entity: {
				id: "svc-1",
				displayName: "音声サービス",
				aliases: ["音声"],
				externalRefs: [],
			},
		};
		expect(step("e-1", entity).status).toBe("applied");
		resendIsNoOp("e-1", entity);

		// 2. Explicit adoption. claim-a leaks MARKER and cites src-1; claim-b
		// cites src-2 and must survive the forget of src-1.
		const claimA = {
			kind: "assertion.register",
			assertion: markedClaim("claim-a", 1, [1], true),
		};
		const claimB = {
			kind: "assertion.register",
			assertion: markedClaim("claim-b", 2, [2], false),
		};
		expect(step("c-a", claimA).status).toBe("applied");
		expect(step("c-b", claimB).status).toBe("applied");
		const adoptA = {
			kind: "assertion.transition",
			plan: adoptPlan("claim-a", 1),
		};
		expect(step("ad-a", adoptA).status).toBe("applied");
		expect(revisionOf(store, "claim-a")).toBe(2);
		const prediction = {
			kind: "prediction.register",
			input: {
				prediction: quantPrediction("pred-a", "cmp-a"),
				dueAt: NOW + 1000,
				basis: { assertionId: "claim-a", revision: 2 },
			},
		};
		expect(step("pred-a", prediction).status).toBe("applied");
		// Replays at several points leave revisions, epoch and counts unchanged.
		resendIsNoOp("c-a", claimA);
		resendIsNoOp("ad-a", adoptA);
		resendIsNoOp("pred-a", prediction);
		expect(revisionOf(store, "claim-a")).toBe(2);

		// 3. Slice and its receipt are valid now.
		const receipt = sliceReceipt();
		expect(usage(receipt).status).toBe("valid");
		const epochBefore = epochOf(store);

		// 4. Correction: the old revision stops at once, the old Slice is refused.
		const correction = {
			kind: "invalidate",
			reasonCode: "SOURCE_RETRACTED",
			targets: [{ id: "claim-a", expectedRevision: 2 }],
		};
		expect(step("inv-a", correction).status).toBe("applied");
		expect(store.read((db) => getAssertion(db, A, "claim-a")?.lifecycle)).toBe(
			"invalidated",
		);
		expect(epochOf(store)).toBe(epochBefore + 1);
		expect(usage(receipt).status).toBe("blocked");
		resendIsNoOp("inv-a", correction);
		expect(usage(sliceReceipt()).status).toBe("valid");

		// 5. Forget the cited source, chunked until complete.
		expect(leaks(store, MARKER).length).toBeGreaterThan(0);
		const forget = (key: string) =>
			store.write((db) => {
				probe(db);
				return apply(
					db,
					forgetChunk(key, "forget-1", [sourceRoot(1)], {
						hostChecks: hostFor("r1"),
					}),
				);
			});
		let chunk = forget("f-1");
		steps += 1;
		expect(chunk.status).toBe("applied");
		for (let guard = 0; chunk.status === "applied" && guard < 5; guard++) {
			const forgetState = (chunk as { forget?: { state: string } }).forget;
			if (forgetState?.state === "complete") break;
			chunk = forget(`f-${guard + 2}`);
			steps += 1;
		}
		expect((chunk as { forget?: { state: string } }).forget?.state).toBe(
			"complete",
		);
		expect(count(store, "host_probe")).toBe(steps);
		expect(leaks(store, MARKER)).toEqual([]);
		expect(store.read((db) => getAssertion(db, A, "claim-a"))).toBeUndefined();
		expect(store.read((db) => getAssertion(db, A, "claim-b"))?.id).toBe(
			"claim-b",
		);
		expect(count(store, "world_prediction")).toBe(0);
		expect(count(store, "world_tombstone")).toBeGreaterThan(0);
		// The Scope stays closed until the host restores/reopens it.
		expect(store.read((db) => getGate(db, A))?.state).toBe("closed");
		expect(
			step("late", {
				kind: "assertion.register",
				assertion: markedClaim("claim-z", 1, [1], true),
			}),
		).toEqual({ status: "blocked", reasonCode: "GATE_CLOSED" });
		// Replaying the first forget chunk is a no_op and returns no payload.
		const replay = store.write((db) =>
			apply(
				db,
				forgetChunk("f-1", "forget-1", [sourceRoot(1)], {
					hostChecks: hostFor("r1"),
				}),
			),
		);
		expect(replay.status).toBe("no_op");
		expect(JSON.stringify(replay)).not.toContain(MARKER);

		// 6. Restore/rebuild with the fixture journal, then reopen.
		journal.append([
			{
				ref: { kind: "source", id: srcKey(1), revision: 1 },
				forgetId: "forget-1",
				reasonCode: "FORGET_REQUESTED",
			},
		]);
		const head = journal.head();
		expect(step("rs-b", { kind: "restore.begin" }, "r2").status).toBe(
			"applied",
		);
		expect(store.read((db) => getGate(db, A))?.state).toBe("closed");
		expect(
			step(
				"rs-r",
				{
					kind: "restore.register",
					registrations: [{ sourceKey: srcKey(2), status: "registered" }],
				},
				"r2",
			).status,
		).toBe("applied");
		expect(
			step(
				"rs-j",
				{
					kind: "restore.reconcile",
					journal: { seq: head.seq, final: true, tombstones: head.tombstones },
				},
				"r2",
			).status,
		).toBe("applied");
		const finished = step("rs-f", { kind: "restore.finish" }, "r2");
		expect(finished).toMatchObject({
			status: "applied",
			restore: { state: "complete" },
		});
		expect(store.read((db) => getGate(db, A))).toMatchObject({
			state: "open",
			restoreEpoch: "r2",
		});

		// 7. Normal use resumes; the forgotten source stays forgotten.
		expect(
			step(
				"after-ok",
				{
					kind: "assertion.register",
					assertion: markedClaim("claim-d", 2, [2], false),
				},
				"r2",
			).status,
		).toBe("applied");
		expect(
			step(
				"after-late",
				{
					kind: "assertion.register",
					assertion: markedClaim("claim-y", 1, [1], true),
				},
				"r2",
			),
		).toEqual({ status: "rejected", reasonCode: "TOMBSTONED" });
		const settled = { rows: read(store), epoch: epochOf(store) };
		// Replaying earlier work after the restore changes nothing and returns
		// no forgotten body.
		const late = step("c-b", claimB, "r2");
		expect(["no_op", "rejected", "blocked"]).toContain(late.status);
		expect(read(store)).toEqual(settled.rows);
		expect(epochOf(store)).toBe(settled.epoch);
		expect(JSON.stringify(late)).not.toContain(MARKER);

		// Every step shared its transaction with the host probe, and nothing
		// of the forgotten payload is left in any world_ column.
		expect(count(store, "host_probe")).toBe(steps);
		expect(leaks(store, MARKER)).toEqual([]);
		// Only the opaque ID may remain, and only in the retention tables.
		expect(leaks(store, "claim-a").sort()).toEqual([
			"world_forget_target.id",
			"world_tombstone.id",
		]);
	} finally {
		journal.dispose();
		store.close();
	}
});
