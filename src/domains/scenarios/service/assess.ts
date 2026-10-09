import { compare, negate, subtract, toDecimal, toNumber } from "./decimal.ts";
import {
	asRecord,
	checkContractVersion,
	checkScope,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
} from "../../../contracts/index.ts";
import {
	checkOutcome,
	checkPrediction,
	type ExpectedDirection,
	type Outcome,
	type QuantitativePrediction,
} from "../contracts/index.ts";

export const maxOutcomeObservations = 64;

export type IncomparableReason =
	| "COMPARISON_ID_MISMATCH"
	| "PREDICTION_REVISION_MISMATCH"
	| "SUBJECT_MISMATCH"
	| "METRIC_MISMATCH"
	| "UNIT_MISMATCH"
	| "STATISTIC_MISMATCH"
	| "CONFIGURATION_MISMATCH"
	| "INPUT_PROFILE_MISMATCH"
	| "BASELINE_MISMATCH"
	| "WINDOW_MISMATCH"
	| "INSUFFICIENT_RESOLUTION"
	| "NON_FINITE_DELTA";

export type ObservationVerdict = "supported" | "refuted" | "incomparable";
export interface ObservationAssessment {
	readonly outcomeId: string;
	readonly revision: number;
	readonly verdict: ObservationVerdict;
	/** outcome - baseline, only when every comparison condition matched. */
	readonly delta?: number;
	readonly reasons: readonly IncomparableReason[];
}
export type OverallVerdict = ObservationVerdict | "mixed";
export interface AssessedOutcome {
	readonly status: "assessed";
	readonly verdict: OverallVerdict;
	readonly predictionId: string;
	readonly predictionRevision: number;
	readonly observations: readonly ObservationAssessment[];
	/** Older revisions of an outcome that a later revision corrected: not judged. */
	readonly supersededObservations: readonly {
		readonly outcomeId: string;
		readonly revision: number;
	}[];
	readonly counts: {
		readonly supported: number;
		readonly refuted: number;
		readonly incomparable: number;
	};
	/** Incomparable observations and why, kept apart from the verdict. */
	readonly incomparableReasons: readonly {
		readonly reason: IncomparableReason;
		readonly count: number;
	}[];
	/** Supported means consistent with the prediction, not a causal proof. */
	readonly causalProof: false;
	readonly origin: string;
	readonly intervention?: string;
	readonly comparisonConditions: QuantitativePrediction["conditions"];
}
export interface MeasurementGap {
	readonly status: "measurement_gap";
	readonly predictionId: string;
	readonly reasonCode: "NO_MEASUREMENT_PLAN";
}
export type AssessResult = AssessedOutcome | MeasurementGap;

function assessOne(
	prediction: QuantitativePrediction,
	outcome: Outcome,
): ObservationAssessment {
	const reasons: IncomparableReason[] = [];
	const p = prediction.conditions;
	const o = outcome.conditions;
	if (outcome.comparisonId !== prediction.comparisonId)
		reasons.push("COMPARISON_ID_MISMATCH");
	if (outcome.predictionRevision !== prediction.revision)
		reasons.push("PREDICTION_REVISION_MISMATCH");
	if (o.subjectId !== p.subjectId) reasons.push("SUBJECT_MISMATCH");
	if (o.metric !== p.metric) reasons.push("METRIC_MISMATCH");
	if (o.unit !== p.unit) reasons.push("UNIT_MISMATCH");
	if (o.statistic !== p.statistic) reasons.push("STATISTIC_MISMATCH");
	if (o.configuration !== p.configuration)
		reasons.push("CONFIGURATION_MISMATCH");
	if (o.inputProfile !== p.inputProfile) reasons.push("INPUT_PROFILE_MISMATCH");
	if (outcome.baselineRef !== prediction.baselineRef)
		reasons.push("BASELINE_MISMATCH");
	if (
		outcome.window.startMs !== prediction.expectedWindow.startMs ||
		outcome.window.endMs !== prediction.expectedWindow.endMs
	)
		reasons.push("WINDOW_MISMATCH");
	const base = { outcomeId: outcome.outcomeId, revision: outcome.revision };
	if (reasons.length)
		return { ...base, verdict: "incomparable", reasons: reasons.sort() };
	// Exact decimal comparison: no float rounding at the tolerance boundary.
	const exactDelta = subtract(
		toDecimal(outcome.value),
		toDecimal(prediction.baselineValue),
	);
	const tolerance = toDecimal(prediction.measurementTolerance);
	const delta = toNumber(exactDelta);
	// A delta that does not fit a finite number is never reported.
	if (!Number.isFinite(delta))
		return {
			...base,
			verdict: "incomparable",
			reasons: ["NON_FINITE_DELTA"],
		};
	const observed: ExpectedDirection | undefined =
		compare(exactDelta, tolerance) > 0
			? "increases"
			: compare(exactDelta, negate(tolerance)) < 0
				? "decreases"
				: undefined;
	if (observed === undefined)
		return {
			...base,
			verdict: "incomparable",
			delta,
			reasons: ["INSUFFICIENT_RESOLUTION"],
		};
	return {
		...base,
		verdict:
			observed === prediction.expectedDirection ? "supported" : "refuted",
		delta,
		reasons: [],
	};
}

