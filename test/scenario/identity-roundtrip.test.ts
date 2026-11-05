import { expect, test } from "bun:test";
import { planMerge, planSplit } from "../../src/index.ts";
import { getEntity } from "../../src/domains/identity/sqlite.ts";
import { failingDb, InjectedFailure } from "../support/failing-db.ts";
import { A, apply, dump, envelope, openWorld, probe } from "./world-fixture.ts";
import type { TestStore } from "../support/sqlite-store.ts";

function prepare(store: TestStore) {
	return store.write((db) => {
		for (const id of ["one", "two"])
			expect(
				apply(
					db,
					envelope(`register-${id}`, {
						kind: "entity.register",
						entity: {
							id,
							displayName: id,
							aliases: [`alias-${id}`],
							externalRefs: [],
						},
					}),
				).status,
			).toBe("applied");
		const merged = planMerge({
			contractVersion: 1,
			scope: A,
			operationId: "merge",
			representativeId: "one",
			targetIds: ["one", "two"],
			expectedRevisions: { one: 1, two: 1 },
			evidence: ["explicit-evidence"],
			entities: [getEntity(db, A, "one"), getEntity(db, A, "two")],
		});
		if (!merged.ok || merged.value.status !== "planned")
			throw new Error(JSON.stringify(merged));
		expect(
			apply(
				db,
				envelope("merge", { kind: "entity.merge", plan: merged.value.plan }),
			).status,
		).toBe("applied");
		const split = planSplit({
			contractVersion: 1,
			scope: A,
			operationId: "split",
			mergeOperationId: "merge",
			expectedRevision: 2,
			history: [merged.value.plan],
			splitMergeOperationIds: [],
			entities: [getEntity(db, A, "one"), getEntity(db, A, "two")],
		});
		if (!split.ok || split.value.status !== "planned")
			throw new Error(JSON.stringify(split));
		return envelope("split", { kind: "entity.split", plan: split.value.plan });
	});
}

test("application merge→split restores mappings; replay is once and every split DML rolls back with host rows", () => {
	const store = openWorld();
	let stages = 0;
	try {
		const operation = prepare(store);
		store.write((db) => {
			const wrapped = failingDb(db, 0);
			expect(apply(wrapped, operation).status).toBe("applied");
			stages = wrapped.dmlCount;
		});
		store.read((db) => {
			expect(getEntity(db, A, "one")).toMatchObject({
				revision: 3,
				aliases: ["alias-one"],
			});
			expect(getEntity(db, A, "two")).toMatchObject({
				revision: 3,
				aliases: ["alias-two"],
			});
			expect(getEntity(db, A, "two")?.mergedInto).toBeUndefined();
		});
		const before = dump(store);
		expect(store.write((db) => apply(db, operation)).status).toBe("no_op");
		expect(dump(store)).toEqual(before);
	} finally {
		store.close();
	}
	expect(stages).toBeGreaterThan(1);
	for (let stage = 1; stage <= stages; stage++) {
		const failed = openWorld();
		try {
			const operation = prepare(failed);
			const before = dump(failed);
			expect(() =>
				failed.write((db) => {
					probe(db);
					apply(failingDb(db, stage), operation);
				}),
			).toThrow(InjectedFailure);
			expect(dump(failed)).toEqual(before);
		} finally {
			failed.close();
		}
	}
});
