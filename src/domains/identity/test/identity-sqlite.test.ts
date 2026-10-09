import { describe, expect, test } from "bun:test";
import type { WorldDb } from "../../../infrastructure/sqlite/db.ts";
import { WorldTransactionRequiredError } from "../../../infrastructure/sqlite/db.ts";
import { openTestStore } from "../../../../test/support/sqlite-store.ts";
import { planMerge, planSplit } from "../index.ts";
import type { MergePlan, SplitPlan } from "../index.ts";
import {
	applyMergePlan,
	applySplitPlan,
	deleteEntities,
	findAliasCandidates,
	getEntity,
	listEvents,
	registerEntity,
} from "../sqlite.ts";

const A = { principal: "p-a", scopeKey: "scope-a" };
const B = { principal: "p-a", scopeKey: "scope-b" };
const named = (id: string, displayName: string, aliases: string[] = []) => ({
	id,
	displayName,
	aliases,
	externalRefs: [],
});
const count = (db: WorldDb, table: string) =>
	(db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const snapshot = (db: WorldDb) => ({
	entity: db.query("SELECT * FROM world_entity ORDER BY scope_key, id").all(),
	alias: db
		.query(
			"SELECT * FROM world_alias ORDER BY scope_key, alias_norm, entity_id",
		)
		.all(),
	event: db
		.query("SELECT * FROM world_identity_event ORDER BY scope_key, event_id")
		.all(),
});

for (const mode of ["file", "memory"] as const) {
	describe(`identity repository (${mode})`, () => {
		test("A07 same name in two scopes never leaks; two candidates stay ambiguous", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					expect(
						registerEntity(db, A, named("e-1", "音声サービス")).status,
					).toBe("applied");
					expect(
						registerEntity(db, A, named("e-2", "音声サービス")).status,
					).toBe("applied");
					expect(
						registerEntity(db, B, named("e-1", "音声サービス")).status,
					).toBe("applied");
				});
				store.read((db) => {
					expect(findAliasCandidates(db, A, "  音声サービス ", 10)).toEqual({
						entityIds: ["e-1", "e-2"],
						truncated: false,
					});
					expect(
						findAliasCandidates(db, B, "音声サービス", 10).entityIds,
					).toEqual(["e-1"]);
					expect(
						findAliasCandidates(
							db,
							{ ...A, scopeKey: "none" },
							"音声サービス",
							10,
						),
					).toEqual({
						entityIds: [],
						truncated: false,
					});
					// limit+1 sentinel
					expect(findAliasCandidates(db, A, "音声サービス", 1)).toEqual({
						entityIds: ["e-1"],
						truncated: true,
					});
					expect(getEntity(db, B, "e-2")).toBeUndefined();
					expect(getEntity(db, A, "e-1")?.revision).toBe(1);
				});
			} finally {
				store.close();
			}
		});

		test("A07/A23 merge then split restores the original alias mapping through the DB", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					registerEntity(db, A, named("e-1", "音声サービス", ["voice"]));
					registerEntity(db, A, named("e-2", "ASR", ["asr-svc"]));
				});
				const merge = store.write((db) => {
					const entities = [getEntity(db, A, "e-1")!, getEntity(db, A, "e-2")!];
					const planned = planMerge({
						scope: A,
						operationId: "merge-1",
						representativeId: "e-1",
						targetIds: ["e-1", "e-2"],
						expectedRevisions: { "e-1": 1, "e-2": 1 },
						evidence: ["ev-1"],
						entities,
					});
					if (!planned.ok || planned.value.status !== "planned")
						throw new Error("plan");
					const result = applyMergePlan(db, A, planned.value.plan);
					return { result, plan: planned.value.plan as MergePlan };
				});
				expect(merge.result.status).toBe("applied");
				store.read((db) => {
					expect(getEntity(db, A, "e-2")).toMatchObject({
						revision: 2,
						mergedInto: "e-1",
					});
					expect(findAliasCandidates(db, A, "asr-svc", 5).entityIds).toEqual([
						"e-1",
					]);
					expect(findAliasCandidates(db, A, "ASR", 5).entityIds).toEqual([
						"e-1",
					]);
					expect(listEvents(db, A, 10).events.map((e) => e.kind)).toEqual([
						"merge",
					]);
				});
				// replay of the same operation is refused, nothing changes
				store.write((db) => {
					const before = snapshot(db);
					expect(applyMergePlan(db, A, merge.plan)).toEqual({
						status: "rejected",
						reasonCode: "OPERATION_EXISTS",
					});
					expect(snapshot(db)).toEqual(before);
				});
				const split = store.write((db) => {
					const history = listEvents(db, A, 10).events.filter(
						(e): e is MergePlan => e.kind === "merge",
					);
					const entities = [getEntity(db, A, "e-1")!, getEntity(db, A, "e-2")!];
					const planned = planSplit({
						scope: A,
						operationId: "split-1",
						mergeOperationId: "merge-1",
						expectedRevision: 2,
						history,
						splitMergeOperationIds: [],
						entities,
					});
					if (!planned.ok || planned.value.status !== "planned")
						throw new Error("plan");
					return {
						result: applySplitPlan(db, A, planned.value.plan),
						plan: planned.value.plan as SplitPlan,
					};
				});
				expect(split.result.status).toBe("applied");
				store.read((db) => {
					expect(findAliasCandidates(db, A, "asr-svc", 5).entityIds).toEqual([
						"e-2",
					]);
					expect(findAliasCandidates(db, A, "ASR", 5).entityIds).toEqual([
						"e-2",
					]);
					expect(findAliasCandidates(db, A, "voice", 5).entityIds).toEqual([
						"e-1",
					]);
					const e1 = getEntity(db, A, "e-1")!;
					expect(e1.aliases).toEqual(["voice"]);
					expect(e1.revision).toBe(3);
					expect(getEntity(db, A, "e-2")).toMatchObject({
						revision: 3,
						aliases: ["asr-svc"],
					});
					expect(getEntity(db, A, "e-2")?.mergedInto).toBeUndefined();
					expect(listEvents(db, A, 10).events.map((e) => e.kind)).toEqual([
						"merge",
						"split",
					]);
				});
				// the merge cannot be split twice
				store.write((db) => {
					const before = snapshot(db);
					expect(
						applySplitPlan(db, A, { ...split.plan, operationId: "split-2" }),
					).toMatchObject({
						status: "rejected",
					});
					expect(snapshot(db)).toEqual(before);
				});
			} finally {
				store.close();
			}
		});

		test("stale revision is rejected and leaves no row changed", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					registerEntity(db, A, named("e-1", "A"));
					registerEntity(db, A, named("e-2", "B"));
				});
				const plan = store.read((db) => {
					const planned = planMerge({
						scope: A,
						operationId: "m-1",
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
				store.write((db) => {
					// another writer bumps e-2 first (a different merge applied meanwhile)
					db.query(
						"UPDATE world_entity SET revision = 2 WHERE principal = ? AND scope_key = ? AND id = 'e-2'",
					).run(A.principal, A.scopeKey);
				});
				store.write((db) => {
					const before = snapshot(db);
					expect(applyMergePlan(db, A, plan)).toEqual({
						status: "rejected",
						reasonCode: "REVISION_CONFLICT",
					});
					expect(snapshot(db)).toEqual(before);
					// wrong scope for the plan
					expect(applyMergePlan(db, B, plan)).toMatchObject({
						status: "rejected",
					});
					expect(snapshot(db)).toEqual(before);
				});
			} finally {
				store.close();
			}
		});

		test("A21 writes outside a transaction throw WorldTransactionRequiredError", () => {
			const store = openTestStore({ mode });
			try {
				const bare = {
					inTransaction: false,
					exec: () => {},
					query: () => {
						throw new Error("must not reach SQL");
					},
				} as unknown as WorldDb;
				expect(() => registerEntity(bare, A, named("e-1", "x"))).toThrow(
					WorldTransactionRequiredError,
				);
				expect(() => deleteEntities(bare, A, ["e-1"])).toThrow(
					WorldTransactionRequiredError,
				);
				const missing = {
					exec: () => {},
					query: () => ({}),
				} as unknown as WorldDb;
				expect(() => registerEntity(missing, A, named("e-1", "x"))).toThrow(
					WorldTransactionRequiredError,
				);
				expect(store.read((db) => count(db, "world_entity"))).toBe(0);
			} finally {
				store.close();
			}
		});

		test("A21 schema constraints reject NULL scope, bad enum, duplicate PK and cross-scope references", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					registerEntity(db, A, named("e-1", "x"));
					registerEntity(db, B, named("e-9", "y"));
				});
				const attempt = (sql: string, ...params: (string | number | null)[]) =>
					expect(() =>
						store.write((db) => {
							db.query(sql).run(...params);
						}),
					).toThrow();
				const entity =
					"INSERT INTO world_entity (principal, scope_key, id, revision, status, merged_into, payload_json) VALUES (?, ?, ?, ?, ?, ?, '{}')";
				attempt(entity, null, "s", "e-x", 1, "active", null);
				attempt(entity, "p-a", null, "e-x", 1, "active", null);
				attempt(entity, "p-a", "scope-a", "e-x", 1, "bogus", null);
				attempt(entity, "p-a", "scope-a", "e-x", 0, "active", null);
				attempt(entity, "p-a", "scope-a", "e-1", 1, "active", null);
				attempt(entity, "p-a", "scope-a", "e-x", 1, "merged", "e-9"); // e-9 lives in scope-b
				attempt(
					"INSERT INTO world_alias (principal, scope_key, alias_norm, entity_id, alias_original) VALUES (?, ?, 'x', ?, 'x')",
					"p-a",
					"scope-a",
					"e-9",
				);
				attempt(
					"INSERT INTO world_identity_event (principal, scope_key, event_id, kind, operation_id, revision, payload_json) VALUES ('p-a', 'scope-a', 'ev', 'rename', 'o', 1, '{}')",
				);
				expect(store.read((db) => count(db, "world_entity"))).toBe(2);
			} finally {
				store.close();
			}
		});

		test("A23 an exception after partial DML rolls back every identity table", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					registerEntity(db, A, named("e-1", "A"));
					registerEntity(db, A, named("e-2", "B"));
				});
				const before = store.read(snapshot);
				expect(() =>
					store.write((db) => {
						const planned = planMerge({
							scope: A,
							operationId: "m-1",
							representativeId: "e-1",
							targetIds: ["e-1", "e-2"],
							expectedRevisions: { "e-1": 1, "e-2": 1 },
							evidence: ["ev"],
							entities: [getEntity(db, A, "e-1")!, getEntity(db, A, "e-2")!],
						});
						if (!planned.ok || planned.value.status !== "planned")
							throw new Error("plan");
						expect(applyMergePlan(db, A, planned.value.plan).status).toBe(
							"applied",
						);
						registerEntity(db, A, named("e-3", "C"));
						throw new Error("host failure after World update");
					}),
				).toThrow("host failure");
				expect(store.read(snapshot)).toEqual(before);
			} finally {
				store.close();
			}
		});

		test("forget: deleteEntities removes rows, aliases and involved events; refuses to strand members", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					registerEntity(db, A, named("e-1", "音声サービス", ["voice"]));
					registerEntity(db, A, named("e-2", "ASR"));
					registerEntity(db, A, named("e-3", "他"));
					registerEntity(db, B, named("e-1", "音声サービス"));
					const planned = planMerge({
						scope: A,
						operationId: "m-1",
						representativeId: "e-1",
						targetIds: ["e-1", "e-2"],
						expectedRevisions: { "e-1": 1, "e-2": 1 },
						evidence: ["ev"],
						entities: [getEntity(db, A, "e-1")!, getEntity(db, A, "e-2")!],
					});
					if (!planned.ok || planned.value.status !== "planned")
						throw new Error("plan");
					applyMergePlan(db, A, planned.value.plan);
				});
				store.write((db) => {
					const before = snapshot(db);
					expect(deleteEntities(db, A, ["e-1"])).toEqual({
						status: "rejected",
						reasonCode: "ENTITY_REFERENCED",
					});
					expect(snapshot(db)).toEqual(before);
				});
				const result = store.write((db) =>
					deleteEntities(db, A, ["e-1", "e-2"]),
				);
				expect(result).toEqual({
					status: "applied",
					deletedEntities: 2,
					deletedEvents: 1,
				});
				store.read((db) => {
					expect(getEntity(db, A, "e-1")).toBeUndefined();
					expect(getEntity(db, A, "e-3")).toBeDefined();
					expect(getEntity(db, B, "e-1")).toBeDefined(); // other scope untouched
					const dump =
						JSON.stringify(
							snapshot(db).entity.filter(
								(r) => (r as { scope_key: string }).scope_key === "scope-a",
							),
						) +
						JSON.stringify(
							snapshot(db).alias.filter(
								(r) => (r as { scope_key: string }).scope_key === "scope-a",
							),
						) +
						JSON.stringify(snapshot(db).event);
					expect(dump).not.toContain("voice");
					expect(dump).not.toContain("ASR");
					expect(listEvents(db, A, 10).events).toEqual([]);
				});
			} finally {
				store.close();
			}
		});

		test("invalid input is rejected before any DML", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					expect(registerEntity(db, A, { ...named("", "x") })).toMatchObject({
						status: "rejected",
					});
					expect(
						registerEntity(
							db,
							{ principal: "", scopeKey: "s" },
							named("e", "x"),
						),
					).toMatchObject({
						status: "rejected",
					});
					expect(registerEntity(db, A, named("e-1", "x")).status).toBe(
						"applied",
					);
					expect(registerEntity(db, A, named("e-1", "y"))).toEqual({
						status: "rejected",
						reasonCode: "ENTITY_EXISTS",
					});
					expect(count(db, "world_entity")).toBe(1);
				});
			} finally {
				store.close();
			}
		});
	});
}
