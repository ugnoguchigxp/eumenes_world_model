import { describe, expect, test } from "bun:test";
import {
	closeGate,
	insertTombstone,
} from "../../src/domains/lifecycle/sqlite.ts";
import { readAssertionHistory, readWorldSnapshot } from "../../src/sqlite.ts";
import {
	A,
	B,
	access,
	adopt,
	apply,
	claim,
	envelope,
	hostChecks,
	openWorld,
	registerClaim,
	state,
} from "./world-fixture.ts";

const request = (extra: Record<string, unknown> = {}) => ({
	contractVersion: 1,
	access: access(),
	scope: A,
	asOf: 1791500000000,
	hostChecks: hostChecks(),
	...extra,
});
const historyRequest = (extra: Record<string, unknown> = {}) => ({
	contractVersion: 1,
	access: access(),
	scope: A,
	hostChecks: hostChecks(),
	assertionId: "claim-1",
	...extra,
});
const seedBoth = (store: ReturnType<typeof openWorld>) =>
	store.write((db) => {
		apply(db, registerClaim("op-1"));
		apply(db, adopt("op-2"));
		// Another Scope, same subject name, plus data that must never surface.
		expect(
			apply(
				db,
				envelope(
					"op-b1",
					{
						kind: "assertion.register",
						assertion: claim({
							id: "claim-b",
							scope: B,
							subjectId: "b-only-subject",
							predicate: "b-only-predicate",
						}),
					},
					{
						scope: B,
						access: access(["scope-b"]),
						hostChecks: hostChecks([state({ scopeKey: "scope-b" })]),
					},
				),
			).status,
		).toBe("applied");
	});

describe("scope isolation of reads", () => {
	test("another Scope's names, rows and counts never appear in a read", () => {
		const store = openWorld("file");
		try {
			seedBoth(store);
			const result = store.read((db) => readWorldSnapshot(db, request()));
			if (result.status !== "ready") throw new Error("not ready");
			expect(result.snapshot.assertions.map((a) => a.id)).toEqual(["claim-1"]);
			const text = JSON.stringify(result);
			for (const leak of ["b-only", "claim-b", "scope-b"])
				expect(text).not.toContain(leak);
			expect(
				result.snapshot.sources.every((s) => s.scopeKey === "scope-a"),
			).toBe(true);
			// Host snapshot states of another Scope are not echoed back either.
			const mixed = store.read((db) =>
				readWorldSnapshot(
					db,
					request({
						hostChecks: hostChecks([
							state(),
							state({ scopeKey: "scope-b", id: "src-b" }),
						]),
					}),
				),
			);
			expect(JSON.stringify(mixed)).not.toContain("src-b");
		} finally {
			store.close();
		}
	});

	test("unauthorized reads leak nothing and look the same for existing and missing Scopes", () => {
		const store = openWorld("memory");
		try {
			seedBoth(store);
			const deny = (scope: unknown) =>
				store.read((db) =>
					readWorldSnapshot(
						db,
						request({ scope, access: access(["scope-a"]) }),
					),
				);
			const existing = deny(B);
			const missing = deny({ principal: "p-a", scopeKey: "scope-zzz" });
			expect(existing).toEqual({
				status: "rejected",
				reasonCode: "SCOPE_NOT_PERMITTED",
			});
			expect(missing).toEqual(existing);
			const foreign = store.read((db) =>
				readWorldSnapshot(
					db,
					request({ access: { ...access(), principal: "p-other" } }),
				),
			);
			expect(foreign).toEqual(existing);
			// History obeys the same rule.
			const history = store.read((db) =>
				readAssertionHistory(
					db,
					historyRequest({ scope: B, assertionId: "claim-b" }),
				),
			);
			expect(history).toEqual({
				status: "rejected",
				reasonCode: "SCOPE_NOT_PERMITTED",
			});
			expect(JSON.stringify([existing, history, foreign])).not.toMatch(
				/claim|svc|b-only/,
			);
		} finally {
			store.close();
		}
	});

	test("policy change blocks; closed gate blocks; neither reads the ledger", () => {
		const store = openWorld("memory");
		try {
			seedBoth(store);
			store.read((db) => {
				expect(
					readWorldSnapshot(
						db,
						request({ access: { ...access(), policyRevision: "pol-0" } }),
					),
				).toEqual({ status: "blocked", reasonCode: "POLICY_CHANGED" });
				expect(
					readWorldSnapshot(
						db,
						request({ hostChecks: { ...hostChecks(), gate: "closed" } }),
					),
				).toEqual({ status: "blocked", reasonCode: "GATE_CLOSED" });
			});
			store.write((db) =>
				closeGate(db, A, { reasonCode: "RESTORE_PENDING", restoreEpoch: "r1" }),
			);
			store.read((db) => {
				expect(readWorldSnapshot(db, request())).toEqual({
					status: "blocked",
					reasonCode: "GATE_CLOSED",
				});
				expect(readAssertionHistory(db, historyRequest())).toEqual({
					status: "blocked",
					reasonCode: "GATE_CLOSED",
				});
			});
			// The other Scope is not affected by this Scope's gate.
			store.read((db) => {
				const other = readWorldSnapshot(
					db,
					request({
						scope: B,
						access: access(["scope-b"]),
						hostChecks: hostChecks([state({ scopeKey: "scope-b" })]),
					}),
				);
				expect(other.status).toBe("ready");
			});
		} finally {
			store.close();
		}
	});
});