/**
 * Reconciles a quantitative prediction with measured outcomes. Comparison
 * conditions are matched first; only then delta = outcome - baseline is judged
 * against the tolerance fixed in the plan. Qualitative claims yield a
 * measurement gap and never enter the calculation.
 * Input: { contractVersion, scope, prediction, observations }.
 */
export function assessOutcome(input: unknown): Checked<AssessResult> {
	const object = asRecord(input);
	if (!object) return fail("INVALID_INPUT", "input");
	const extra = firstUnknownKey(object, [
		"contractVersion",
		"scope",
		"prediction",
		"observations",
	]);
	if (extra !== undefined) return fail("INVALID_INPUT", extra);
	const version = checkContractVersion(object["contractVersion"]);
	if (!version.ok) return version;
	const scope = checkScope(object["scope"]);
	if (!scope.ok) return scope;
	const prediction = checkPrediction(object["prediction"]);
	if (!prediction.ok) return prediction;
	const raw = object["observations"];
	if (!Array.isArray(raw)) return fail("INVALID_INPUT", "observations");
	if (raw.length > maxOutcomeObservations)
		return fail("LIMIT_EXCEEDED", "observations");
	if (prediction.value.kind === "qualitative") {
		return ok({
			status: "measurement_gap",
			predictionId: prediction.value.predictionId,
			reasonCode: "NO_MEASUREMENT_PLAN",
		});
	}
	const plan = prediction.value;
	const outcomes: Outcome[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < raw.length; i++) {
		const outcome = checkOutcome(raw[i], `observations[${i}]`);
		if (!outcome.ok) return outcome;
		const key = `${outcome.value.outcomeId}\u0000${outcome.value.revision}`;
		if (seen.has(key)) return fail("INVALID_INPUT", `observations[${i}]`);
		seen.add(key);
		outcomes.push(outcome.value);
	}
	outcomes.sort((a, b) =>
		a.outcomeId === b.outcomeId
			? a.revision - b.revision
			: a.outcomeId < b.outcomeId
				? -1
				: 1,
	);
	// Revision is +1 per target: only the latest revision of an outcome is the
	// observation; older revisions are corrected away and never judged.
	const latest = new Map<string, Outcome>();
	for (const outcome of outcomes) latest.set(outcome.outcomeId, outcome);
	const current = outcomes.filter((o) => latest.get(o.outcomeId) === o);
	const superseded = outcomes
		.filter((o) => latest.get(o.outcomeId) !== o)
		.map((o) => ({ outcomeId: o.outcomeId, revision: o.revision }));
	const observations = current.map((outcome) => assessOne(plan, outcome));
	const count = (verdict: ObservationVerdict) =>
		observations.filter((o) => o.verdict === verdict).length;
	const counts = {
		supported: count("supported"),
		refuted: count("refuted"),
		incomparable: count("incomparable"),
	};
	const tally = new Map<IncomparableReason, number>();
	for (const o of observations)
		for (const reason of o.reasons)
			tally.set(reason, (tally.get(reason) ?? 0) + 1);
	const verdict: OverallVerdict =
		counts.supported > 0 && counts.refuted > 0
			? "mixed"
			: counts.supported > 0
				? "supported"
				: counts.refuted > 0
					? "refuted"
					: "incomparable";
	return ok({
		status: "assessed",
		verdict,
		predictionId: plan.predictionId,
		predictionRevision: plan.revision,
		observations,
		supersededObservations: superseded,
		counts,
		incomparableReasons: [...tally.entries()]
			.sort((a, b) => (a[0] < b[0] ? -1 : 1))
			.map(([reason, n]) => ({ reason, count: n })),
		causalProof: false,
		origin: plan.origin,
		...(plan.intervention === undefined
			? {}
			: { intervention: plan.intervention }),
		comparisonConditions: plan.conditions,
	});
}
