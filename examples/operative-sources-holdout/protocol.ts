export {
	arms,
	instructions,
	supplement,
	presentation,
	schemaFor,
	order,
} from "../operative-sources-comparison/protocol.ts";
export const design = {
	repeats: 2,
	concurrency: 2,
	plannedExtractions: 6,
	plannedAnswers: 128,
	contrast:
		"Unchanged v5 versus the exact previously frozen operative-source supplement. Shared original evidence, native calculations and answer schema; only developer instructions differ.",
	primary:
		"Decision + exact governingSources + exact permission-assessment set/results + existing grounding audit; failures retained in planned denominator.",
	adoption:
		"All calls complete; unseen primary paired wins exceed losses, with positive net wins in at least two new packets; regression primary count and decision count in each cohort do not decrease; no new false allow; zero candidate retired-only source leakage; all preservationControls primary-correct in both repetitions. Tie is no demonstrated benefit. Existing v5 retained regardless.",
	budget:
		"6 fresh extraction + 128 answer calls maximum; 120 seconds each; 2 workers; no application retries or extraction fallback. Preserve first successes and failures.",
	limits:
		"Synthetic implementer-authored new sources/questions; no independent blind evaluation. One extraction shared per packet, two answer repetitions. Five packets also have ordinary/history question variants with identical observations; those are correlated, not independent samples. Generalization here means new synthetic packets, not real-world acceptance.",
};
