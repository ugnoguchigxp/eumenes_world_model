/** Real SQLite integration; semantic decisions and host approvals are fixtures. */
import {
	assessOutcome,
	buildProjection,
	buildWorldSlice,
	checkDependencies,
	edgesFromEntries,
	evaluateConditions,
	planAssertionTransition,
	toSliceReceipt,
	traceInfluence,
	sourceIdentityKey,
	type Assertion,
	type Checked,
	type Outcome,
	type SliceReceipt,
	type TransitionRequest,
} from "../../../src/index.ts";
import {
	applyWorldOperation,
	readWorldSnapshot,
	validateWorldUsage,
	type WorldOperation,
} from "../../../src/sqlite.ts";
import {
	getOutcome,
	getPrediction,
	getLatestOutcome,
} from "../../../src/domains/scenarios/sqlite.ts";
import { getAssertion } from "../../../src/domains/assertions/sqlite.ts";
import type { TestStore } from "../../../test/support/sqlite-store.ts";
import {
	access,
	CLEAR_CONTRACT,
	GOAL,
	hasher,
	NOW,
	SCOPE,
	type CycleFixture,
} from "./fixture.ts";

function must<T>(r: Checked<T>): T {
	if (!r.ok) throw new Error(`${r.code}:${r.path}`);
	return r.value;
}
const current = (f: CycleFixture) => ({
	contractVersion: 1,
	scope: SCOPE,
	access,
	hostChecks: f.hostChecks,
});
const operation = (
	f: CycleFixture,
	operationKey: string,
	op: WorldOperation,
) => ({ ...current(f), operationKey, clock: NOW, operation: op });
function plan(a: Assertion, request: TransitionRequest) {
	const result = must(
		planAssertionTransition({
			contractVersion: 1,
			scope: SCOPE,
			current: {
				id: a.id,
				revision: a.revision,
				scope: a.scope,
				lifecycle: a.lifecycle,
				origin: a.origin,
			},
			expectedRevision: a.revision,
			request,
			registeredAdoptionRules: [],
		}),
	);
	if (result.status !== "planned") throw new Error(result.reasonCode);
	return result.plan;
}
function apply(
	store: TestStore,
	f: CycleFixture,
	key: string,
	op: WorldOperation,
) {
	const result = store.write((db) =>
		applyWorldOperation(db, operation(f, key, op), { hasher }),
	);
	if ("reasonCode" in result) throw new Error(result.reasonCode);
	return result;
}
const adoption = (a: Assertion) => ({
	kind: "assertion.transition" as const,
	plan: plan(a, {
		action: "adopt",
		adoption: {
			kind: "explicit",
			operationId: `fixture-approval-${a.id}-${a.revision}`,
		},
		subjectConfirmedByHost: true,
	}),
});

export function readCycle(store: TestStore, f: CycleFixture) {
	return store.read((db) => {
		const read = readWorldSnapshot(db, { ...current(f), asOf: NOW });
		if (read.status !== "ready") throw new Error(read.reasonCode);
		const slice = must(
			buildWorldSlice(
				{
					contractVersion: 1,
					snapshot: read.snapshot,
					request: { goalRef: { id: GOAL.goalId, revision: GOAL.revision } },
				},
				hasher,
			),
		);
		const projection = must(
			buildProjection({ contractVersion: 1, snapshot: read.snapshot }, hasher),
		);
		return {
			slice,
			receipt: toSliceReceipt(slice),
			edges: edgesFromEntries(projection.entries),
		};
	});
}

export function prepareCycle(store: TestStore, f: CycleFixture) {
	for (const a of f.initial) {
		apply(store, f, `register-${a.id}`, {
			kind: "assertion.register",
			assertion: a,
		});
		if (f.adoptInitial.includes(a.id))
			apply(store, f, `adopt-${a.id}`, adoption(a));
	}
	const prediction = f.prediction;
	apply(store, f, "register-prediction", {
		kind: "prediction.register",
		input: {
			prediction,
			dueAt: NOW + 1,
			basis: { assertionId: "budget-hypothesis", revision: 1 },
		},
	});
	return { prediction, before: readCycle(store, f) };
}

