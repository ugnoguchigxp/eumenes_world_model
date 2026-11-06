/** Structural audit only. No gold rewriting, semantic repair or model calls. */
import { extractionLimits } from "../../src/index.ts";
import type { Profile } from "./protocol.ts";
import type { QualityCase } from "./dataset.ts";

/** Retained legacy wire capacity; never apply the new capacity to old runs. */
export const singleQuoteRepresentation = Object.freeze({
	contract: "single-quote-candidate/v1",
	maxSupportingSourcesPerDraft: 1,
	inputManifestIsSupportingEvidence: false,
});

export const extractionRepresentation = Object.freeze({
	contract: "multi-quote-candidate/v2",
	maxSupportingSourcesPerDraft: extractionLimits.maxQuotesPerCandidate,
	inputManifestIsSupportingEvidence: false,
});
type Representation = {
	readonly contract: string;
	readonly maxSupportingSourcesPerDraft: number;
	readonly inputManifestIsSupportingEvidence: false;
};
export function auditRepresentation(
	cases: readonly QualityCase[],
	representation: Representation = extractionRepresentation,
) {
	const issues = cases.flatMap((c) =>
		c.expected.flatMap((fact, factIndex) => {
			const requiredSources = [...new Set(fact.sourceIds)];
			return fact.modality === "asserted" &&
				requiredSources.length > representation.maxSupportingSourcesPerDraft
				? [
						{
							caseId: c.id,
							factIndex,
							code: "SUPPORTING_SOURCE_CAPACITY_EXCEEDED" as const,
							requiredSources,
							capacity: representation.maxSupportingSourcesPerDraft,
						},
					]
				: [];
		}),
	);
	return {
		status: issues.length
			? ("incompatible" as const)
			: ("no_capacity_conflict" as const),
		cases: cases.length,
		contract: representation,
		issues,
		limitations: [
			"No finding does not establish semantic correctness or 95% feasibility.",
			"A conflicting reference is not automatically a wrong reference.",
			"Predicate equivalence and missing operator knowledge require explicit caller contracts.",
		],
	};
}

export function requireRepresentable(
	cases: readonly QualityCase[],
	representation: Representation = extractionRepresentation,
) {
	const audit = auditRepresentation(cases, representation);
	if (audit.status === "incompatible")
		throw new Error(
			"EVALUATION_REPRESENTATION_CONFLICT: run offline contract audit",
		);
	return audit;
}

/** Baseline keeps its original wire; never attribute a new capacity to old runs. */
export function auditProfiles(
	cases: readonly QualityCase[],
	profiles: readonly Profile[],
) {
	const results = profiles.map((profile) => ({
		profile,
		audit: auditRepresentation(
			cases,
			profile === "baseline"
				? singleQuoteRepresentation
				: extractionRepresentation,
		),
	}));
	return {
		status: results.some((r) => r.audit.status === "incompatible")
			? "incompatible"
			: "no_capacity_conflict",
		profiles: results,
	};
}
export function requireProfilesRepresentable(
	cases: readonly QualityCase[],
	profiles: readonly Profile[],
) {
	for (const profile of profiles)
		requireRepresentable(
			cases,
			profile === "baseline"
				? singleQuoteRepresentation
				: extractionRepresentation,
		);
}
