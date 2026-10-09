import { describe, expect, test } from "bun:test";
import {
	applyHeadChanges,
	projectLedger,
	rebuildProjection,
} from "../../src/application/sqlite/projection.ts";
import { listScopeAssertions } from "../../src/domains/assertions/sqlite.ts";
import {
	A,
	NOW,
	adoptPlan,
	apply,
	claim,
	dump,
	envelope,
	hasher,
	hostChecks,
	openWorld,
	registerClaim,
} from "./world-fixture.ts";
import type { WorldDb } from "../../src/infrastructure/sqlite/db.ts";

const context = { hasher, clock: NOW, hostChecks: hostChecks() } as never;
const rows = (db: WorldDb, table: string, order: string) =>
	db
		.query(
			`SELECT * FROM ${table} WHERE principal = 'p-a' AND scope_key = 'scope-a' ORDER BY ${order}`,
		)
		.all();
const stored = (db: WorldDb) => ({
	current: rows(db, "world_current", "assertion_id, assertion_revision"),
	edges: rows(db, "world_edge", "edge_id, revision"),
	epoch: db
		.query(
			"SELECT epoch, material_digest FROM world_scope_epoch WHERE principal = 'p-a' AND scope_key = 'scope-a'",
		)
		.get(),
});
const relation = (objectId: string) => ({
	payload: { kind: "relation", relation: "causes", objectId },
});

function fill(count: number) {
	const store = openWorld();
	store.write((db) => {
		for (let i = 0; i < count; i++) {
			const result = apply(
				db,
				registerClaim(`op-${i}`, {
					id: `c-${String(i).padStart(4, "0")}`,
					subjectId: `s-${i % 7}`,
					...(i % 5 === 0 ? relation(`s-${(i + 1) % 7}`) : {}),
				}),
			);
			if (result.status !== "applied") throw new Error(JSON.stringify(result));
		}
	});
	return store;
}

describe("P2-09 incremental projection equals the full rebuild", () => {
	test("A33 ledgers beyond the old 500 cap work; rows, digest and epoch match a paged rebuild", () => {
		const store = fill(620);
		try {
			store.write((db) => {
				// Disputer targets an existing head; then both get adopted/transitioned.
				const target = { id: "c-0003", revision: 1 };
				const dispute = apply(
					db,
					registerClaim("op-d", {
						id: "d-1",
						contradicts: [target],
						subjectId: "s-3",
					}),
				);
				expect(dispute.status).toBe("applied");
				expect(
					apply(
						db,
						envelope("op-adopt", {
							kind: "assertion.transition",
							plan: adoptPlan("d-1", 1),
						}),
					).status,
				).toBe("applied");
				expect(
					apply(
						db,
						envelope("op-adopt2", {
							kind: "assertion.transition",
							plan: adoptPlan("c-0007", 1),
						}),
					).status,
				).toBe("applied");
			});
			const incremental = store.read(stored);
			expect(incremental.current).toHaveLength(621);
			const refuted = incremental.current.find(
				(r) => (r as { assertion_id: string }).assertion_id === "c-0003",
			) as { payload_json: string };
			// d-1 is at revision 2 after adoption: the patch moved the reference.
			expect(JSON.parse(refuted.payload_json).refutations).toEqual([
				{ id: "d-1", revision: 2 },
			]);
			const heads = store.read((db) => {
				const all: unknown[] = [];
				for (let after: string | undefined; ;) {
					const page = listScopeAssertions(db, A, {
						limit: 500,
						...(after ? { afterId: after } : {}),
					});
					all.push(...page.items);
					if (!page.truncated) break;
					after = page.items.at(-1)!.id;
				}
				return all;
			});
			expect(heads).toHaveLength(621);
			const pure = projectLedger(heads as never, A, context);
			expect(incremental.epoch).toMatchObject({
				material_digest: pure.materialDigest,
			});
			expect(
				incremental.current.map(
					(r) => (r as { assertion_id: string }).assertion_id,
				),
			).toEqual(pure.entries.map((e) => e.assertionId));
			// Full paged rebuild must leave every row and the epoch exactly as is.
			const before = store.read(stored);
			const rebuilt = store.write((db) => {
				const result = rebuildProjection(db, A, context);
				return { result, after: stored(db) };
			});
			expect(rebuilt.result.changed).toBe(false);
			expect(rebuilt.after).toEqual(before);
		} finally {
			store.close();
		}
	});

	test("replaying an identical head state does not move the epoch", () => {
		const store = fill(3);
		try {
			const before = store.read(stored);
			store.write((db) => {
				const heads = listScopeAssertions(db, A, { limit: 10 }).items;
				const result = applyHeadChanges(db, A, context, [
					{ old: heads[0]!, next: heads[0]! },
				]);
				expect(result.changed).toBe(false);
			});
			expect(store.read(stored)).toEqual(before);
		} finally {
			store.close();
		}
	});

	test("a contradiction target that does not exist is rejected before any write", () => {
		const store = fill(2);
		try {
			const before = dump(store);
			const result = store.write((db) =>
				apply(
					db,
					registerClaim("op-x", {
						id: "x-1",
						contradicts: [{ id: "nope", revision: 1 }],
					}),
				),
			);
			expect(result).toEqual({
				status: "rejected",
				reasonCode: "CONTRADICTION_TARGET_NOT_FOUND",
			});
			expect(dump(store)).toEqual(before);
		} finally {
			store.close();
		}
	});

	test("rebuild refuses a ledger above the configured ceiling", () => {
		const store = fill(5);
		try {
			expect(() =>
				store.write((db) => rebuildProjection(db, A, context, 4)),
			).toThrow("LEDGER_TOO_LARGE");
		} finally {
			store.close();
		}
	});

	test("claim fixture sanity: one claim in a scope projects one row", () => {
		const store = openWorld();
		try {
			store.write((db) => apply(db, registerClaim("op-1")));
			expect(store.read(stored).current).toHaveLength(1);
			expect(claim().id).toBe("claim-1");
		} finally {
			store.close();
		}
	});
});