describe("tombstones and history", () => {
	test("a tombstoned focus subject or assertion is blocked", () => {
		const store = openWorld("file");
		try {
			seedBoth(store);
			store.write((db) => {
				expect(
					insertTombstone(db, A, {
						kind: "entity",
						id: "svc-1",
						forgetId: "forget-1",
						reasonCode: "FORGET_REQUESTED",
					}).status,
				).toBe("inserted");
				expect(
					insertTombstone(db, A, {
						kind: "assertion",
						id: "claim-1",
						forgetId: "forget-1",
						reasonCode: "FORGET_REQUESTED",
					}).status,
				).toBe("inserted");
			});
			store.read((db) => {
				expect(
					readWorldSnapshot(db, request({ focus: { subjectIds: ["svc-1"] } })),
				).toEqual({ status: "blocked", reasonCode: "TOMBSTONED" });
				expect(readAssertionHistory(db, historyRequest())).toEqual({
					status: "blocked",
					reasonCode: "TOMBSTONED",
				});
				// An unrelated subject is still readable.
				expect(
					readWorldSnapshot(
						db,
						request({ focus: { subjectIds: ["svc-other"] } }),
					).status,
				).toBe("ready");
			});
		} finally {
			store.close();
		}
	});

	test("history lists revisions newest first, bounded, within the Scope", () => {
		const store = openWorld("memory");
		try {
			seedBoth(store);
			store.read((db) => {
				const history = readAssertionHistory(db, historyRequest());
				if (history.status !== "ready") throw new Error("not ready");
				expect(history.revisions.map((r) => r.revision)).toEqual([2, 1]);
				expect(history.truncated).toBe(false);
				const one = readAssertionHistory(db, historyRequest({ limit: 1 }));
				if (one.status !== "ready") throw new Error("not ready");
				expect(one.revisions.map((r) => r.revision)).toEqual([2]);
				expect(one.truncated).toBe(true);
				// Same id in the other Scope is a different, invisible assertion.
				const missing = readAssertionHistory(
					db,
					historyRequest({ assertionId: "claim-b" }),
				);
				expect(missing).toEqual({
					status: "ready",
					revisions: [],
					truncated: false,
				});
				expect(
					readAssertionHistory(db, historyRequest({ extra: 1 })).status,
				).toBe("rejected");
			});
		} finally {
			store.close();
		}
	});
});
