import { expect, test } from "bun:test";
import { evaluateConditions } from "../../src/index.ts";
import { applyWorldOperation, validateWorldUsage } from "../../src/sqlite.ts";
import { getOutcome } from "../../src/domains/scenarios/sqlite.ts";
import { openTestStore, type TestStore } from "../support/sqlite-store.ts";
import { loadQuality } from "../../eval/api-quality/dataset.ts";
import {
	auditRepresentation,
	singleQuoteRepresentation,
} from "../../eval/api-quality/contract-audit.ts";
import {
	access,
	CLEAR_CONTRACT,
	cycleFixture,
	hasher,
	NOW,
	SCOPE,
} from "../../eval/scenarios/contract-update/fixture.ts";
import {
	correctCycle,
	observeCycle,
	prepareCycle,
	readCycle,
	replayObservation,
	usage,
} from "../../eval/scenarios/contract-update/runner.ts";

const fixture = () =>
	cycleFixture(
		auditRepresentation(loadQuality("independent"), singleQuoteRepresentation),
	);
function withStore(
	run: (store: TestStore, f: ReturnType<typeof fixture>) => void,
) {
	const store = openTestStore();
	try {
		run(store, fixture());
	} finally {
		store.close();
	}
}
const revisions = (store: TestStore) =>
	store.read((db) =>
		db
			.query(
				"SELECT id, revision, lifecycle FROM world_assertion ORDER BY id, revision",
			)
			.all(),
	);
const outcomeCount = (store: TestStore) =>
	store.read((db) => db.query("SELECT count(*) AS n FROM world_outcome").get());

test("one job: real audit -> observed result -> supplied correction -> fresh decision context", () =>
	withStore((store, f) => {
		const { before } = prepareCycle(store, f);
		expect(before.slice.status).toBe("ready");
		expect(usage(store, f, before.receipt).status).toBe("valid");
		expect(
			before.slice.units.find((u) => u.assertionId === "next-step"),
		).toMatchObject({
			revision: 2,
			conclusion: { payload: { value: { value: "run-offline-audit" } } },
		});
		expect(
			evaluateConditions({
				contractVersion: 1,
				authorized: true,
				asOf: NOW,
				maxAgeMs: 1,
				condition: CLEAR_CONTRACT,
				observations: [],
			}),
		).toMatchObject({ ok: true, value: { result: "unknown" } });
		const observed = observeCycle(store, f);
		expect(observed.assessment).toMatchObject({
			verdict: "supported",
			causalProof: false,
		});
		expect(observed.outcome.value).toBe(1);
		expect(observed.policy.result).toBe("violated");
		expect(observed.dependencies.outcome).toBe("unsatisfied");
		expect(observed.influence.paths).toEqual([]);
		expect(observed.influence.skipped).toContainEqual({
			edgeId: "diagnostic-association",
			reasonCode: "NON_CAUSAL_RELATION",
		});
		expect(usage(store, f, before.receipt).status).toBe("blocked");
		const beforeCorrection = revisions(store);
		expect(correctCycle(store, f, before.receipt).status).toBe("blocked");
		expect(revisions(store)).toEqual(beforeCorrection);
		expect(correctCycle(store, f, observed.context.receipt).status).toBe(
			"applied",
		);
		expect(usage(store, f, observed.context.receipt).status).toBe("blocked");
		const after = readCycle(store, f);
		expect(usage(store, f, after.receipt).status).toBe("valid");
		const next = after.slice.units.find((u) => u.assertionId === "next-step")!;
		expect(next).toMatchObject({
			revision: 4,
			conclusion: {
				payload: { value: { value: "repair-output-evidence-contract" } },
			},
		});
		expect(next.sources.map((s) => s.id)).toEqual([
			"after",
			"audit",
			"operator",
		]);
		expect(after.slice.assertionVersions).not.toContainEqual({
			id: "next-step",
			revision: 2,
		});
		expect(
			after.slice.units.find((u) => u.assertionId === "paid-run-policy")!
				.condition,
		).toEqual(CLEAR_CONTRACT);
		// Numeric support never promotes the causal hypothesis or association.
		expect(
			after.edges
				.filter((e) =>
					["budget-hypothesis", "diagnostic-association"].includes(e.id),
				)
				.every((e) => e.status === "candidate" && !e.causalEligible),
		).toBe(true);
		expect(replayObservation(store, f).status).toBe("no_op");
		expect(usage(store, f, after.receipt).status).toBe("valid");
	}));

