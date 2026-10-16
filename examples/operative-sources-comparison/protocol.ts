import {
	answerInstructions,
	answerSchemaFor,
} from "../multi-source-comparison/protocol.ts";
import {
	answerPrompt,
	type AnswerContext,
} from "../multi-source-comparison/world.ts";
export const arms = ["baseline", "operative"] as const;
export type Arm = (typeof arms)[number];
export const supplement = `
The governingSources field is the set of sources with an operative function for THIS decision
at asOf: currently applicable permission rules or currently applicable observation policies.
It is not a bibliography of everything read, mentioned, or used to explain the history.
A rule named as the predecessor of a replacement does not thereby become a governing source.
You may explain that a former rule was replaced without listing the former source here.
Before finalizing this set, check the current function of every listed source. Exclude sources
whose only function is historical, future, superseded, or outside the requested scope.
Do not remove an older rule merely because a newer document exists: preserve coexisting rules
unless an effective, authoritative withdrawal or replacement actually applies.
Evaluate the relevant provisions of mixed documents separately: if their permission rule ended
but their observation policy still governs the supplied observations, retain that source for
the observation policy only, without a permission assessment for the ended rule.
Keep assessments limited to operative permission rules. Preserve the provided calculations.
The explanation can mention additional historical sources; that alone never adds them to
governingSources. Return the same evidence-record fields and put decision last.`;
export const instructions = {
	baseline: answerInstructions,
	operative: answerInstructions + supplement,
};
export const presentation = answerPrompt;
export function schemaFor(context: AnswerContext, _arm: Arm) {
	return answerSchemaFor(
		context.sources.map((s) => s.id),
		context.derivedView?.slice.units.map((u) => u.assertionId) ?? null,
	);
}
export function order(index: number, repeat: number): readonly Arm[] {
	return (index + repeat) % 2 === 0 ? arms : [...arms].reverse();
}
export const design = {
	repeats: 2,
	concurrency: 2,
	plannedExtractions: 4,
	plannedAnswers: 96,
	contrast:
		"Identical v5 context and answer schema; candidate only appends a definition of operative sources versus explanatory historical references. No source filter, semantic classification, output repair or retry in host code.",
	primary:
		"Decision + exact governingSources + permission-assessment set/results + existing grounding audit. First responses, including failures in planned denominator.",
	adoption:
		"Unseen primary paired wins must exceed losses; no decrease in regression primary count or decision count in either cohort; no new false allow; no candidate retired-only source leakage; all four mixed-document controls primary-correct in both repetitions. A tie is no demonstrated benefit. Keep existing v5 regardless.",
	budget:
		"4 fresh extraction + 96 answer calls maximum. 120 seconds per SDK call, 2 workers, no application retries or recovery. Cache first failures and responses; do not resample.",
	limits:
		"Synthetic new documents/questions authored by the implementer, no independent blind evaluation. One extraction per packet shared by arms; two answer repetitions are not independent extraction samples. Frozen expected answers and code before live run.",
};
