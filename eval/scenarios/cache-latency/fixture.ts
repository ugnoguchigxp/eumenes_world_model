/**
 * Fixed inputs of the cache-latency scenario (P5-03). Everything here is a
 * hand-written fixture: no Tool is run, no host ledger is read, no model is
 * called. The observation series and their expected verdicts were written
 * down before any code ran; the World prediction is never the ground truth.
 */
import { createHash } from "node:crypto";
import type {
	GoalReference,
	IncomparableReason,
	OverallVerdict,
	SourceRef,
} from "../../../src/index.ts";

export const SCOPE = { principal: "p-eval", scopeKey: "scope-voice" };
export const NOW_MS = 1791500000000;
export const PERIOD = { startMs: NOW_MS, endMs: NOW_MS + 3_600_000 };
export const AS_OF_MS = PERIOD.endMs;

/** Explicit Goal reference (adopted by the user; World does not create it). */
export const GOAL: GoalReference = {
	goalId: "goal-reduce-voice-latency",
	revision: 1,
	status: "adopted",
};
export const GOAL_TEXT = "reduce voice response latency";

/**
 * The measurement plan fixes everything a later series is compared against.
 * Any difference in a field below makes a series incomparable.
 */
export interface MeasurementPlan {
	readonly planId: string;
	readonly goalId: string;
	readonly model: string;
	readonly prefix: string;
	readonly inputLength: string;
	readonly warmState: "warm" | "cold";
	readonly metric: string;
	readonly unit: string;
	readonly statistic: string;
	readonly period: { readonly startMs: number; readonly endMs: number };
	readonly baselineRef: string;
	readonly baselineValue: number;
	/** Resolution fixed with the plan; a smaller delta is not a result. */
	readonly tolerance: number;
	readonly minSamples: number;
	/** The evaluator's own reading of "better"; not taken from the World. */
	readonly improvement: "lower_is_better";
}
export const PLAN: MeasurementPlan = {
	planId: "plan-cache-latency",
	goalId: GOAL.goalId,
	model: "voice-llm-fixed-v1",
	prefix: "pfx-v3-1200tok",
	inputLength: "input-256tok",
	warmState: "warm",
	metric: "voice_response_latency",
	unit: "ms",
	statistic: "p95",
	period: PERIOD,
	baselineRef: "baseline-cache-off-1",
	baselineValue: 820,
	tolerance: 30,
	minSamples: 20,
	improvement: "lower_is_better",
};
export const SUBJECT_ID = "voice-response";
export const INTERVENTION = "enable-prefix-cache";

/** What the Tool ledger would have recorded for one measurement run. */
export interface RunSettings {
	readonly model: string;
	readonly prefix: string;
	readonly inputLength: string;
	readonly warmState: "warm" | "cold";
	readonly metric: string;
	readonly unit: string;
	readonly statistic: string;
	readonly baselineRef: string;
	readonly period: { readonly startMs: number; readonly endMs: number };
}
export interface LedgerRecord {
	readonly kind: "tool_ledger";
	readonly ledgerEntryId: string;
	readonly ledgerRevision: number;
	readonly toolRunId: string;
	readonly runStatus: "succeeded" | "failed";
	/** Only a verified ledger entry may become a runtime observation. */
	readonly verification: "verified" | "unverified";
	readonly sourceRef: SourceRef;
	readonly run: RunSettings;
	readonly samples: readonly number[];
}
/** Free text from a model ("measurement done, latency improved"). */
export interface LlmClaim {
	readonly kind: "llm_text";
	readonly claimId: string;
	readonly text: string;
}
export type IngestRecord = LedgerRecord | LlmClaim;

export const PLANNED_RUN: RunSettings = {
	model: PLAN.model,
	prefix: PLAN.prefix,
	inputLength: PLAN.inputLength,
	warmState: PLAN.warmState,
	metric: PLAN.metric,
	unit: PLAN.unit,
	statistic: PLAN.statistic,
	baselineRef: PLAN.baselineRef,
	period: PLAN.period,
};

const digestOf = (samples: readonly number[]) =>
	createHash("sha256").update(JSON.stringify(samples)).digest("hex");
export function ledgerRecord(
	id: string,
	samples: readonly number[],
	extra: {
		readonly run?: Partial<RunSettings>;
		readonly ledgerRevision?: number;
		readonly sourceRevision?: string;
		readonly runStatus?: LedgerRecord["runStatus"];
		readonly verification?: LedgerRecord["verification"];
	} = {},
): LedgerRecord {
	const ledgerRevision = extra.ledgerRevision ?? 1;
	return {
		kind: "tool_ledger",
		ledgerEntryId: id,
		ledgerRevision,
		toolRunId: `run-${id}`,
		runStatus: extra.runStatus ?? "succeeded",
		verification: extra.verification ?? "verified",
		sourceRef: {
			namespace: "fixture-tool-ledger",
			kind: "latency-run",
			id: `src-${id}`,
			revision: extra.sourceRevision ?? `src-rev-${ledgerRevision}`,
			digest: digestOf(samples),
		},
		run: { ...PLANNED_RUN, ...extra.run },
		samples,
	};
}