test("an unmeasured proposal cannot update the decision", () =>
	withStore((store, f) => {
		const { before } = prepareCycle(store, f);
		const rows = revisions(store);
		expect(correctCycle(store, f, before.receipt)).toMatchObject({
			status: "blocked",
			reasonCode: "OBSERVATION_NOT_IN_DECISION_CONTEXT",
		});
		expect(revisions(store)).toEqual(rows);
	}));

test("observation configuration comes from the evaluator, not the prediction", () =>
	withStore((store, f) => {
		prepareCycle(store, f);
		f.measurement.conditions.inputProfile = "different-fixture-revision";
		const observed = observeCycle(store, f);
		expect(observed.assessment).toMatchObject({
			verdict: "incomparable",
			incomparableReasons: [{ reason: "INPUT_PROFILE_MISMATCH", count: 1 }],
		});
		const rows = revisions(store);
		expect(correctCycle(store, f, observed.context.receipt)).toMatchObject({
			status: "blocked",
			reasonCode: "MEASUREMENT_NOT_COMPARABLE",
		});
		expect(revisions(store)).toEqual(rows);
	}));

test("missing source rolls back the outcome and observation together", () =>
	withStore((store, f) => {
		const { before } = prepareCycle(store, f);
		const rows = revisions(store),
			count = outcomeCount(store);
		const unknown = {
			...f,
			hostChecks: {
				...f.hostChecks,
				sourceSnapshot: {
					states: f.hostChecks.sourceSnapshot.states.map((s) =>
						s.id === f.sources.audit.id
							? { ...s, status: "missing" as const }
							: s,
					),
				},
			},
		};
		expect(() => observeCycle(store, unknown)).toThrow();
		expect(outcomeCount(store)).toEqual(count);
		expect(revisions(store)).toEqual(rows);
		expect(usage(store, f, before.receipt).status).toBe("valid");
	}));

test("authorization and a closed host gate block a valid receipt", () =>
	withStore((store, f) => {
		const { before } = prepareCycle(store, f);
		const rows = revisions(store);
		expect(
			store.write((db) =>
				validateWorldUsage(db, before.receipt, {
					contractVersion: 1,
					scope: SCOPE,
					access: { ...access, scopeKeys: [] },
					hostChecks: f.hostChecks,
				}),
			).status,
		).toBe("blocked");
		expect(
			correctCycle(
				store,
				{ ...f, hostChecks: { ...f.hostChecks, gate: "closed" } },
				before.receipt,
			).status,
		).toBe("blocked");
		expect(revisions(store)).toEqual(rows);
	}));

test("host rollback preserves both the old revision and the usable receipt", () =>
	withStore((store, f) => {
		prepareCycle(store, f);
		const observed = observeCycle(store, f);
		const rows = revisions(store);
		const aborting: TestStore = {
			...store,
			write: (fn) =>
				store.write((db) => {
					fn(db);
					throw new Error("HOST_FOLLOWUP_FAILED");
				}),
		};
		expect(() => correctCycle(aborting, f, observed.context.receipt)).toThrow(
			"HOST_FOLLOWUP_FAILED",
		);
		expect(revisions(store)).toEqual(rows);
		expect(usage(store, f, observed.context.receipt).status).toBe("valid");
	}));

test("raw outcome correction cannot adopt a proposal pinned to the old measurement", () =>
	withStore((store, f) => {
		const initial = prepareCycle(store, f),
			observed = observeCycle(store, f);
		store.write((db) =>
			expect(
				applyWorldOperation(
					db,
					{
						contractVersion: 1,
						access,
						scope: SCOPE,
						operationKey: "outcome-only",
						clock: NOW,
						hostChecks: f.hostChecks,
						operation: {
							kind: "outcome.register",
							input: {
								predictionId: initial.prediction.predictionId,
								outcome: { ...observed.outcome, revision: 2, value: 0 },
							},
						},
					},
					{ hasher },
				).status,
			).toBe("applied"),
		);
		expect(correctCycle(store, f, observed.context.receipt)).toMatchObject({
			status: "blocked",
			reasonCode: "MEASUREMENT_BASIS_CHANGED",
		});
		const audit = auditRepresentation(
			loadQuality("independent"),
			singleQuoteRepresentation,
		);
		const corrected = cycleFixture(
			{ ...audit, issues: [], status: "no_capacity_conflict" },
			2,
		);
		const reflected = observeCycle(store, corrected);
		expect(reflected.assessment).toMatchObject({ verdict: "incomparable" });
		expect(usage(store, corrected, observed.context.receipt).status).toBe(
			"blocked",
		);
	}));

