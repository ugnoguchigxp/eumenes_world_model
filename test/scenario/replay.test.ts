import { describe, expect, test } from "bun:test";
import {
	closeGate,
	insertTombstone,
} from "../../src/domains/lifecycle/sqlite.ts";
import {
	A,
	NOW,
	adopt,
	apply,
	claim,
	dump,
	hostChecks,
	openWorld,
	probe,
	registerClaim,
	state,
} from "./world-fixture.ts";

describe("A26 replay after a lost response", () => {
	test("same operationKey + same content => no_op, nothing changes, same receipt", () => {
		const store = openWorld();
		try {
			const first = store.write((db) => {
				probe(db);
				return apply(db, registerClaim("op-1"));
			});
			expect(first.status).toBe("applied");
			const before = dump(store);
			// Response lost: the host resends. Clock and host snapshot may differ.
			const again = store.write((db) =>
				apply(db, {
					...registerClaim("op-1"),
					clock: NOW + 99_000,
					hostChecks: { ...hostChecks(), forgetEpoch: "f1" },
				}),
			);
			expect(again.status).toBe("no_op");
			expect(first.status === "applied" && again.status === "no_op").toBe(true);
			if (first.status !== "applied" || again.status !== "no_op")
				throw new Error("unexpected status");
			expect(again.receipt).toEqual(first.receipt);
			expect(dump(store)).toEqual(before);
			expect(before["world_assertion"]).toHaveLength(1);
			expect(before["world_scope_epoch"]).toEqual(
				dump(store)["world_scope_epoch"],
			);
		} finally {
			store.close();
		}
	});

	test("same key with different content => OPERATION_KEY_CONFLICT and no change", () => {
		const store = openWorld();
		try {
			store.write((db) => apply(db, registerClaim("op-1")));
			const before = dump(store);
			const result = store.write((db) =>
				apply(db, registerClaim("op-1", { predicate: "different" })),
			);
			expect(result).toEqual({
				status: "rejected",
				reasonCode: "OPERATION_KEY_CONFLICT",
			});
			expect(dump(store)).toEqual(before);
		} finally {
			store.close();
		}
	});

	test("the operation's own advanced expectedRevision does not block its resend; a NEW key does conflict", () => {
		const store = openWorld();
		try {
			store.write((db) => {
				apply(db, registerClaim("op-1"));
				expect(apply(db, adopt("op-2")).status).toBe("applied");
			});
			const before = dump(store);
			expect(before["world_assertion_head"]).toEqual([
				expect.objectContaining({ current_revision: 2 }),
			]);
			// Resend of op-2: head is already revision 2 but this is the same operation.
			expect(store.write((db) => apply(db, adopt("op-2"))).status).toBe(
				"no_op",
			);
			// A different operation based on the stale revision 1 is a conflict.
			expect(store.write((db) => apply(db, adopt("op-3")))).toEqual({
				status: "rejected",
				reasonCode: "REVISION_CONFLICT",
			});
			expect(dump(store)).toEqual(before);
		} finally {
			store.close();
		}
	});

	test("a resend re-checks the current state: forgotten content is never answered, gate/source changes block", () => {
		const store = openWorld();
		try {
			store.write((db) => apply(db, registerClaim("op-1")));
			// Source later changed in the host snapshot: the resend is refused, not trusted.
			store.write((db) => {
				expect(
					apply(db, {
						...registerClaim("op-1"),
						hostChecks: hostChecks([state({ status: "forgotten" })]),
					}),
				).toEqual({ status: "rejected", reasonCode: "SOURCE_NOT_AVAILABLE" });
			});
			// Scope gate closed (e.g. forget pending).
			store.write((db) => {
				closeGate(db, A, { reasonCode: "FORGET_PENDING", restoreEpoch: "r1" });
				expect(apply(db, registerClaim("op-1"))).toEqual({
					status: "blocked",
					reasonCode: "GATE_CLOSED",
				});
			});
			// Gate reopened but the target is tombstoned: no payload, no receipt.
			store.write((db) => {
				closeGate(db, A, { reasonCode: "x", restoreEpoch: "r1" });
			});
			store.write((db) => {
				db.query("DELETE FROM world_scope_gate").run();
				insertTombstone(db, A, {
					kind: "assertion",
					id: "claim-1",
					forgetId: "forget-1",
					reasonCode: "FORGET_REQUESTED",
				});
				const result = apply(db, registerClaim("op-1"));
				expect(result).toEqual({
					status: "rejected",
					reasonCode: "TOMBSTONED",
				});
				expect(JSON.stringify(result)).not.toContain("claim-1");
				// A brand-new claim cannot re-use the forgotten id either.
				expect(apply(db, registerClaim("op-new")).status).toBe("rejected");
			});
		} finally {
			store.close();
		}
	});

	test("the ledger records the digest only, never the business payload", () => {
		const store = openWorld();
		try {
			store.write((db) => apply(db, registerClaim("op-1")));
			const rows = dump(store)["world_operation"]!;
			expect(rows).toHaveLength(1);
			expect(JSON.stringify(rows)).not.toContain("音声");
			expect(JSON.stringify(rows)).toContain("sha256:");
			expect(claim().id).toBe("claim-1");
		} finally {
			store.close();
		}
	});
});