/**
 * Raw samples in ms, 20 each. p95 is the nearest rank: the 19th smallest.
 * A -> 640, B -> 905, C -> 410 (written down by hand, not computed).
 */
export const SAMPLES_IMPROVED = [
	596, 601, 606, 610, 614, 617, 620, 622, 624, 626, 628, 630, 631, 633, 635,
	636, 638, 639, 640, 702,
] as const;
export const SAMPLES_WORSE = [
	840, 852, 861, 866, 872, 878, 883, 887, 890, 893, 896, 898, 900, 901, 902,
	903, 904, 904, 905, 960,
] as const;
export const SAMPLES_SHORT_INPUT = [
	355, 362, 368, 372, 376, 380, 384, 388, 391, 394, 396, 399, 401, 403, 405,
	407, 408, 409, 410, 448,
] as const;

export interface ObservationSeries {
	readonly seriesId: string;
	readonly label: string;
	readonly record: LedgerRecord;
}
export const SERIES: readonly ObservationSeries[] = [
	{
		seriesId: "series-a-improved",
		label: "same config, cache on, faster",
		record: ledgerRecord("led-a", SAMPLES_IMPROVED),
	},
	{
		seriesId: "series-b-worse",
		label: "same config, cache on, slower",
		record: ledgerRecord("led-b", SAMPLES_WORSE),
	},
	{
		seriesId: "series-c-other-input",
		label: "much shorter input: looks fast but is not comparable",
		record: ledgerRecord("led-c", SAMPLES_SHORT_INPUT, {
			run: { inputLength: "input-64tok" },
		}),
	},
];

/**
 * Expected verdicts, fixed before running. Baseline 820 ms, tolerance 30 ms,
 * lower is better: A is 180 ms lower, B is 85 ms higher, C has another input.
 */
export interface Expectation {
	readonly seriesId: string;
	readonly verdict: OverallVerdict;
	readonly reasons: readonly IncomparableReason[];
	readonly p95: number;
}
export const EXPECTED: readonly Expectation[] = [
	{
		seriesId: "series-a-improved",
		verdict: "supported",
		reasons: [],
		p95: 640,
	},
	{ seriesId: "series-b-worse", verdict: "refuted", reasons: [], p95: 905 },
	{
		seriesId: "series-c-other-input",
		verdict: "incomparable",
		reasons: ["INPUT_PROFILE_MISMATCH"],
		p95: 410,
	},
];

export const LLM_COMPLETED_CLAIM: LlmClaim = {
	kind: "llm_text",
	claimId: "claim-1",
	text: "measurement completed; voice latency improved by 25%",
};

/** Reasoning snapshot: candidate, its conditions and its dependencies. */
const unconditional = (evidenceId: string) => ({
	kind: "explicitly_unconditional",
	adoptionEvidenceId: evidenceId,
});
export const PREFIX_CONDITION = {
	kind: "expression",
	expression: {
		kind: "compare",
		key: "prefix_tokens",
		op: "gte",
		value: { kind: "number", value: 1024, unit: "tokens" },
	},
};
export const EDGES = [
	{
		id: "edge-effect",
		revision: 1,
		from: "cache-candidate",
		to: "voice-response-latency",
		relation: "decreases",
		status: "candidate",
		causalEligible: false,
		condition: PREFIX_CONDITION,
		axis: { metric: PLAN.metric, comparison: PLAN.statistic },
	},
	{
		id: "edge-serves-goal",
		revision: 1,
		from: "cache-candidate",
		to: GOAL.goalId,
		relation: "serves_goal",
		status: "active",
		causalEligible: false,
		condition: unconditional("ev-goal-link"),
	},
	{
		id: "edge-dep-capability",
		revision: 1,
		from: "cache-candidate",
		to: "prefix-cache-capability",
		relation: "depends_on",
		status: "active",
		causalEligible: true,
		condition: unconditional("ev-dep-capability"),
	},
	{
		id: "edge-dep-prefix",
		revision: 1,
		from: "cache-candidate",
		to: "stable-prefix",
		relation: "depends_on",
		status: "active",
		causalEligible: true,
		condition: PREFIX_CONDITION,
	},
	{
		id: "edge-dep-tool",
		revision: 1,
		from: "cache-candidate",
		to: "latency-measurement-tool",
		relation: "depends_on",
		status: "active",
		causalEligible: true,
		condition: unconditional("ev-dep-tool"),
	},
] as const;
export const CONDITION_OBSERVATIONS = [
	{
		observationId: "obs-prefix-tokens",
		key: "prefix_tokens",
		value: { kind: "number", value: 1200, unit: "tokens" },
		observedAt: NOW_MS - 1_000,
		version: "obs-v1",
		priority: 1,
	},
] as const;
