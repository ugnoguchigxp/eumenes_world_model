import { asRecord, type Tri } from "../../src/index.ts";
import { parseAnswer, type Answer } from "./results.ts";
import type { AnswerContext } from "./world.ts";

export interface Assessment {
	sourceId: string;
	result: Tri;
	assertionId: string | null;
	overrideReason: string | null;
}
export interface GroundedAnswer extends Answer {
	assessments: Assessment[];
}
export function parseGroundedAnswer(raw: string): GroundedAnswer {
	const answer = parseAnswer(raw);
	const value = asRecord(JSON.parse(raw));
	if (!Array.isArray(value?.["assessments"]))
		throw new Error("missing_assessments");
	const assessments = value["assessments"].map((entry): Assessment => {
		const item = asRecord(entry);
		if (
			!item ||
			typeof item["sourceId"] !== "string" ||
			!["satisfied", "violated", "unknown"].includes(String(item["result"])) ||
			!(
				item["assertionId"] === null || typeof item["assertionId"] === "string"
			) ||
			!(
				item["overrideReason"] === null ||
				typeof item["overrideReason"] === "string"
			)
		)
			throw new Error("invalid_assessment");
		return {
			sourceId: item["sourceId"],
			result: item["result"] as Tri,
			assertionId: item["assertionId"] as string | null,
			overrideReason: item["overrideReason"] as string | null,
		};
	});
	return { ...answer, assessments };
}

/**
 * Audit observable output contracts only. Never chooses applicable sources,
 * changes a decision, retries the model, or consults the fixture oracle.
 * Passing this check does NOT validate source selection or explanation prose.
 */
export function auditGrounding(answer: GroundedAnswer, context: AnswerContext) {
	const issues: string[] = [];
	const overrides: string[] = [];
	let comparedCalculations = 0;
	let calculationMismatches = 0;
	const seen = new Set<string>();
	for (const assessment of answer.assessments) {
		const { sourceId, assertionId } = assessment;
		if (seen.has(sourceId)) issues.push(`duplicate_assessment:${sourceId}`);
		seen.add(sourceId);
		if (
			!context.sources.some((source) => source.id === sourceId) ||
			!answer.governingSources.includes(sourceId)
		)
			issues.push(`uncited_assessment:${sourceId}`);
		const reason = assessment.overrideReason?.trim();
		if (reason) overrides.push(sourceId);
		if (context.derivedView) {
			const view = context.derivedView;
			const unit = view?.slice.units.find(
				(unit) =>
					unit.assertionId === assertionId &&
					unit.sources.some((source) => source.id === sourceId),
			);
			const evaluation = view?.evaluations.find(
				(e) => e.assertionId === unit?.assertionId,
			);
			if (!unit || !evaluation) {
				issues.push(`missing_calculation:${sourceId}`);
				continue;
			}
			comparedCalculations++;
			if (assessment.result !== evaluation.result) {
				calculationMismatches++;
				issues.push(`calculation_result_mismatch:${sourceId}`);
			}
		} else {
			if (assertionId !== null)
				issues.push(`source_only_has_assertion_id:${sourceId}`);
			if (!context.derivedView && reason)
				issues.push(`override_without_world:${sourceId}`);
		}
	}
	if (!answer.assessments.length) issues.push("missing_permission_assessment");
	// This is the model's declared output contract, not an engine decision.
	// The LLM, not this auditor, selected and interpreted the permission rules.
	const results = answer.assessments.map((a) => a.result);
	const declaredDecision =
		results.length && results.every((result) => result === "satisfied")
			? "allow"
			: results.length && results.every((result) => result === "violated")
				? "deny"
				: "hold";
	const decisionConsistent = answer.decision === declaredDecision;
	if (!decisionConsistent) issues.push("decision_assessment_mismatch");
	return {
		comparedCalculations,
		calculationMismatches,
		decisionConsistent,
		overrides,
		issues,
		passed: issues.length === 0 && overrides.length === 0,
	};
}
export type GroundingAudit = ReturnType<typeof auditGrounding>;