test("a refuting correction replaces a previously supported measurement", () =>
	withStore((store, f) => {
		// Synthetic, predeclared numerical reference; never a changed frozen gold.
		f.prediction = {
			...f.prediction,
			baselineValue: 2,
			baselineRef: "fixture-reference-two",
			expectedDirection: "decreases",
		};
		f.measurement.baselineRef = "fixture-reference-two";
		prepareCycle(store, f);
		const first = observeCycle(store, f);
		expect(first.assessment).toMatchObject({ verdict: "supported" });
		const audit = auditRepresentation(
			loadQuality("independent"),
			singleQuoteRepresentation,
		);
		const correctedAudit = {
			...audit,
			issues: [0, 1, 2].map((i) => ({
				...audit.issues[0]!,
				caseId: `synthetic-correction-${i}`,
			})),
		};
		const corrected = cycleFixture(correctedAudit, 2);
		corrected.measurement.baselineRef = "fixture-reference-two";
		const next = observeCycle(store, corrected);
		expect(next.assessment).toMatchObject({
			verdict: "refuted",
			causalProof: false,
		});
		expect(usage(store, corrected, first.context.receipt).status).toBe(
			"blocked",
		);
		expect(correctCycle(store, f, first.context.receipt).status).toBe(
			"blocked",
		);
	}));

test("reflection atomically replaces the observation and invalidates an already adopted decision", () =>
	withStore((store, f) => {
		prepareCycle(store, f);
		const first = observeCycle(store, f);
		expect(correctCycle(store, f, first.context.receipt).status).toBe(
			"applied",
		);
		const old = readCycle(store, f);
		const audit = auditRepresentation(
			loadQuality("independent"),
			singleQuoteRepresentation,
		);
		const corrected = cycleFixture(
			{ ...audit, issues: [], status: "no_capacity_conflict" },
			2,
		);
		const next = observeCycle(store, corrected);
		expect(next.assessment).toMatchObject({ verdict: "incomparable" });
		expect(usage(store, corrected, old.receipt).status).toBe("blocked");
		expect(
			next.context.slice.units.find((u) => u.assertionId === "next-step"),
		).toBeUndefined();
		expect(
			next.context.slice.units.find((u) => u.assertionId === f.observation.id),
		).toMatchObject({ revision: 4 });
		expect(correctCycle(store, corrected, next.context.receipt)).toMatchObject({
			status: "blocked",
			reasonCode: "MEASUREMENT_NOT_COMPARABLE",
		});
		const rows = revisions(store);
		observeCycle(store, corrected);
		expect(revisions(store)).toEqual(rows);
	}));

test("failed observation correction rolls back outcome and derived context together", () =>
	withStore((store, f) => {
		prepareCycle(store, f);
		const first = observeCycle(store, f),
			rows = revisions(store);
		const corrected = cycleFixture(
			auditRepresentation(
				loadQuality("independent"),
				singleQuoteRepresentation,
			),
			2,
		);
		const denied = {
			...corrected,
			hostChecks: {
				...corrected.hostChecks,
				sourceSnapshot: {
					states: corrected.hostChecks.sourceSnapshot.states.map((s) =>
						s.id === corrected.sources.audit.id
							? { ...s, status: "missing" as const }
							: s,
					),
				},
			},
		};
		expect(() => observeCycle(store, denied)).toThrow();
		expect(
			store.read((db) => getOutcome(db, SCOPE, f.observation.id, 2)),
		).toBeUndefined();
		expect(revisions(store)).toEqual(rows);
		expect(usage(store, f, first.context.receipt).status).toBe("valid");
	}));

test("skipped measurement revisions use the actual observation version; late reflection cannot roll it back", () =>
	withStore((store, f) => {
		prepareCycle(store, f);
		observeCycle(store, f);
		const audit = auditRepresentation(
			loadQuality("independent"),
			singleQuoteRepresentation,
		);
		const third = cycleFixture(audit, 3),
			latest = observeCycle(store, third);
		expect(
			latest.context.slice.units.find((u) => u.assertionId === f.observation.id)
				?.revision,
		).toBe(4);
		expect(correctCycle(store, third, latest.context.receipt).status).toBe(
			"applied",
		);
		const after = readCycle(store, third),
			rows = revisions(store);
		const late = cycleFixture(
			{ ...audit, issues: [], status: "no_capacity_conflict" },
			2,
		);
		expect(() => observeCycle(store, late)).toThrow("STALE_OUTCOME_REVISION");
		expect(revisions(store)).toEqual(rows);
		expect(usage(store, third, after.receipt).status).toBe("valid");
	}));
