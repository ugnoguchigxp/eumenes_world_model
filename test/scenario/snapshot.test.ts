import { describe, expect, test } from "bun:test";
import {
	buildWorldSlice,
	toSliceReceipt,
} from "../../src/domains/projection/index.ts";
import {
	readAssertionHistory,
	readWorldSnapshot,
	validateWorldUsage,
	WorldTransactionRequiredError,
	type WorldDb,
} from "../../src/sqlite.ts";
import {
	A,
	access,
	adopt,
	apply,
	claim,
	hasher,
	hostChecks,
	openWorld,
	registerClaim,
} from "./world-fixture.ts";

const request = (extra: Record<string, unknown> = {}) => ({
	contractVersion: 1,
	access: access(),
	scope: A,
	asOf: 1791500000000,
	hostChecks: hostChecks(),
	...extra,
});
const relation = (id: string, from: string, to: string) =>
	claim({
		id,
		subjectId: from,
		payload: { kind: "relation", relation: "causes", objectId: to },
	});
const register = (key: string, assertion: unknown) => ({
	...registerClaim(key),
	operation: { kind: "assertion.register", assertion },
});

function seedChain(store: ReturnType<typeof openWorld>, subjects = 4) {
	// svc-1 -> svc-2 -> svc-3 ... plus one plain value claim per subject.
	store.write((db) => {
		for (let i = 1; i < subjects; i++)
			expect(
				apply(
					db,
					register(
						`rel-${i}`,
						relation(`rel-${i}`, `svc-${i}`, `svc-${i + 1}`),
					),
				).status,
			).toBe("applied");
	});
}
const ready = (db: WorldDb, extra: Record<string, unknown> = {}) => {
	const result = readWorldSnapshot(db, request(extra));
	if (result.status !== "ready") throw new Error(result.reasonCode);
	return result;
};
const ids = (assertions: readonly { id: string }[]) =>
	assertions.map((a) => a.id);

describe("A27 one consistent snapshot per read", () => {
	test("a writer commit during a reader transaction is invisible until the next read", () => {
		const store = openWorld("file");
		try {
			store.write((db) => {
				apply(db, registerClaim("op-1"));
				apply(db, adopt("op-2"));
			});
			let during: ReturnType<typeof ready> | undefined;
			const first = store.read((db) => {
				const a = ready(db);
				// Another connection commits while this read transaction is open.
				store.write((writer) => {
					expect(
						apply(
							writer,
							register("op-3", claim({ id: "claim-2", subjectId: "svc-9" })),
						).status,
					).toBe("applied");
				});
				during = ready(db);
				// Same read => same rows, same epoch, even across several SELECTs.
				expect(during.snapshot).toEqual(a.snapshot);
				return a;
			});
			expect(ids(first.snapshot.assertions)).toEqual(["claim-1"]);
			expect(during?.snapshot.scopeEpoch).toBe(first.snapshot.scopeEpoch);
			const next = store.read((db) => ready(db));
			expect(ids(next.snapshot.assertions)).toEqual(["claim-1", "claim-2"]);
			expect(next.snapshot.scopeEpoch).toBe(first.snapshot.scopeEpoch + 1);
		} finally {
			store.close();
		}
	});

	test("SELECTs outside a transaction are refused (read, history, usage)", () => {
		const store = openWorld("file");
		try {
			store.read((db) => {
				const detached: WorldDb = {
					inTransaction: false,
					exec: (sql) => db.exec(sql),
					query: (sql) => db.query(sql),
				};
				expect(() => readWorldSnapshot(detached, request())).toThrow(
					WorldTransactionRequiredError,
				);
				expect(() =>
					readAssertionHistory(detached, { assertionId: "claim-1" }),
				).toThrow(WorldTransactionRequiredError);
				expect(() => validateWorldUsage(detached, {}, {})).toThrow(
					WorldTransactionRequiredError,
				);
			});
		} finally {
			store.close();
		}
	});

	test("the snapshot feeds buildWorldSlice; incomplete input is blocked, not guessed", () => {
		const store = openWorld("memory");
		try {
			seedChain(store, 6);
			const slice = store.write((db) => {
				const full = ready(db);
				expect(full.snapshot.complete).toBe(true);
				const built = buildWorldSlice(
					{ contractVersion: 1, snapshot: full.snapshot, request: {} },
					hasher,
				);
				expect(built.ok).toBe(true);
				const cut = ready(db, { budget: { candidates: 3 } });
				expect(cut.snapshot.complete).toBe(false);
				const blocked = buildWorldSlice(
					{ contractVersion: 1, snapshot: cut.snapshot, request: {} },
					hasher,
				);
				return blocked.ok ? blocked.value.status : "error";
			});
			expect(slice).toBe("blocked");
		} finally {
			store.close();
		}
	});
});

