import { describe, expect, test } from "bun:test";
import { WorldTransactionRequiredError } from "../../../infrastructure/sqlite/db.ts";
import { openTestStore } from "../../../../test/support/sqlite-store.ts";
import {
	deleteProjectionFor,
	getEpoch,
	readCurrent,
	readEdgesFrom,
	readEdgesTo,
	replaceProjection,
	type CurrentRow,
	type EdgeRow,
} from "../sqlite.ts";

const A = { principal: "p-a", scopeKey: "scope-a" };
const B = { principal: "p-a", scopeKey: "scope-b" };
const d = (c: string) => `sha256:${c.repeat(64)}`;
const cur = (id: string, subject: string, revision = 1): CurrentRow => ({
	assertionId: id,
	assertionRevision: revision,
	subjectId: subject,
	predicate: "latency",
	lifecycle: "active",
	causalEligible: true,
	payloadJson: JSON.stringify({ id }),
});
const edge = (id: string, from: string, to: string): EdgeRow => ({
	edgeId: id,
	revision: 1,
	fromId: from,
	toId: to,
	relation: "causes",
	assertionId: `claim-${id}`,
	assertionRevision: 1,
	payloadJson: "{}",
});

for (const mode of ["file", "memory"] as const) {
	describe(`projection repository (${mode})`, () => {
		test("A12/A24 replace advances the epoch only on a changed digest; Scopes are isolated", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					expect(
						replaceProjection(db, A, {
							entries: [cur("claim-1", "svc")],
							edges: [edge("e1", "svc", "cache")],
							materialDigest: d("a"),
						}),
					).toEqual({ status: "applied", epoch: 1, changed: true });
					replaceProjection(db, B, {
						entries: [cur("claim-9", "other")],
						edges: [],
						materialDigest: d("b"),
					});
					// replay of the same change
					expect(
						replaceProjection(db, A, {
							entries: [cur("claim-1", "svc")],
							edges: [edge("e1", "svc", "cache")],
							materialDigest: d("a"),
						}),
					).toEqual({ status: "applied", epoch: 1, changed: false });
					// rev2 correction => new material
					expect(
						replaceProjection(db, A, {
							entries: [cur("claim-1", "svc", 2)],
							edges: [],
							materialDigest: d("c"),
						}),
					).toEqual({ status: "applied", epoch: 2, changed: true });
				});
				store.read((db) => {
					expect(getEpoch(db, A)?.epoch).toBe(2);
					expect(getEpoch(db, B)?.epoch).toBe(1);
					expect(
						getEpoch(db, { principal: "p-a", scopeKey: "none" }),
					).toBeUndefined();
					expect(
						readCurrent(db, A, { limit: 10 }).rows.map(
							(r) => r.assertionRevision,
						),
					).toEqual([2]);
					expect(
						readCurrent(db, B, { limit: 10 }).rows.map((r) => r.assertionId),
					).toEqual(["claim-9"]);
					expect(readEdgesFrom(db, A, ["svc"], 10).rows).toEqual([]);
				});
			} finally {
				store.close();
			}
		});

		test("A14 edges read by both ends, bounded with a sentinel", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) =>
					replaceProjection(db, A, {
						entries: [],
						edges: [
							edge("e1", "a", "b"),
							edge("e2", "a", "c"),
							edge("e3", "d", "b"),
						],
						materialDigest: d("a"),
					}),
				);
				store.read((db) => {
					const from = readEdgesFrom(db, A, ["a"], 10);
					expect(from.rows.map((r) => r.edgeId)).toEqual(["e1", "e2"]);
					expect(from.truncated).toBe(false);
					const limited = readEdgesFrom(db, A, ["a"], 1);
					expect(limited.rows.length).toBe(1);
					expect(limited.truncated).toBe(true);
					expect(
						readEdgesTo(db, A, ["b"], 10).rows.map((r) => r.edgeId),
					).toEqual(["e1", "e3"]);
					expect(readEdgesTo(db, B, ["b"], 10).rows).toEqual([]);
					expect(() => readEdgesFrom(db, A, ["a"], 0)).toThrow();
					expect(() => readEdgesFrom(db, A, ["a"], 501)).toThrow();
				});
			} finally {
				store.close();
			}
		});

		test("rejections happen before DML; constraints reject bad rows", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					replaceProjection(db, A, {
						entries: [cur("c", "s")],
						edges: [],
						materialDigest: d("a"),
					});
					expect(
						replaceProjection(db, A, {
							entries: [cur("x", "s"), cur("x", "s")],
							edges: [],
							materialDigest: d("b"),
						}),
					).toEqual({ status: "rejected", reasonCode: "INVALID_INPUT" });
					expect(
						replaceProjection(db, A, {
							entries: [],
							edges: [{ ...edge("e", "a", "b"), relation: "magic" }],
							materialDigest: d("b"),
						}),
					).toEqual({ status: "rejected", reasonCode: "INVALID_INPUT" });
					expect(
						replaceProjection(
							db,
							{ principal: "", scopeKey: "s" },
							{ entries: [], edges: [], materialDigest: d("b") },
						).status,
					).toBe("rejected");
					expect(readCurrent(db, A, { limit: 5 }).rows.length).toBe(1);
					// raw constraint checks
					const insert =
						(sql: string, ...params: (string | number | null)[]) =>
						() =>
							db.query(sql).run(...params);
					expect(
						insert(
							"INSERT INTO world_current VALUES (NULL,'s','a',1,'x','p','active',1,'{}')",
						),
					).toThrow();
					expect(
						insert(
							"INSERT INTO world_current VALUES ('p','s','a',1,'x','p','bogus',1,'{}')",
						),
					).toThrow();
					expect(
						insert(
							"INSERT INTO world_current VALUES ('p','s','a',0,'x','p','active',1,'{}')",
						),
					).toThrow();
					expect(
						insert(
							"INSERT INTO world_edge VALUES ('p','s','e',1,'a','b','nope','c',1,'{}')",
						),
					).toThrow();
					db.query(
						"INSERT INTO world_current VALUES ('p','s','a',1,'x','p','active',1,'{}')",
					).run();
					expect(
						insert(
							"INSERT INTO world_current VALUES ('p','s','a',1,'x','p','active',1,'{}')",
						),
					).toThrow();
				});
			} finally {
				store.close();
			}
		});

		test("mid-write exception rolls the whole replace back", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) =>
					replaceProjection(db, A, {
						entries: [cur("c", "s")],
						edges: [],
						materialDigest: d("a"),
					}),
				);
				expect(() =>
					store.write((db) => {
						replaceProjection(db, A, {
							entries: [cur("c", "s", 2)],
							edges: [],
							materialDigest: d("b"),
						});
						throw new Error("boom");
					}),
				).toThrow("boom");
				store.read((db) => {
					expect(getEpoch(db, A)?.epoch).toBe(1);
					expect(
						readCurrent(db, A, { limit: 5 }).rows[0]?.assertionRevision,
					).toBe(1);
				});
			} finally {
				store.close();
			}
		});

		test("deleteProjectionFor removes only the named assertion versions in that Scope", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					for (const scope of [A, B])
						replaceProjection(db, scope, {
							entries: [cur("c1", "s"), cur("c2", "s")],
							edges: [{ ...edge("e1", "a", "b"), assertionId: "c1" }],
							materialDigest: d("a"),
						});
					expect(
						deleteProjectionFor(db, A, [{ id: "c1", revision: 1 }]),
					).toEqual({ current: 1, edges: 1 });
				});
				store.read((db) => {
					expect(
						readCurrent(db, A, { limit: 5 }).rows.map((r) => r.assertionId),
					).toEqual(["c2"]);
					expect(readCurrent(db, B, { limit: 5 }).rows.length).toBe(2);
					expect(readEdgesFrom(db, B, ["a"], 5).rows.length).toBe(1);
				});
			} finally {
				store.close();
			}
		});

		test("writes outside a host transaction throw WorldTransactionRequiredError", () => {
			const store = openTestStore({ mode });
			try {
				const outside = store.read((db) => db);
				expect(() =>
					replaceProjection(
						{
							...outside,
							inTransaction: false,
							exec: outside.exec.bind(outside),
							query: outside.query.bind(outside),
						},
						A,
						{
							entries: [],
							edges: [],
							materialDigest: d("a"),
						},
					),
				).toThrow(WorldTransactionRequiredError);
				expect(() =>
					deleteProjectionFor(
						{
							inTransaction: false,
							exec: () => {},
							query: () => ({}) as never,
						},
						A,
						[],
					),
				).toThrow(WorldTransactionRequiredError);
			} finally {
				store.close();
			}
		});
	});
}

test("A14 main lookups use the declared indexes", () => {
	const store = openTestStore();
	try {
		store.read((db) => {
			const plan = (sql: string) =>
				(
					db.query(`EXPLAIN QUERY PLAN ${sql}`).all("p", "s", "x") as {
						detail: string;
					}[]
				)
					.map((r) => r.detail)
					.join(" | ");
			expect(
				plan(
					"SELECT * FROM world_edge WHERE principal = ? AND scope_key = ? AND from_id IN (?)",
				),
			).toContain("world_edge_from");
			expect(
				plan(
					"SELECT * FROM world_edge WHERE principal = ? AND scope_key = ? AND to_id IN (?)",
				),
			).toContain("world_edge_to");
			expect(
				plan(
					"SELECT * FROM world_current WHERE principal = ? AND scope_key = ? AND subject_id IN (?)",
				),
			).toContain("world_current_subject");
		});
	} finally {
		store.close();
	}
});
