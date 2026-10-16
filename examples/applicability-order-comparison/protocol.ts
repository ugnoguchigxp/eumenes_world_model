import {
	answerInstructions,
	answerSchemaFor,
} from "../multi-source-comparison/protocol.ts";
import { instructions as previous } from "../operative-sources-comparison/protocol.ts";
import {
	answerPrompt,
	type AnswerContext,
} from "../multi-source-comparison/world.ts";
export const arms = ["baseline", "operative", "applicability"] as const;
export type Arm = (typeof arms)[number];
const originalRecord = `Return a compact evidence record, not hidden reasoning: governingSources, assessments of the
operative permission rules, a brief explanation, then the final decision as the LAST field.`;
const revisedRecord = `Select permission rules by their authoritative provisions, requested scope and effect at asOf
before using their calculation results. Compare effect times with asOf, not publication times.
CLAIM_NOT_VALID means the claim is outside its validTime; its violated result does not say that
an inapplicable permission rule prohibits the action. Read that reason and the original dates.
Retain the predecessor until an authoritative replacement actually takes effect, and retain
independent coexisting provisions. A calculation's presence alone does not establish applicability.

Return a compact evidence record, not hidden reasoning, in this order: assessments of the
operative permission rules, governingSources, a brief explanation, decision LAST.
After writing assessments, include EVERY assessment sourceId in governingSources, including
rules evaluated as violated or unknown. Add the sources of currently applicable observation
policies. These are two contributions to the same set; an observation policy never displaces
a permission source. A mixed document may remain for its observation policy after its permission
provision ends. Do not assess the ended provision or add historical references merely mentioned
in the explanation. Check that no assessment source is missing from the completed source set.`;
if (!answerInstructions.includes(originalRecord))
	throw new Error("baseline_record_changed");
export const instructions = {
	baseline: answerInstructions,
	operative: previous.operative,
	applicability: answerInstructions.replace(originalRecord, revisedRecord),
};
export const presentation = answerPrompt;
export function schemaFor(context: AnswerContext, arm: Arm) {
	const schema = answerSchemaFor(
		context.sources.map((s) => s.id),
		context.derivedView?.slice.units.map((u) => u.assertionId) ?? null,
	);
	if (arm !== "applicability") return schema;
	const { assessments, governingSources, explanation, decision } =
		schema.properties;
	const properties = { assessments, governingSources, explanation, decision };
	return { ...schema, properties, required: Object.keys(properties) };
}
const permutations: readonly (readonly Arm[])[] = [
	["baseline", "operative", "applicability"],
	["baseline", "applicability", "operative"],
	["operative", "baseline", "applicability"],
	["operative", "applicability", "baseline"],
	["applicability", "baseline", "operative"],
	["applicability", "operative", "baseline"],
];
export function order(index: number, repeat: number) {
	return permutations[(index + repeat * 3) % permutations.length]!;
}
export const design = {
	repeats: 2,
	concurrency: 2,
	plannedExtractions: 4,
	plannedAnswers: 144,
	contrast:
		"Unchanged v5, unchanged prior operative supplement, and a v5-derived applicability-first instruction with assessments serialized before governingSources. Same questions, original evidence, calculations and schema fields/constraints. Candidate is an instruction/order bundle; effects are not separated.",
	primary:
		"Decision + exact governingSources + exact permission-assessment set/results + unchanged grounding audit; all first failures remain in planned denominators.",
	retention:
		"Retain as an improvement candidate only if all calls complete, PC01 and CV04 and every new applicability/mixed-policy control are primary-correct in both repetitions, candidate primary and decision counts do not decrease against either comparator in either cohort, no candidate false allow or retired-only source leak, and candidate paired primary wins exceed losses against at least one comparator in the current run. Historical failures alone do not establish a current improvement.",
	preferred:
		"Additionally require unseen paired primary wins to exceed losses versus v5. A ceiling tie supports no demonstrated unseen superiority. Retention is not default promotion; v5 is preserved regardless.",
	budget:
		"4 extraction + 144 answer calls maximum; 120 seconds per call, 2 workers, six balanced arm permutations. No application retries, repairs, fallbacks or resampling. Frozen first responses and failures.",
	limits:
		"Synthetic implementer-authored sources/questions and review, not independent blind or real-work acceptance. One extraction per packet shared across arms, two answer repetitions are correlated. No prompt or oracle changes after measurement starts.",
};
