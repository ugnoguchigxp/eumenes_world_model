import { expect, test } from "bun:test";
import { buildProjection, planAssertionTransition } from "../../src/index.ts";
import { listScopeAssertions } from "../../src/domains/assertions/sqlite.ts";
import { getCurrentRow } from "../../src/domains/projection/sqlite.ts";
import {
	projectLedger,
	rebuildProjection,
} from "../../src/application/sqlite/projection.ts";
import {
	A,
	NOW,
	adopt,
	apply,
	claim,
	envelope,
	hasher,
	hostChecks,
	openWorld,
	registerClaim,
	state,
} from "./world-fixture.ts";

for (const order of [
	["a", "b"],
	["b", "a"],
])
	test(`contradictions survive adoption ${order.join(" then ")} and rebuild`, () => {
		const store = openWorld();
		const context = {
			hasher,
			clock: NOW,
			hostChecks: { ...hostChecks(), sourceSnapshot: { states: [] } },
		};
		try {
			store.write((db) => {
				expect(apply(db, registerClaim("a", { id: "a" })).status).toBe(
					"applied",
				);
				expect(
					apply(
						db,
						registerClaim("b", {
							id: "b",
							contradicts: [{ id: "a", revision: 1 }],
						}),
					).status,
				).toBe("applied");
			});
			for (const id of order)
				store.write((db) =>
					expect(apply(db, adopt(`adopt-${id}`, id)).status).toBe("applied"),
				);
			const assertContested = () =>
				store.read((db) => {
					for (const id of ["a", "b"])
						expect(getCurrentRow(db, A, id, 2)?.causalEligible).toBe(false);
				});
			assertContested();
			const heads = store.read(
				(db) => listScopeAssertions(db, A, { limit: 10 }).items,
			);
			const pure = projectLedger(heads, A, context);
			expect(pure.entries.map((e) => e.causalEligible)).toEqual([false, false]);
			const projection = buildProjection(
				{
					contractVersion: 1,
					snapshot: {
						scope: A,
						asOf: NOW,
						worldEnabled: true,
						complete: true,
						checks: {
							authorized: true,
							correctionsResolved: true,
							restoreVerified: true,
						},
						scopeEpoch: 1,
						policyRevision: "p",
						forgetEpoch: "f",
						restoreEpoch: "r",
						interpretationVersion: "i",
						assertions: heads,
						sources: [state()],
					},
				},
				hasher,
			);
			expect(
				projection.ok && projection.value.entries.map((e) => e.causalEligible),
			).toEqual([false, false]);
			store.write((db) => rebuildProjection(db, A, context));
			assertContested();
			// A content replacement explicitly supersedes the disputed content.
			const planInput = {
				contractVersion: 1,
				scope: A,
				current: {
					id: "a",
					revision: 2,
					scope: A,
					lifecycle: "active",
					origin: "user_report",
				},
				expectedRevision: 2,
				request: { action: "supersede", replacementRevision: 3 },
				registeredAdoptionRules: [],
			};
			const result = planAssertionTransition(planInput);
			if (!result.ok || result.value.status !== "planned")
				throw new Error("plan");
			store.write((db) =>
				expect(
					apply(
						db,
						envelope("replace-a", {
							kind: "assertion.transition",
							plan:
								result.value.status === "planned"
									? result.value.plan
									: undefined,
							replacement: claim({
								id: "a",
								revision: 3,
								supersedes: [{ id: "a", revision: 2 }],
							}),
						}),
					).status,
				).toBe("applied"),
			);
			store.write((db) =>
				expect(apply(db, adopt("adopt-a3", "a", 3)).status).toBe("applied"),
			);
			const before = store.read((db) => [
				getCurrentRow(db, A, "a", 4),
				getCurrentRow(db, A, "b", 2),
			]);
			expect(before.map((r) => r?.causalEligible)).toEqual([true, true]);
			store.write((db) => rebuildProjection(db, A, context));
			expect(
				store.read((db) => [
					getCurrentRow(db, A, "a", 4),
					getCurrentRow(db, A, "b", 2),
				]),
			).toEqual(before);
		} finally {
			store.close();
		}
	});
