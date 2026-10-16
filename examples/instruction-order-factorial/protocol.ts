import {
	answerInstructions,
	answerSchemaFor,
} from "../multi-source-comparison/protocol.ts";
import { instructions as previous } from "../applicability-order-comparison/protocol.ts";
import {
	answerPrompt,
	type AnswerContext,
} from "../multi-source-comparison/world.ts";
export const arms = ["baseline", "instruction", "order", "combined"] as const;
export type Arm = (typeof arms)[number];
export const factors = {
	baseline: { instruction: false, order: false },
	instruction: { instruction: true, order: false },
	order: { instruction: false, order: true },
	combined: { instruction: true, order: true },
} as const;
export const originalRecord = `Return a compact evidence record, not hidden reasoning: governingSources, assessments of the
operative permission rules, a brief explanation, then the final decision as the LAST field.`;
export const orderedRecord = `Return a compact evidence record, not hidden reasoning: assessments of the
operative permission rules, governingSources, a brief explanation, then the final decision as the LAST field.`;
// Recover the previous intervention verbatim, apart from removing its order-dependent connector.
const start = previous.applicability.indexOf(
	"Select permission rules by their authoritative provisions",
);
const middle = previous.applicability.indexOf(
	"Return a compact evidence record",
	start,
);
const coverageStart = previous.applicability.indexOf(
	"After writing assessments, include EVERY",
	middle,
);
const endText =
	"Check that no assessment source is missing from the completed source set.";
const end =
	previous.applicability.indexOf(endText, coverageStart) + endText.length;
if (
	start < 0 ||
	middle < start ||
	coverageStart < middle ||
	end < coverageStart ||
	!answerInstructions.includes(originalRecord)
)
	throw new Error("previous_intervention_changed");
export const selection = previous.applicability.slice(start, middle).trim();
export const coverage = previous.applicability
	.slice(coverageStart, end)
	.replace("After writing assessments, include EVERY", "Include EVERY");
export function instructionFor(arm: Arm) {
	const f = factors[arm];
	const record = f.order ? orderedRecord : originalRecord;
	return answerInstructions.replace(
		originalRecord,
		f.instruction ? `${selection}\n\n${record}\n${coverage}` : record,
	);
}
export const instructions = Object.fromEntries(
	arms.map((a) => [a, instructionFor(a)]),
) as Record<Arm, string>;
export const presentation = answerPrompt;
export function schemaFor(context: AnswerContext, arm: Arm) {
	const schema = answerSchemaFor(
		context.sources.map((s) => s.id),
		context.derivedView?.slice.units.map((u) => u.assertionId) ?? null,
	);
	if (!factors[arm].order) return schema;
	const { assessments, governingSources, explanation, decision } =
		schema.properties;
	const properties = { assessments, governingSources, explanation, decision };
	return { ...schema, properties, required: Object.keys(properties) };
}
// Four balanced Williams sequences: each arm occupies each position once and
// each ordered adjacent pair occurs once. Both cohorts are multiples of four.
const sequences: readonly (readonly Arm[])[] = [
	["baseline", "instruction", "combined", "order"],
	["instruction", "order", "baseline", "combined"],
	["order", "combined", "instruction", "baseline"],
	["combined", "baseline", "order", "instruction"],
];
export function order(index: number, repeat: number) {
	return sequences[(index + repeat * 2) % 4]!;
}
export const design = {
	repeats: 2,
	concurrency: 2,
	plannedExtractions: 4,
	plannedAnswers: 192,
	contrast:
		"2x2 factorial: exact v5; semantic instructions only; answer order only (text and schema order together); both. Semantic coverage is order-neutral. No new semantic rules beyond the previous bundle. Combined is normalized, not byte-identical to the prior candidate.",
	primary:
		"Exact decision, governing source set, permission assessment set/results and unchanged grounding audit. All first failures remain in planned denominators.",
	retention:
		"All calls complete; candidate all eight regression questions correct in both repeats; primary and decision counts nondecreasing versus v5 in each cohort; no false allow or retired-only source leak; unseen paired wins exceed losses overall AND in at least two new packets. No default promotion. Preserve previous experiment regardless.",
	attribution:
		"Report all four conditional contrasts, marginal primary-rate differences and difference-in-differences interaction separately by cohort. A factor has descriptive support only if neither conditional unseen contrast is negative, at least one positive, pooled conditional net is positive in at least two new packets, and its two treated arms do not lower decision counts or introduce false allow/retired leaks. Otherwise report mixed, ceiling or insufficient evidence, not a causal winner. Correlated repeats and authored fixtures preclude statistical generalization.",
	budget:
		"4 shared extractions plus 192 first answers; 120 seconds each, two workers. No application retries, repairs, fallback or resampling. Freeze before execution.",
	completion:
		"Partial and SQLite checks, verify/build, one live round, raw/explanation inspection, zero-call cache replay, reproducibility tests, saved decision and limitations, final verify/build, scope review, commit/push.",
};
