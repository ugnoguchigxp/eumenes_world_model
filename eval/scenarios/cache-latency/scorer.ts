/**
 * Scorer for the cache-latency scenario. The expected verdicts live in
 * fixture.ts and were fixed before running. This file adds an independent
 * reference computation (plain arithmetic on the raw samples) so that neither
 * the World prediction nor the World assessment is used as ground truth.
 */
import type { IncomparableReason, OverallVerdict } from "../../../src/index.ts";
import type { Expectation, LedgerRecord, MeasurementPlan } from "./fixture.ts";
import type { CacheLatencyReport, HypothesisVerdict } from "./runner.ts";

/** Nearest-rank p95: the ceil(0.95 n)-th smallest sample. */
export function p95NearestRank(samples: readonly number[]): number | undefined {
	if (samples.length === 0) return undefined;
	const sorted = [...samples].sort((a, b) => a - b);
	return sorted[Math.ceil(0.95 * sorted.length) - 1];
}

export interface ReferenceResult {
	readonly verdict: OverallVerdict;
	readonly reasons: readonly IncomparableReason[];
	readonly p95: number | undefined;
}
/**
 * Independent reading of one record against the plan. Lower latency is
 * better by the plan's own `improvement` rule, not by the World prediction.
 */
export function referenceVerdict(
	plan: MeasurementPlan,
	record: LedgerRecord,
): ReferenceResult {
	const run = record.run;
	const reasons: IncomparableReason[] = [];
	if (
		run.model !== plan.model ||
		run.prefix !== plan.prefix ||
		run.warmState !== plan.warmState
	)
		reasons.push("CONFIGURATION_MISMATCH");
	if (run.inputLength !== plan.inputLength)
		reasons.push("INPUT_PROFILE_MISMATCH");
	if (run.metric !== plan.metric) reasons.push("METRIC_MISMATCH");
	if (run.unit !== plan.unit) reasons.push("UNIT_MISMATCH");
	if (run.statistic !== plan.statistic) reasons.push("STATISTIC_MISMATCH");
	if (run.baselineRef !== plan.baselineRef) reasons.push("BASELINE_MISMATCH");
	if (
		run.period.startMs !== plan.period.startMs ||
		run.period.endMs !== plan.period.endMs
	)
		reasons.push("WINDOW_MISMATCH");
	const p95 = p95NearestRank(record.samples);
	if (reasons.length > 0 || p95 === undefined)
		return { verdict: "incomparable", reasons: reasons.sort(), p95 };
	const delta = p95 - plan.baselineValue;
	if (Math.abs(delta) <= plan.tolerance)
		return {
			verdict: "incomparable",
			reasons: ["INSUFFICIENT_RESOLUTION"],
			p95,
		};
	return { verdict: delta < 0 ? "supported" : "refuted", reasons: [], p95 };
}

export interface SeriesScore {
	readonly seriesId: string;
	readonly expected: OverallVerdict;
	readonly actual: HypothesisVerdict;
	readonly expectedReasons: readonly IncomparableReason[];
	readonly actualReasons: readonly IncomparableReason[];
	/** The reference arithmetic agrees with the fixed expectation. */
	readonly referenceAgrees: boolean;
	readonly pass: boolean;
}

/** Scores the World's reported verdict against the fixed expectation. */
export function scoreSeries(
	plan: MeasurementPlan,
	record: LedgerRecord,
	expectation: Expectation,
	report: CacheLatencyReport,
): SeriesScore {
	const reference = referenceVerdict(plan, record);
	const actualReasons = report.hypothesis.incomparableReasons;
	const sameReasons =
		expectation.reasons.length === actualReasons.length &&
		expectation.reasons.every((reason, i) => reason === actualReasons[i]);
	const referenceAgrees =
		reference.verdict === expectation.verdict &&
		reference.p95 === expectation.p95 &&
		reference.reasons.length === expectation.reasons.length &&
		reference.reasons.every((reason, i) => reason === expectation.reasons[i]);
	return {
		seriesId: expectation.seriesId,
		expected: expectation.verdict,
		actual: report.hypothesis.verdict,
		expectedReasons: expectation.reasons,
		actualReasons,
		referenceAgrees,
		pass:
			report.hypothesis.verdict === expectation.verdict &&
			sameReasons &&
			referenceAgrees,
	};
}