export function observeCycle(store: TestStore, f: CycleFixture) {
	const value = f.observation.payload;
	if (value.kind !== "value" || value.value.kind !== "number")
		throw new Error("NUMERIC_OBSERVATION_REQUIRED");
	const p = store.read((db) =>
		getPrediction(db, SCOPE, "audit-prediction", 1),
	)?.prediction;
	if (!p || p.kind !== "quantitative") throw new Error("PREDICTION_NOT_FOUND");
	const outcome: Outcome = {
		kind: "outcome",
		outcomeId: f.observation.id,
		revision: f.outcomeRevision,
		comparisonId: p.comparisonId,
		predictionRevision: p.revision,
		...f.measurement,
		value: value.value.value,
	};
	// The test host owns this transaction; a rejected step must roll back all rows.
	store.write((db) => {
		const old = getAssertion(db, SCOPE, f.observation.id);
		const latest = getLatestOutcome(db, SCOPE, outcome.outcomeId);
		if (latest && latest.outcome.revision > outcome.revision)
			throw new Error("STALE_OUTCOME_REVISION");
		const known = getOutcome(db, SCOPE, outcome.outcomeId, outcome.revision);
		if (
			known &&
			old?.inputManifest.some(
				(s) =>
					sourceIdentityKey(s) === sourceIdentityKey(f.sources.audit) &&
					s.revision === f.sources.audit.revision,
			)
		) {
			const same = old?.inputManifest.some(
				(s) =>
					sourceIdentityKey(s) === sourceIdentityKey(f.sources.audit) &&
					s.revision === f.sources.audit.revision &&
					s.digest === f.sources.audit.digest,
			);
			if (!same) throw new Error("OBSERVATION_REVISION_CONFLICT");
			const replay = applyWorldOperation(
				db,
				operation(
					f,
					f.outcomeRevision === 1
						? "observe-0"
						: `observe-${f.outcomeRevision}-0`,
					{
						kind: "outcome.register",
						input: { predictionId: p.predictionId, outcome },
					},
				),
				{ hasher },
			);
			if ("reasonCode" in replay) throw new Error(replay.reasonCode);
			return;
		}
		let observation = f.observation;
		const ops: WorldOperation[] = [
			{
				kind: "outcome.register",
				input: { predictionId: p.predictionId, outcome },
			},
		];
		if (!old) ops.push({ kind: "assertion.register", assertion: observation });
		else {
			observation = {
				...observation,
				revision: old.revision + 1,
				supersedes: [{ id: old.id, revision: old.revision }],
			};
			ops.push({
				kind: "assertion.transition",
				plan: plan(old, {
					action: "supersede",
					replacementRevision: observation.revision,
				}),
				replacement: observation,
			});
			// Explicit fixture-host dependency: the adopted next step used this
			// observation. Stop it in the SAME transaction as the new measurement.
			const decision = getAssertion(db, SCOPE, f.replacement.id);
			if (
				decision &&
				decision.inputManifest.some(
					(s) => sourceIdentityKey(s) === sourceIdentityKey(f.sources.audit),
				)
			)
				ops.push({
					kind: "invalidate",
					reasonCode: "INPUT_VERSION_INVALIDATED",
					targets: [{ id: decision.id, expectedRevision: decision.revision }],
				});
		}
		ops.push(adoption(observation));
		for (const [i, op] of ops.entries()) {
			const key =
				f.outcomeRevision === 1
					? `observe-${i}`
					: `observe-${f.outcomeRevision}-${i}`;
			const result = applyWorldOperation(db, operation(f, key, op), {
				hasher,
			});
			if ("reasonCode" in result) throw new Error(result.reasonCode);
		}
	});
	const stored = store.read((db) =>
		getOutcome(db, SCOPE, outcome.outcomeId, outcome.revision),
	);
	if (!stored) throw new Error("OUTCOME_NOT_FOUND");
	const assessment = must(
		assessOutcome({
			contractVersion: 1,
			scope: SCOPE,
			prediction: p,
			observations: [stored.outcome],
		}),
	);
	const context = readCycle(store, f);
	const observations = [
		{
			observationId: f.observation.id,
			key: "representation_conflicts",
			value: value.value,
			observedAt: NOW,
			version: "1",
			priority: 1,
		},
	];
	const graph = {
		contractVersion: 1,
		scope: SCOPE,
		authorized: true,
		edges: context.edges,
		asOf: NOW,
		maxAgeMs: 1,
		observations,
	};
	return {
		assessment,
		outcome: stored.outcome,
		context,
		policy: must(
			evaluateConditions({
				contractVersion: 1,
				authorized: true,
				asOf: NOW,
				maxAgeMs: 1,
				condition: CLEAR_CONTRACT,
				observations,
			}),
		),
		// Availability is an explicit test-host observation, never inferred from text.
		dependencies: must(
			checkDependencies({
				...graph,
				entityId: "paid-evaluation",
				resourceStates: [
					{ entityId: "reviewed-contract", state: "unavailable" },
				],
			}),
		),
		influence: must(
			traceInfluence({
				...graph,
				entityId: "representation-conflict",
				direction: "forward",
			}),
		),
	};
}

