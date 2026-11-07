/** Offline code tallies. Never infer semantic causes from source words or gold. */
import type { CaseEvaluation } from "./scoring.ts";

export function diagnoseEvaluations(evaluations: readonly CaseEvaluation[]) {
	const counts: Record<string, number> = {};
	let legacySamples = 0;
	for (const e of evaluations) {
		const codes = new Set<string>();
		if (e.status !== "ok") codes.add(`EXECUTION:${e.status}`);
		else {
			if (e.adoptExpected && e.correctAdopted === 0)
				codes.add("MISSING_EXPECTED_ADOPTION");
			if (e.holdExpected && !e.heldCorrectly) codes.add("INCORRECT_HOLD");
			if (e.classification !== null && !e.classificationCorrect)
				codes.add("CLASSIFICATION");
		}
		if (e.diagnostics) {
			for (const m of e.diagnostics.candidateMismatches)
				for (const code of m.codes) codes.add(`MISMATCH:${code}`);
			for (const code of e.diagnostics.validationCodes)
				codes.add(`VALIDATION:${code}`);
		} else {
			legacySamples++;
			for (const code of e.mismatches) codes.add(`MISMATCH:${code}`);
		}
		for (const code of e.violations) codes.add(`VIOLATION:${code}`);
		for (const code of codes) counts[code] = (counts[code] ?? 0) + 1;
	}
	return {
		version: "extraction-failure-diagnostics/1",
		samples: evaluations.length,
		legacySamples,
		counts: Object.fromEntries(
			Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)),
		),
		limitations: [
			"Counts overlap; a mismatch dimension is not a proven semantic cause.",
			"Legacy samples retain only their first wrong candidate's mismatches.",
			"Caller predicate direction and semantic reference validity require review.",
		],
	};
}
