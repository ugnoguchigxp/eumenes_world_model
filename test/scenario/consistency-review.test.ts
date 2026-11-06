import { expect, test } from "bun:test";
import {
	planAssertionTransition,
	validateAssertion,
	buildWorldSlice,
	toSliceReceipt,
	type TransitionRequest,
} from "../../src/index.ts";
import { readWorldSnapshot, validateWorldUsage } from "../../src/sqlite.ts";
import {
	getAssertion,
	insertAssertion,
	insertEvidence,
	insertInputs,
} from "../../src/domains/assertions/sqlite.ts";
import type { TestStore } from "../support/sqlite-store.ts";
import {
	A,
	access,
	adopt,
	apply,
	claim,
	dump,
	envelope,
	hasher,
	hostChecks,
	openWorld,
	registerClaim,
} from "./world-fixture.ts";

function planned(store: TestStore, request: TransitionRequest) {
	const c = store.read((db) => getAssertion(db, A, "claim-1"))!;
	const r = planAssertionTransition({
		contractVersion: 1,
		scope: A,
		current: {
			id: c.id,
			revision: c.revision,
			scope: A,
			lifecycle: c.lifecycle,
			origin: c.origin,
		},
		expectedRevision: c.revision,
		request,
		registeredAdoptionRules: [],
	});
	if (!r.ok || r.value.status !== "planned") throw new Error("PLAN_FAILED");
	return r.value.plan;
}
for (const action of [
	"adopt",
	"dispute",
	"resolve",
	"supersede",
	"retract",
	"invalidate",
] as const)
	test(`${action}: a structurally valid forged plan cannot alter canonical transition effects`, () => {
		const store = openWorld();
		try {
			store.write((db) => {
				expect(apply(db, registerClaim()).status).toBe("applied");
				expect(apply(db, registerClaim("other", { id: "other" })).status).toBe(
					"applied",
				);
				if (action !== "adopt")
					expect(apply(db, adopt()).status).toBe("applied");
			});
			if (action === "resolve") {
				const dispute = planned(store, {
					action: "dispute",
					contradicts: [{ id: "other", revision: 1 }],
				});
				store.write((db) =>
					expect(
						apply(
							db,
							envelope("dispute-first", {
								kind: "assertion.transition",
								plan: dispute,
							}),
						).status,
					).toBe("applied"),
				);
			}
			const request: TransitionRequest =
				action === "adopt"
					? {
							action,
							adoption: { kind: "explicit", operationId: "host-adoption" },
							subjectConfirmedByHost: true,
						}
					: action === "dispute"
						? { action, contradicts: [{ id: "other", revision: 1 }] }
						: action === "resolve"
							? {
									action,
									resolution: { id: "resolution", revision: 1 },
									reasonCode: "HOST_RESOLVED",
								}
							: action === "supersede"
								? { action, replacementRevision: 3 }
								: action === "retract"
									? { action, reasonSource: claim().inputManifest[0]! }
									: { action, reasonCode: "INPUT_VERSION_INVALIDATED" };
			const plan = planned(store, request),
				self = { id: plan.id, revision: plan.expectedRevision };
			const forged =
				action === "adopt"
					? { ...plan, stopsUseOf: [self] }
					: action === "resolve" || action === "dispute"
						? {
								...plan,
								adoption: {
									kind: "explicit" as const,
									operationId: "not-this-action",
								},
							}
						: { ...plan, stopsUseOf: [] };
			const replacement =
				action === "supersede"
					? claim({ revision: 3, supersedes: [self] })
					: undefined;
			const before = dump(store);
			store.write((db) =>
				expect(
					apply(
						db,
						envelope("forged", {
							kind: "assertion.transition",
							plan: forged,
							...(replacement ? { replacement } : {}),
						}),
					),
				).toEqual({ status: "rejected", reasonCode: "TRANSITION_NOT_ALLOWED" }),
			);
			expect(dump(store)).toEqual(before);
			store.write((db) =>
				expect(
					apply(
						db,
						envelope("valid", {
							kind: "assertion.transition",
							plan,
							...(replacement ? { replacement } : {}),
						}),
					).status,
				).toBe("applied"),
			);
			if (plan.stopsUseOf.length)
				expect(
					store.read(
						(db) =>
							getAssertion(db, A, plan.id, plan.expectedRevision)?.lifecycle,
					),
				).toBe(plan.to);
		} finally {
			store.close();
		}
	});

