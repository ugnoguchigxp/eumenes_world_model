/** Frozen acceptance requirements. Auditing their feasibility never changes them. */
export const comparisonGate = Object.freeze({
	cases: 40,
	evaluationCases: 30,
	minImprovements: 5,
	maxWorsened: 0,
});

/** Conditional on THIS fixed comparator, with a hypothetical perfect World. */
export function comparisonFeasibility(
	cases: number,
	evaluationCases: number,
	comparatorEvaluationPassed: number,
) {
	if (
		![cases, evaluationCases, comparatorEvaluationPassed].every(
			(n) => Number.isSafeInteger(n) && n >= 0,
		) ||
		evaluationCases > cases ||
		comparatorEvaluationPassed > evaluationCases
	)
		throw new Error("INVALID_COMPARISON_COUNTS");
	const maxImprovements = evaluationCases - comparatorEvaluationPassed;
	return {
		status:
			cases !== comparisonGate.cases ||
			evaluationCases !== comparisonGate.evaluationCases
				? ("incomplete" as const)
				: maxImprovements < comparisonGate.minImprovements
					? ("unreachable" as const)
					: ("possible" as const),
		maxImprovements,
		requiredImprovements: comparisonGate.minImprovements,
		assumption:
			"fixed comparator; hypothetical perfect World; not model quality",
	};
}
