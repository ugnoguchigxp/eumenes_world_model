import { instructions as prior } from "../audit-repair-comparison/protocol.ts";
export {
	presentation,
	schemaFor,
} from "../audit-repair-comparison/protocol.ts";
export const arms = ["baseline", "control", "selection"] as const;
export type Arm = (typeof arms)[number];
export const selectionSupplement = `
Review source applicability even when the structural audit passes: it only checks consistency
with the selected rules, so a consistently wrong selection can pass. Re-establish the applicable
permission-rule set from ALL original documents for the requested subject, scope and asOf,
without treating the previous selection, explanation, calculated outcome, lifecycle label or
publication order as evidence of applicability. A computed violation of a future or out-of-scope
rule does not make that rule applicable. Follow explicit authority, effective intervals and the
scope of replacements; retain concurrent rules unless evidence actually supersedes them.
Separately establish which measurement-policy documents still apply, including retained chapters.
Compare those source sets with BOTH governingSources and assessments; correct wrong inclusions
and omissions, then use the provided calculations for the selected permission rules and align
the explanation and decision. Do not alter a correct selection merely to make a change.
Return only the existing compact answer schema; no additional reasoning transcript or fields.`;
export const instructions = {
	initial: prior.initial,
	control: prior.revision,
	selection: prior.revision + selectionSupplement,
};
export function order(
	index: number,
	repeat: number,
): readonly ("control" | "selection")[] {
	return (index + repeat) % 2 === 0
		? ["control", "selection"]
		: ["selection", "control"];
}
export const design = {
	repeats: 2,
	concurrency: 2,
	plannedExtractions: 4,
	plannedInitials: 32,
	plannedEndpoints: 108,
	maxCalls: 108,
	comparison:
		"Shared unchanged v5 first response on 16 unseen questions x2. Two frozen historical seeds x2 (one known missed wrong selection and one correct control, not fresh v5 generations). Baseline keeps the first answer. Control and selection ALWAYS review once, regardless of structural-audit pass. Same evidence, prior answer, audit report, schema/order, budget; selection alone adds applicability-focused developer instructions.",
	retention:
		"All planned endpoints complete; candidate repairs the missed seed in both repeats and preserves primary/decision correctness of the correct seed and every correct baseline, no introduced false allow or retired-source leak; unseen paired wins exceed losses in at least two new packets. Keep experimental only, never replace v5. Known-only gains do not establish unseen efficacy.",
	attribution:
		"Prefer focused selection review over equal-call-budget control only if unseen wins exceed losses without primary/decision regression against control. A tie cannot establish instruction-specific advantage.",
	budget:
		"4 extraction +32 initial +72 reviews =108 calls; two workers,120 seconds per call. All reviews use fresh isolated model conversations. No second review, extraction/transport retries, source filtering or oracle-based trigger.",
	failure:
		"Post-review structural audit remains unchanged; accepted means only structural pass. Keep raw failed-audit output for scoring, no fallback to initial on failure. Missing endpoints stay in planned denominators. A coherent semantic error can still pass.",
	completion:
		"Partial contracts, SQLite integration, verify/build; frozen live comparison; extraction/answer/cost inspection; zero-new-call replay; measured tests and adoption/limits; final verify/build, scope review, commit/push.",
};
