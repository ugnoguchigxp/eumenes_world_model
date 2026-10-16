import { parseGroundedAnswer } from "../multi-source-comparison/grounding.ts";
import type { AnswerContext } from "../multi-source-comparison/world.ts";
import { inspect } from "../audit-repair-comparison/review.ts";

/** Check the model's declared permission assessments against existing calculations.
 * No date parsing, source selection, prose classification or oracle access.
 * governingSources can legitimately retain a measurement chapter of a replaced document.
 */
export function auditValidity(raw: string, context: AnswerContext) {
	const structural = inspect(raw, context);
	const invalidClaims: {
		sourceId: string;
		assertionId: string;
		reason: "CLAIM_NOT_VALID";
	}[] = [];
	let checkedClaims = 0;
	if (!structural.parseError && context.derivedView) {
		for (const a of parseGroundedAnswer(raw).assessments) {
			const unit = context.derivedView.slice.units.find(
				(u) =>
					u.assertionId === a.assertionId &&
					u.sources.some((s) => s.id === a.sourceId),
			);
			const evaluation = context.derivedView.evaluations.find(
				(e) => e.assertionId === unit?.assertionId,
			);
			if (!unit || !evaluation) continue; // The existing structural audit rejects missing/mismatched bindings.
			checkedClaims++;
			if (evaluation.reasons.includes("CLAIM_NOT_VALID"))
				invalidClaims.push({
					sourceId: a.sourceId,
					assertionId: unit.assertionId,
					reason: "CLAIM_NOT_VALID",
				});
		}
	}
	return {
		passed: structural.passed && invalidClaims.length === 0,
		structural,
		checkedClaims,
		invalidClaims,
	};
}
