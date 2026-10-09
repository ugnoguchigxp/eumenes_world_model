import { describe, expect, test } from "bun:test";
import { openTestStore } from "../../../../test/support/sqlite-store.ts";
import type { WorldDb } from "../../../infrastructure/sqlite/db.ts";
import { WorldTransactionRequiredError } from "../../../infrastructure/sqlite/db.ts";
import {
	planAssertionTransition,
	sourceIdentityKey,
	type Assertion,
	type Evidence,
	type TransitionPlan,
} from "../index.ts";
import {
	applyTransition,
	deleteAssertions,
	getAssertion,
	getHead,
	insertAssertion,
	insertEvidence,
	insertInputs,
	listAssertionsBySourceKeys,
	listBySubject,
	listEvidence,
	listScopeAssertions,
} from "../sqlite.ts";
import { A, B, draft, evidence, ref } from "./helpers.ts";

const base = (extra: Record<string, unknown> = {}) =>
	({
		...draft(),
		lifecycle: "candidate",
		rootEvidenceIds: ["root-1"],
		...extra,
	}) as unknown as Assertion;

function plan(
	request: Record<string, unknown>,
	current: { revision: number; lifecycle: string; id?: string },
	scope = A,
): TransitionPlan {
	const result = planAssertionTransition({
		contractVersion: 1,
		scope,
		current: {
			id: current.id ?? "claim-1",
			revision: current.revision,
			scope,
			lifecycle: current.lifecycle,
			origin: "user_report",
		},
		expectedRevision: current.revision,
		request,
		registeredAdoptionRules: [],
	});
	if (!result.ok || result.value.status !== "planned")
		throw new Error(`plan failed: ${JSON.stringify(result)}`);
	return result.value.plan;
}
const adopt = {
	action: "adopt",
	adoption: { kind: "explicit", operationId: "op-adopt" },
	subjectConfirmedByHost: true,
};

