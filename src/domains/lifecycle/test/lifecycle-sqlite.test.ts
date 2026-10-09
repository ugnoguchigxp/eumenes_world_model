import { describe, expect, test } from "bun:test";
import type { WorldDb } from "../../../infrastructure/sqlite/db.ts";
import { WorldTransactionRequiredError } from "../../../infrastructure/sqlite/db.ts";
import { openTestStore } from "../../../../test/support/sqlite-store.ts";
import {
	closeGate,
	getGate,
	getOperation,
	getTombstone,
	insertTombstone,
	isGateOpen,
	listTombstones,
	openGate,
	recordOperation,
} from "../sqlite.ts";

const A = { principal: "p-a", scopeKey: "scope-a" };
const B = { principal: "p-a", scopeKey: "scope-b" };
const digest = `sha256:${"a".repeat(64)}`;
const record = (key: string, over: object = {}) => ({
	operationKey: key,
	kind: "assertion.register",
	payloadDigest: digest,
	canonicalVersion: 1,
	resultStatus: "applied" as const,
	receiptRef: `receipt-${key}`,
	...over,
});
const count = (db: WorldDb, table: string) =>
	(db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

for (const mode of ["file", "memory"] as const) {
	describe(`lifecycle repository (${mode})`, () => {
		test("gate: absent row is open; close/reopen per Scope; idempotent close", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					expect(isGateOpen(db, A)).toBe(true);
					expect(getGate(db, A)).toBeUndefined();
					closeGate(db, A, {
						reasonCode: "FORGET_PENDING",
						restoreEpoch: "r1",
					});
					closeGate(db, A, {
						reasonCode: "FORGET_PENDING",
						restoreEpoch: "r1",
					});
					expect(isGateOpen(db, A)).toBe(false);
					expect(isGateOpen(db, B)).toBe(true);
					expect(count(db, "world_scope_gate")).toBe(1);
					openGate(db, A, { restoreEpoch: "r2" });
					expect(isGateOpen(db, A)).toBe(true);
					expect(getGate(db, A)?.restoreEpoch).toBe("r2");
				});
			} finally {
				store.close();
			}
		});
		test("operations: receipt keeps digest only; reused key is rejected, never overwritten", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					expect(recordOperation(db, A, record("op-1")).status).toBe("applied");
					expect(getOperation(db, A, "op-1")?.payloadDigest).toBe(digest);
					expect(
						recordOperation(
							db,
							A,
							record("op-1", { payloadDigest: `sha256:${"b".repeat(64)}` }),
						),
					).toEqual({
						status: "rejected",
						reasonCode: "OPERATION_KEY_EXISTS",
					});
					expect(getOperation(db, A, "op-1")?.payloadDigest).toBe(digest);
					// Same key in another Scope is independent.
					expect(recordOperation(db, B, record("op-1")).status).toBe("applied");
					expect(getOperation(db, B, "op-9")).toBeUndefined();
					for (const bad of [
						record("op-2", { payloadDigest: "not-a-digest" }),
						record("op-2", { canonicalVersion: 0 }),
						record("op-2", { resultStatus: "maybe" }),
						record("", {}),
					])
						expect(recordOperation(db, A, bad).status).toBe("rejected");
				});
			} finally {
				store.close();
			}
		});
		test("tombstones: enum reason, idempotent, conflict on rewrite, Scope isolated, bounded lookup", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					const t = {
						kind: "source" as const,
						id: "src-1",
						forgetId: "f-1",
						reasonCode: "SOURCE_FORGOTTEN" as const,
					};
					expect(insertTombstone(db, A, t).status).toBe("inserted");
					expect(insertTombstone(db, A, t).status).toBe("unchanged");
					expect(insertTombstone(db, A, { ...t, forgetId: "f-2" })).toEqual({
						status: "rejected",
						reasonCode: "TOMBSTONE_CONFLICT",
					});
					expect(getTombstone(db, B, t)).toBeUndefined();
					expect(
						listTombstones(db, A, [t, { kind: "entity", id: "x" }]).length,
					).toBe(1);
					expect(
						insertTombstone(db, A, {
							...t,
							id: "src-2",
							reasonCode: "FREE TEXT" as never,
						}).status,
					).toBe("rejected");
					expect(
						insertTombstone(db, A, {
							...t,
							id: "src-2",
							kind: "nonsense" as never,
						}).status,
					).toBe("rejected");
					expect(() =>
						listTombstones(
							db,
							A,
							Array.from({ length: 501 }, () => t),
						),
					).toThrow();
				});
			} finally {
				store.close();
			}
		});
		test("writes outside a transaction throw; constraints reject NULL scope, bad enum, duplicate PK (A21)", () => {
			const store = openTestStore({ mode });
			try {
				const raw = {
					inTransaction: false,
					exec: () => undefined,
					query: () => {
						throw new Error("must not run");
					},
				} as unknown as WorldDb;
				expect(() => recordOperation(raw, A, record("op-x"))).toThrow(
					WorldTransactionRequiredError,
				);
				expect(() =>
					closeGate(raw, A, { reasonCode: "R", restoreEpoch: "e" }),
				).toThrow(WorldTransactionRequiredError);
				expect(() =>
					insertTombstone(raw, A, {
						kind: "source",
						id: "s",
						forgetId: "f",
						reasonCode: "SOURCE_FORGOTTEN",
					}),
				).toThrow(WorldTransactionRequiredError);
				store.write((db) => {
					const insert =
						(sql: string, ...params: (string | number | null)[]) =>
						() =>
							db.query(sql).run(...params);
					expect(
						insert(
							"INSERT INTO world_scope_gate (principal, scope_key, state, reason_code, restore_epoch) VALUES (?, ?, 'open', 'r', 'e')",
							null,
							"s",
						),
					).toThrow();
					expect(
						insert(
							"INSERT INTO world_scope_gate (principal, scope_key, state, reason_code, restore_epoch) VALUES (?, ?, 'ajar', 'r', 'e')",
							"p",
							"s",
						),
					).toThrow();
					expect(
						insert(
							"INSERT INTO world_tombstone (principal, scope_key, kind, id, forget_id, reason_code) VALUES (?, ?, 'source', 'i', 'f', 'free text')",
							"p",
							"s",
						),
					).toThrow();
					db.query(
						"INSERT INTO world_scope_gate (principal, scope_key, state, reason_code, restore_epoch) VALUES ('p', 's', 'open', 'r', 'e')",
					).run();
					expect(
						insert(
							"INSERT INTO world_scope_gate (principal, scope_key, state, reason_code, restore_epoch) VALUES (?, ?, 'open', 'r', 'e')",
							"p",
							"s",
						),
					).toThrow();
				});
			} finally {
				store.close();
			}
		});
		test("a throw inside the host transaction rolls back gate, receipt and tombstone together (A23, repository level)", () => {
			const store = openTestStore({ mode });
			try {
				expect(() =>
					store.write((db) => {
						closeGate(db, A, { reasonCode: "R", restoreEpoch: "e" });
						recordOperation(db, A, record("op-1"));
						insertTombstone(db, A, {
							kind: "source",
							id: "s",
							forgetId: "f",
							reasonCode: "SOURCE_FORGOTTEN",
						});
						throw new Error("host failure");
					}),
				).toThrow("host failure");
				store.read((db) => {
					expect(count(db, "world_scope_gate")).toBe(0);
					expect(count(db, "world_operation")).toBe(0);
					expect(count(db, "world_tombstone")).toBe(0);
				});
			} finally {
				store.close();
			}
		});
	});
}