/** A supplied semantic proposal is applied only after receipt revalidation. */
export function correctCycle(
	store: TestStore,
	f: CycleFixture,
	receipt: SliceReceipt,
) {
	const previous = {
		...f.initial[0]!,
		revision: 2,
		lifecycle: "active" as const,
	};
	const supersede = plan(previous, {
		action: "supersede",
		replacementRevision: 3,
	});
	const replacement: Assertion = {
		...f.replacement,
		revision: 3,
		supersedes: [{ id: previous.id, revision: 2 }],
		inputManifest: [f.sources.operator, f.sources.audit, f.sources.after],
		evidence: [...f.replacement.evidence, ...f.observation.evidence],
		rootEvidenceIds: ["after", "audit"],
	};
	return store.write((db) => {
		const valid = validateWorldUsage(db, receipt, current(f));
		if (valid.status !== "valid") return valid;
		const basis = f.replacementBasis;
		const usedObservation = receipt.assertionVersions.find(
			(a) => a.id === basis.assertion.id,
		);
		if (!usedObservation)
			return {
				status: "blocked" as const,
				reasonCode: "OBSERVATION_NOT_IN_DECISION_CONTEXT",
			};
		const p = getPrediction(
			db,
			SCOPE,
			basis.prediction.id,
			basis.prediction.revision,
		);
		const o = getOutcome(db, SCOPE, basis.outcome.id, basis.outcome.revision);
		if (!p || !o || o.predictionId !== basis.prediction.id)
			return {
				status: "blocked" as const,
				reasonCode: "MEASUREMENT_BASIS_MISSING",
			};
		const observation = getAssertion(
			db,
			SCOPE,
			usedObservation.id,
			usedObservation.revision,
		);
		if (
			!observation ||
			observation.origin !== "runtime_observation" ||
			!observation.inputManifest.some(
				(s) =>
					sourceIdentityKey(s) === sourceIdentityKey(f.sources.audit) &&
					s.revision === f.sources.audit.revision &&
					s.digest === f.sources.audit.digest,
			) ||
			observation.payload.kind !== "value" ||
			observation.payload.value.kind !== "number" ||
			observation.payload.value.value !== o.outcome.value ||
			observation.payload.value.unit !== o.outcome.conditions.unit ||
			observation.predicate !== o.outcome.conditions.metric ||
			observation.subjectId !== o.outcome.conditions.subjectId
		)
			return {
				status: "blocked" as const,
				reasonCode: "MEASUREMENT_BASIS_CHANGED",
			};
		const latest = getLatestOutcome(db, SCOPE, basis.outcome.id);
		if (
			!latest ||
			latest.predictionId !== basis.prediction.id ||
			latest.outcome.revision !== basis.outcome.revision
		)
			return {
				status: "blocked" as const,
				reasonCode: "MEASUREMENT_BASIS_CHANGED",
			};
		const assessment = must(
			assessOutcome({
				contractVersion: 1,
				scope: SCOPE,
				prediction: p.prediction,
				observations: [o.outcome],
			}),
		);
		if (assessment.status !== "assessed" || assessment.counts.incomparable > 0)
			return {
				status: "blocked" as const,
				reasonCode: "MEASUREMENT_NOT_COMPARABLE",
			};
		for (const [key, op] of [
			[
				"correct-next-step",
				{ kind: "assertion.transition", plan: supersede, replacement },
			],
			["adopt-corrected-next-step", adoption(replacement)],
		] as const) {
			const result = applyWorldOperation(db, operation(f, key, op), { hasher });
			if ("reasonCode" in result) throw new Error(result.reasonCode);
		}
		return { status: "applied" as const };
	});
}

export function usage(
	store: TestStore,
	f: CycleFixture,
	receipt: SliceReceipt,
) {
	return store.write((db) => validateWorldUsage(db, receipt, current(f)));
}
export function replayObservation(store: TestStore, f: CycleFixture) {
	return apply(store, f, "observe-1", {
		kind: "assertion.register",
		assertion: f.observation,
	});
}