const TABLES = [
	"world_assertion",
	"world_assertion_head",
	"world_transition",
	"world_evidence",
	"world_assertion_input",
];
const counts = (db: WorldDb) =>
	TABLES.map(
		(t) =>
			(db.query(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n,
	);
const seed = (db: WorldDb, assertion = base()) => {
	expect(insertAssertion(db, assertion).status).toBe("applied");
	const r = ref();
	expect(
		insertEvidence(db, A, { id: "claim-1", revision: 1 }, [
			evidence() as unknown as Evidence,
		]).status,
	).toBe("applied");
	expect(
		insertInputs(db, A, { id: "claim-1", revision: 1 }, [
			r,
			ref({ id: "src-extra", revision: "r9", digest: "d" }),
		]).status,
	).toBe("applied");
};

for (const mode of ["file", "memory"] as const) {
	describe(`assertions repository (${mode})`, () => {
		const open = () => openTestStore({ mode });

		test("A08 register / evidence / inputs round trip keeps origin and candidate", () => {
			const store = open();
			try {
				store.write((db) => seed(db));
				store.read((db) => {
					const got = getAssertion(db, A, "claim-1")!;
					expect(got.origin).toBe("user_report");
					expect(got.lifecycle).toBe("candidate");
					expect(getHead(db, A, "claim-1")?.currentRevision).toBe(1);
					expect(
						listEvidence(db, A, { id: "claim-1", revision: 1 }).map(
							(e) => e.evidenceId,
						),
					).toEqual(["ev-1"]);
					expect(counts(db)).toEqual([1, 1, 0, 1, 2]);
				});
			} finally {
				store.close();
			}
		});

		test("listScopeAssertions pages head revisions of one Scope by id, bounded, without other Scopes", () => {
			const store = open();
			try {
				store.write((db) => {
					for (const id of ["c-3", "c-1", "c-2"])
						expect(insertAssertion(db, base({ id })).status).toBe("applied");
					expect(
						insertAssertion(db, base({ id: "c-9", scope: B })).status,
					).toBe("applied");
				});
				store.read((db) => {
					const first = listScopeAssertions(db, A, { limit: 2 });
					expect(first.items.map((x) => x.id)).toEqual(["c-1", "c-2"]);
					expect(first.truncated).toBe(true);
					const second = listScopeAssertions(db, A, {
						afterId: "c-2",
						limit: 2,
					});
					expect(second.items.map((x) => x.id)).toEqual(["c-3"]);
					expect(second.truncated).toBe(false);
					expect(
						listScopeAssertions(db, B, { limit: 5 }).items.map((x) => x.id),
					).toEqual(["c-9"]);
					expect(() =>
						listScopeAssertions(
							db,
							{ principal: "", scopeKey: "x" },
							{ limit: 1 },
						),
					).toThrow();
				});
			} finally {
				store.close();
			}
		});

		test("write APIs throw WorldTransactionRequiredError before touching SQL outside a transaction", () => {
			const untouched: WorldDb = {
				inTransaction: false,
				exec() {
					throw new Error("sql_touched");
				},
				query() {
					throw new Error("sql_touched");
				},
			};
			const absent = {
				exec: untouched.exec,
				query: untouched.query,
			} as unknown as WorldDb;
			for (const db of [untouched, absent]) {
				expect(() => insertAssertion(db, base())).toThrow(
					WorldTransactionRequiredError,
				);
				expect(() =>
					applyTransition(
						db,
						plan(adopt, { revision: 1, lifecycle: "candidate" }),
					),
				).toThrow(WorldTransactionRequiredError);
				expect(() =>
					insertEvidence(db, A, { id: "x", revision: 1 }, []),
				).toThrow(WorldTransactionRequiredError);
				expect(() => insertInputs(db, A, { id: "x", revision: 1 }, [])).toThrow(
					WorldTransactionRequiredError,
				);
				expect(() => deleteAssertions(db, A, [])).toThrow(
					WorldTransactionRequiredError,
				);
			}
		});

		test("A10 adopt creates revision 2; stale expectedRevision is rejected without change", () => {
			const store = open();
			try {
				store.write((db) => seed(db));
				const p = plan(adopt, { revision: 1, lifecycle: "candidate" });
				const result = store.write((db) => applyTransition(db, p));
				expect(result).toEqual({
					status: "applied",
					id: "claim-1",
					revision: 2,
				});
				store.read((db) => {
					expect(getAssertion(db, A, "claim-1")?.lifecycle).toBe("active");
					expect(getHead(db, A, "claim-1")?.currentRevision).toBe(2);
					// evidence and inputs are carried to the new revision
					expect(
						listEvidence(db, A, { id: "claim-1", revision: 2 }).length,
					).toBe(1);
					expect(counts(db)).toEqual([2, 1, 1, 2, 4]);
				});
				const before = store.read((db) => counts(db));
				const stale = store.write((db) => applyTransition(db, p));
				expect(stale).toEqual({
					status: "rejected",
					reasonCode: "REVISION_CONFLICT",
				});
				expect(store.read((db) => counts(db))).toEqual(before);
			} finally {
				store.close();
			}
		});

		test("A10 supersede stops the old revision and links the replacement in one apply", () => {
			const store = open();
			try {
				store.write((db) => seed(db));
				store.write((db) =>
					applyTransition(
						db,
						plan(adopt, { revision: 1, lifecycle: "candidate" }),
					),
				);
				const p = plan(
					{ action: "supersede", replacementRevision: 3 },
					{ revision: 2, lifecycle: "active" },
				);
				const replacement = base({
					revision: 3,
					supersedes: [{ id: "claim-1", revision: 2 }],
					payload: { kind: "value", value: { kind: "boolean", value: false } },
				});
				// replacement is mandatory and must match the plan
				expect(store.write((db) => applyTransition(db, p))).toEqual({
					status: "rejected",
					reasonCode: "REPLACEMENT_REQUIRED",
				});
				expect(
					store.write((db) => applyTransition(db, p, base({ revision: 3 }))),
				).toEqual({ status: "rejected", reasonCode: "REPLACEMENT_MISMATCH" });
				expect(
					store.write((db) => applyTransition(db, p, replacement)),
				).toEqual({ status: "applied", id: "claim-1", revision: 3 });
				store.read((db) => {
					expect(getAssertion(db, A, "claim-1", 2)?.lifecycle).toBe(
						"superseded",
					);
					const head = getAssertion(db, A, "claim-1")!;
					expect(head.revision).toBe(3);
					expect(head.lifecycle).toBe("candidate");
					expect(head.supersedes).toEqual([{ id: "claim-1", revision: 2 }]);
				});
				// terminal revision can never be re-activated at the same revision
				const again = plan(adopt, { revision: 3, lifecycle: "candidate" });
				const old = {
					...again,
					expectedRevision: 2,
					nextRevision: 3,
					from: "superseded",
				} as TransitionPlan;
				expect(store.write((db) => applyTransition(db, old)).status).toBe(
					"rejected",
				);
			} finally {
				store.close();
			}
		});

		test("retract stops the old revision and keeps the reason source in the new revision", () => {
			const store = open();
			try {
				store.write((db) => seed(db));
				const p = plan(
					{ action: "retract", reasonSource: ref({ id: "src-r" }) },
					{ revision: 1, lifecycle: "candidate" },
				);
				expect(store.write((db) => applyTransition(db, p)).status).toBe(
					"applied",
				);
				store.read((db) => {
					expect(getAssertion(db, A, "claim-1", 1)?.lifecycle).toBe(
						"retracted",
					);
					expect(getAssertion(db, A, "claim-1", 2)?.lifecycle).toBe(
						"retracted",
					);
				});
				// a retracted head cannot be moved again
				const next = {
					...p,
					expectedRevision: 2,
					nextRevision: 3,
					from: "retracted",
				} as TransitionPlan;
				expect(store.write((db) => applyTransition(db, next))).toEqual({
					status: "rejected",
					reasonCode: "TERMINAL_STATE",
				});
			} finally {
				store.close();
			}
		});

		test("A21 duplicate id, non-initial revision and non-candidate are rejected before DML", () => {
			const store = open();
			try {
				store.write((db) => seed(db));
				store.write((db) => {
					expect(insertAssertion(db, base())).toEqual({
						status: "rejected",
						reasonCode: "DUPLICATE_ASSERTION",
					});
					expect(insertAssertion(db, base({ id: "c2", revision: 2 }))).toEqual({
						status: "rejected",
						reasonCode: "INITIAL_REVISION_REQUIRED",
					});
					expect(
						insertAssertion(db, base({ id: "c3", lifecycle: "active" })),
					).toEqual({ status: "rejected", reasonCode: "NOT_CANDIDATE" });
					expect(
						insertEvidence(db, A, { id: "claim-1", revision: 1 }, [
							evidence() as unknown as Evidence,
						]).status,
					).toBe("rejected");
					expect(
						insertInputs(db, A, { id: "nope", revision: 1 }, [ref()]),
					).toEqual({ status: "rejected", reasonCode: "ASSERTION_NOT_FOUND" });
					expect(
						insertInputs(db, A, { id: "claim-1", revision: 1 }, [
							ref({ revision: "a", digest: "x" }),
							ref({ revision: "b", digest: "y" }),
						]),
					).toEqual({
						status: "rejected",
						reasonCode: "CONFLICTING_INPUT_REVISIONS",
					});
					expect(counts(db)).toEqual([1, 1, 0, 1, 2]);
				});
			} finally {
				store.close();
			}
		});

		test("A21 schema constraints: NULL scope, bad enum, duplicate PK, cross-scope FK", () => {
			const store = open();
			try {
				store.write((db) => seed(db));
				const insert = (
					principal: unknown,
					scopeKey: unknown,
					id: string,
					lifecycle: string,
				) =>
					store.write((db) =>
						db
							.query(
								"INSERT INTO world_assertion (principal, scope_key, id, revision, subject_id, predicate, lifecycle, origin, recorded_at, payload_json) VALUES (?, ?, ?, 1, 's', 'p', ?, 'user_report', 1, '{}')",
							)
							.run(principal as string, scopeKey as string, id, lifecycle),
					);
				expect(() => insert(null, "scope-a", "x1", "candidate")).toThrow();
				expect(() => insert("p-a", null, "x2", "candidate")).toThrow();
				expect(() => insert("p-a", "scope-a", "x3", "bogus")).toThrow();
				expect(() =>
					insert("p-a", "scope-a", "claim-1", "candidate"),
				).toThrow();
				// evidence for an assertion that exists only in another scope
				expect(() =>
					store.write((db) =>
						db
							.query(
								"INSERT INTO world_evidence (principal, scope_key, assertion_id, assertion_revision, evidence_id, root_evidence_id, stance, source_key, source_revision, payload_json) VALUES ('p-a', 'scope-b', 'claim-1', 1, 'e', 'r', 'supports', 'k', 'v', '{}')",
							)
							.run(),
					),
				).toThrow();
				store.read((db) => expect(counts(db)).toEqual([1, 1, 0, 1, 2]));
			} finally {
				store.close();
			}
		});

		test("A23 an exception mid-write rolls back every table", () => {
			const store = open();
			try {
				store.write((db) => seed(db));
				const before = store.read((db) => counts(db));
				const p = plan(adopt, { revision: 1, lifecycle: "candidate" });
				expect(() =>
					store.write((db) => {
						expect(applyTransition(db, p).status).toBe("applied");
						insertAssertion(db, base({ id: "c9" }));
						throw new Error("boom");
					}),
				).toThrow("boom");
				expect(store.read((db) => counts(db))).toEqual(before);
				store.read((db) =>
					expect(getHead(db, A, "claim-1")?.currentRevision).toBe(1),
				);
			} finally {
				store.close();
			}
		});

		test("reverse lookup finds assertions through non-cited input sources, per scope", () => {
			const store = open();
			try {
				store.write((db) => {
					seed(db);
					expect(
						insertAssertion(db, base({ id: "claim-b", scope: B })).status,
					).toBe("applied");
					expect(
						insertInputs(db, B, { id: "claim-b", revision: 1 }, [
							ref({ id: "src-extra", revision: "r9", digest: "d" }),
						]).status,
					).toBe("applied");
				});
				store.read((db) => {
					const extra = sourceIdentityKey(ref({ id: "src-extra" }));
					expect(listAssertionsBySourceKeys(db, A, [extra], 10)).toEqual({
						refs: [{ id: "claim-1", revision: 1 }],
						truncated: false,
					});
					expect(listAssertionsBySourceKeys(db, B, [extra], 10).refs).toEqual([
						{ id: "claim-b", revision: 1 },
					]);
					const cited = sourceIdentityKey(ref());
					expect(listAssertionsBySourceKeys(db, A, [cited], 10).refs).toEqual([
						{ id: "claim-1", revision: 1 },
					]);
					expect(listAssertionsBySourceKeys(db, B, [cited], 10).refs).toEqual(
						[],
					);
					expect(listAssertionsBySourceKeys(db, A, [], 10).refs).toEqual([]);
				});
			} finally {
				store.close();
			}
		});

		test("listBySubject returns head revisions with a limit+1 sentinel and no cross-scope rows", () => {
			const store = open();
			try {
				store.write((db) => {
					for (const id of ["c1", "c2", "c3"])
						insertAssertion(db, base({ id }));
					insertAssertion(db, base({ id: "cb", scope: B }));
				});
				store.read((db) => {
					const page = listBySubject(db, A, "svc-1", { limit: 2 });
					expect(page.items.map((a) => a.id)).toEqual(["c1", "c2"]);
					expect(page.truncated).toBe(true);
					const all = listBySubject(db, A, "svc-1", {
						limit: 10,
						predicate: "available",
						lifecycles: ["candidate"],
					});
					expect(all.items.length).toBe(3);
					expect(all.truncated).toBe(false);
					expect(
						listBySubject(db, B, "svc-1", { limit: 10 }).items.map((a) => a.id),
					).toEqual(["cb"]);
					expect(getAssertion(db, B, "c1")).toBeUndefined();
				});
			} finally {
				store.close();
			}
		});

		test("deleteAssertions removes every revision and every payload row, only in its scope", () => {
			const store = open();
			try {
				store.write((db) => {
					seed(db);
					insertAssertion(db, base({ id: "claim-b", scope: B }));
				});
				store.write((db) =>
					applyTransition(
						db,
						plan(adopt, { revision: 1, lifecycle: "candidate" }),
					),
				);
				const result = store.write((db) =>
					deleteAssertions(db, A, [{ id: "claim-1", revision: 1 }]),
				);
				expect(result).toEqual({ status: "applied", deleted: 2 });
				store.read((db) => {
					expect(getAssertion(db, A, "claim-1")).toBeUndefined();
					expect(getHead(db, A, "claim-1")).toBeUndefined();
					expect(getAssertion(db, B, "claim-b")?.id).toBe("claim-b");
					expect(counts(db)).toEqual([1, 1, 0, 0, 0]);
					expect(
						(
							db
								.query(
									"SELECT count(*) AS n FROM world_assertion WHERE payload_json LIKE ?",
								)
								.get("%claim-1%") as { n: number }
						).n,
					).toBe(0);
				});
				// idempotent
				expect(
					store.write((db) =>
						deleteAssertions(db, A, [{ id: "claim-1", revision: 1 }]),
					),
				).toEqual({ status: "applied", deleted: 0 });
			} finally {
				store.close();
			}
		});
	});
}