test("pure validation and persistence share evidence, origin and unconditional checks", () => {
	const store = openWorld();
	try {
		const before = dump(store);
		for (const [c, code] of [
			[
				claim({
					condition: {
						kind: "explicitly_unconditional",
						adoptionEvidenceId: "missing",
					},
				}),
				"UNCONDITIONAL_WITHOUT_EVIDENCE",
			],
			[claim({ origin: "runtime_observation" }), "MISSING_OBSERVED_AT"],
			[claim({ origin: "document_claim" }), "ORIGIN_EVIDENCE_MISMATCH"],
		] as const) {
			const { rootEvidenceIds: _roots, lifecycle: _lifecycle, ...draft } = c;
			expect(
				validateAssertion(
					{
						contractVersion: 1,
						scope: A,
						draft,
						sources: hostChecks().sourceSnapshot,
						entities: [
							{
								id: c.subjectId,
								scope: A,
								revision: 1,
								displayName: "service",
								aliases: [],
								externalRefs: [],
							},
						],
					},
					hasher,
				),
			).toMatchObject({
				ok: true,
				value: {
					status: "rejected",
					reasonCodes: expect.arrayContaining([code]),
				},
			});
			store.write((db) =>
				expect(
					apply(
						db,
						envelope(`invalid-${code}`, {
							kind: "assertion.register",
							assertion: c,
						}),
					),
				).toEqual({ status: "rejected", reasonCode: code }),
			);
			expect(dump(store)).toEqual(before);
		}
		const backed = claim({
			condition: {
				kind: "explicitly_unconditional",
				adoptionEvidenceId: "ev-1",
			},
		});
		store.write((db) =>
			expect(
				apply(
					db,
					envelope("valid-backed", {
						kind: "assertion.register",
						assertion: backed,
					}),
				).status,
			).toBe("applied"),
		);
	} finally {
		store.close();
	}
});

test("legacy active content is blocked on read/use while cleanup still works", () => {
	const store = openWorld();
	try {
		store.write((db) => {
			apply(db, registerClaim());
			apply(db, adopt());
		});
		const current = {
			contractVersion: 1,
			scope: A,
			access: access(),
			hostChecks: hostChecks(),
		};
		const read = store.read((db) =>
			readWorldSnapshot(db, { ...current, asOf: 1791500000000 }),
		);
		if (read.status !== "ready") throw new Error(read.reasonCode);
		const oldSlice = buildWorldSlice(
			{
				contractVersion: 1,
				snapshot: read.snapshot,
				request: {},
			},
			hasher,
		);
		if (!oldSlice.ok) throw new Error(oldSlice.code);
		// Recreate a legacy persisted active row with the same receipt identity.
		// Content checks must block read/use even without an epoch change.
		const legacy = {
			...read.snapshot.assertions[0]!,
			condition: {
				kind: "explicitly_unconditional" as const,
				adoptionEvidenceId: "missing",
			},
		};
		store.write((db) =>
			db
				.query(
					"UPDATE world_assertion SET payload_json=? WHERE id=? AND revision=?",
				)
				.run(JSON.stringify(legacy), legacy.id, legacy.revision),
		);
		expect(
			store.read((db) =>
				readWorldSnapshot(db, { ...current, asOf: 1791500000000 }),
			),
		).toMatchObject({
			status: "blocked",
			reasonCode: "ASSERTION_CONTENT_INVALID",
		});
		expect(
			store.write((db) =>
				validateWorldUsage(db, toSliceReceipt(oldSlice.value), current),
			).status,
		).toBe("blocked");
		const stop = planned(store, {
			action: "invalidate",
			reasonCode: "INPUT_VERSION_INVALIDATED",
		});
		store.write((db) =>
			expect(
				apply(
					db,
					envelope("cleanup-active", {
						kind: "assertion.transition",
						plan: stop,
					}),
				).status,
			).toBe("applied"),
		);
		expect(
			store.read((db) =>
				readWorldSnapshot(db, { ...current, asOf: 1791500000000 }),
			),
		).toMatchObject({ status: "ready", snapshot: { assertions: [] } });
	} finally {
		store.close();
	}
});

test("an invalid legacy candidate cannot become active, but invalidation remains available", () => {
	const store = openWorld();
	try {
		// Test-only raw repository seed represents a pre-fix persisted candidate.
		const c = claim({
			condition: {
				kind: "explicitly_unconditional",
				adoptionEvidenceId: "missing",
			},
		});
		store.write((db) => {
			expect(insertAssertion(db, c).status).toBe("applied");
			insertEvidence(db, A, { id: c.id, revision: 1 }, c.evidence);
			insertInputs(db, A, { id: c.id, revision: 1 }, c.inputManifest);
		});
		const before = dump(store);
		store.write((db) =>
			expect(apply(db, adopt())).toEqual({
				status: "rejected",
				reasonCode: "UNCONDITIONAL_WITHOUT_EVIDENCE",
			}),
		);
		expect(dump(store)).toEqual(before);
		const stop = planned(store, {
			action: "invalidate",
			reasonCode: "INPUT_VERSION_INVALIDATED",
		});
		store.write((db) =>
			expect(
				apply(
					db,
					envelope("cleanup", { kind: "assertion.transition", plan: stop }),
				).status,
			).toBe("applied"),
		);
		expect(store.read((db) => getAssertion(db, A, c.id)?.lifecycle)).toBe(
			"invalidated",
		);
	} finally {
		store.close();
	}
});