describe("bounded retrieval budgets (C5)", () => {
	test("candidate budget counts the sentinel: never more rows than the budget", () => {
		const store = openWorld("memory");
		try {
			seedChain(store, 7); // 6 assertions
			store.write((db) => {
				const all = ready(db);
				expect(all.snapshot.assertions).toHaveLength(6);
				expect(all.coverage.partial).toBe(false);
				// budget 4 => limit 3 + 1 sentinel = 4 rows fetched in total
				const cut = ready(db, { budget: { candidates: 4 } });
				expect(cut.snapshot.assertions).toHaveLength(3);
				expect(cut.coverage.fetchedRows).toBeLessThanOrEqual(4);
				expect(cut.coverage.reasons).toContain("CANDIDATE_BUDGET");
				expect(cut.snapshot.complete).toBe(false);
				// budget exactly N+1 fits N rows plus its sentinel-free read
				const fit = ready(db, { budget: { candidates: 8 } });
				expect(fit.snapshot.assertions).toHaveLength(6);
				expect(fit.coverage.fetchedRows).toBeLessThanOrEqual(8);
			});
		} finally {
			store.close();
		}
	});

	test("focus reads only the neighbourhood, depth bounded, DEPTH_LIMIT reported", () => {
		const store = openWorld("memory");
		try {
			seedChain(store, 6); // svc-1->2->3->4->5 (rel-1..5), assertions subject svc-1..5
			store.write((db) => {
				const d0 = ready(db, { focus: { subjectIds: ["svc-1"], depth: 0 } });
				expect(ids(d0.snapshot.assertions)).toEqual(["rel-1"]);
				const d1 = ready(db, { focus: { subjectIds: ["svc-1"], depth: 1 } });
				expect(ids(d1.snapshot.assertions)).toEqual(["rel-1", "rel-2"]);
				expect(d1.coverage.reasons).toContain("DEPTH_LIMIT");
				expect(d1.coverage.partial).toBe(true);
				const d3 = ready(db, { focus: { subjectIds: ["svc-1"], depth: 3 } });
				expect(ids(d3.snapshot.assertions)).toEqual([
					"rel-1",
					"rel-2",
					"rel-3",
					"rel-4",
				]);
				// The whole ledger was never needed: rel-5 not loaded.
				expect(ids(d3.snapshot.assertions)).not.toContain("rel-5");
				// Edges are followed in both directions.
				const mid = ready(db, { focus: { subjectIds: ["svc-3"], depth: 1 } });
				expect(ids(mid.snapshot.assertions)).toEqual([
					"rel-2",
					"rel-3",
					"rel-4",
				]);
			});
		} finally {
			store.close();
		}
	});

	test("expansion budget stops a high-degree hub and says so (partial, not no-effect)", () => {
		const store = openWorld("memory");
		try {
			store.write((db) => {
				for (let i = 1; i <= 8; i++)
					apply(
						db,
						register(`hub-${i}`, relation(`hub-${i}`, "svc-hub", `leaf-${i}`)),
					);
				const wide = ready(db, {
					focus: { subjectIds: ["svc-hub"], depth: 1 },
				});
				expect(wide.coverage.partial).toBe(false);
				const narrow = ready(db, {
					focus: { subjectIds: ["svc-hub"], depth: 1 },
					budget: { expansions: 4 },
				});
				expect(narrow.coverage.reasons).toContain("EXPANSION_BUDGET");
				expect(narrow.coverage.expandedRows).toBeLessThanOrEqual(4 + 4);
				// Required rows (the focus subject) were still complete.
				expect(narrow.snapshot.complete).toBe(true);
			});
		} finally {
			store.close();
		}
	});

	test("invalid focus / budget input is rejected without reading", () => {
		const store = openWorld("memory");
		try {
			store.write((db) => {
				for (const extra of [
					{ focus: { subjectIds: ["a", "a"] } },
					{ focus: { subjectIds: [""] } },
					{ focus: { subjectIds: ["a"], depth: 9 } },
					{ budget: { candidates: 1 } },
					{ budget: { candidates: 501 } },
					{ budget: { other: 5 } },
					{ unknown: true },
				])
					expect(readWorldSnapshot(db, request(extra)).status).toBe("rejected");
			});
		} finally {
			store.close();
		}
	});
});

describe("A24 re-validation on the writer", () => {
	test("epoch, assertion head, source version and tombstones all invalidate a receipt", () => {
		const store = openWorld("file");
		try {
			store.write((db) => {
				apply(db, registerClaim("op-1"));
				apply(db, adopt("op-2"));
			});
			const current = (hc = hostChecks()) => ({
				contractVersion: 1,
				access: access(),
				scope: A,
				hostChecks: hc,
			});
			const receipt = store.read((db) => {
				const read = ready(db);
				const slice = buildWorldSlice(
					{ contractVersion: 1, snapshot: read.snapshot, request: {} },
					hasher,
				);
				if (!slice.ok) throw new Error(`${slice.code}:${slice.path}`);
				return toSliceReceipt(slice.value);
			});
			store.write((db) => {
				expect(validateWorldUsage(db, receipt, current())).toEqual({
					status: "valid",
				});
				// Source revision moved on in the host's snapshot.
				const moved = hostChecks([
					{ ...hostChecks().sourceSnapshot.states[0]!, revision: "rev-2" },
				]);
				expect(validateWorldUsage(db, receipt, current(moved))).toEqual({
					status: "blocked",
					reasonCode: "SOURCE_CHANGED",
				});
				// A source state from another Scope is not a current state.
				const foreign = hostChecks([
					{ ...hostChecks().sourceSnapshot.states[0]!, scopeKey: "scope-b" },
				]);
				expect(validateWorldUsage(db, receipt, current(foreign)).status).toBe(
					"blocked",
				);
			});
			store.write((db) => {
				expect(
					apply(
						db,
						register("op-9", claim({ id: "claim-2", subjectId: "svc-2" })),
					).status,
				).toBe("applied");
				expect(validateWorldUsage(db, receipt, current())).toEqual({
					status: "blocked",
					reasonCode: "SCOPE_EPOCH_CHANGED",
				});
			});
		} finally {
			store.close();
		}
	});
});
