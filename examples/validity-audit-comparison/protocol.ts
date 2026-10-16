import { instructions as prior } from "../audit-repair-comparison/protocol.ts";
export {
	presentation,
	schemaFor,
} from "../audit-repair-comparison/protocol.ts";
export const arms = ["baseline", "control", "validity"] as const;
export type Arm = (typeof arms)[number];
export const instructions = {
	initial: prior.initial,
	revision: `${prior.revision}
An optional validityAudit reports selected permission assessments whose EXISTING World calculation
contains CLAIM_NOT_VALID. That reason means the represented claim is outside its valid time at
asOf, not that observations violate an operative permission rule. Recheck its applicability against
the original document and exact supplied asOf; select the operative permission rule yourself and
return the complete answer. The audit neither selects an alternative nor validates the extraction.
Do not treat an invalid claim's violated result as a prohibition on the requested action.`,
};
export function order(
	index: number,
	repeat: number,
): readonly ("control" | "validity")[] {
	return (index + repeat) % 2 === 0
		? ["control", "validity"]
		: ["validity", "control"];
}
export const design = {
	repeats: 2,
	concurrency: 2,
	plannedExtractions: 3,
	plannedInitials: 24,
	plannedEndpoints: 108,
	maxCalls: 99,
	comparison:
		"Six frozen historical seeds x2 and twelve fresh questions x2. Shared exact v5 first answers. Baseline keeps first answer with old audit. Both review arms trigger on the SAME combined structural+validity audit failure; control receives only old audit, validity additionally receives existing CLAIM_NOT_VALID findings. Same revision instructions/schema/inputs/order and one-call ceiling. Passing seeds unchanged. Primary scoring unchanged.",
	detection:
		"Audit only selected permission assessments bound to existing units/evaluations; never interpret prose, parse dates, classify sources, or filter governingSources. Missing bindings and parse errors remain old-audit failures. Absent CLAIM_NOT_VALID is not proof of applicability. Final acceptance is old audit for baseline/control and combined audit for validity; report detection, answer correctness, acceptance separately.",
	retention:
		"Guard is an opt-in experimental check only: all endpoints complete, catch all four known temporal seeds, no rejection of primary-correct answers, and catch at least one newly generated unseen old-audit miss with CLAIM_NOT_VALID. Repair promotion additionally requires all known temporal seeds repaired in both repeats, preserving initial primary/decision correctness, no new false allow or retired leak, unseen net wins and wins in at least two new packets. v5 remains default regardless.",
	attribution:
		"Prefer validity feedback only with unseen paired wins over control, no control primary/decision regression, and repair retention conditions. A tie cannot attribute gains to feedback. A rejection is detection, not a correct answer.",
	budget:
		"3 extraction+24 fresh v5 initial+at most72 revisions=99 calls. Two workers,120s each. No extraction/transport retries, second review, fallback or oracle trigger. Frozen code/data throughout run.",
	completion:
		"Partial contract and boundary tests, SQLite integration, verify/build; frozen live comparison; inspect extractions/answers/prose/costs; zero-new-call replay; measured tests and adoption/limits; final verify/build, scope review, commit/push.",
};
