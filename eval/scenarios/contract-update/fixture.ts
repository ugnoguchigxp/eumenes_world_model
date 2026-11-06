/** Semantic proposals and host authority are fixtures, never model results. */
import { createHash } from "node:crypto";
import type {
	Assertion,
	ConditionSpec,
	SourceRef,
	QuantitativePrediction,
} from "../../../src/index.ts";
import type { HostChecks } from "../../../src/sqlite.ts";
import type { auditRepresentation } from "../../api-quality/contract-audit.ts";
import { singleQuoteRepresentation } from "../../api-quality/contract-audit.ts";

export const SCOPE = {
	principal: "contract-reviewer",
	scopeKey: "offline-audit",
};
export const NOW = 1793836800000;
export const GOAL = {
	goalId: "review-evaluation-before-spending",
	revision: 1,
	status: "adopted",
} as const;
export const hasher = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
export const access = {
	principal: SCOPE.principal,
	scopeKeys: [SCOPE.scopeKey],
	purpose: "world",
	policyRevision: "fixture-policy-1",
};
export const CLEAR_CONTRACT: ConditionSpec = {
	kind: "expression",
	expression: {
		kind: "compare",
		key: "representation_conflicts",
		op: "eq",
		value: { kind: "number", value: 0, unit: "facts" },
	},
};

export function cycleFixture(
	audit: ReturnType<typeof auditRepresentation>,
	outcomeRevision = 1,
) {
	const documents = {
		operator:
			"FIXTURE operator: review evaluation before paid runs; paid evaluation requires zero unresolved representation conflicts and a reviewed contract. This is host authority, not a source instruction granting tools.",
		before:
			"FIXTURE model proposal: run the offline contract audit next. Hypothesis: it will expose a representation conflict. This is not an adopted fact or a paid-run permission.",
		after:
			"FIXTURE model proposal after reviewing the audit: repair the output/evidence contract before another paid acceptance run. Preserve the old failed scores. This is a proposal requiring explicit host adoption.",
		audit: JSON.stringify({
			evaluator: "evaluation-contract-audit/1",
			audit,
			observationId: "audit-observation",
			predictionId: "audit-prediction",
			predictionRevision: 1,
		}),
	};
	const sources = Object.fromEntries(
		Object.entries(documents).map(([id, text]) => [
			id,
			{
				namespace: "offline-evaluation",
				kind: "record",
				id,
				revision: id === "audit" ? String(outcomeRevision) : "1",
				digest: hasher(new TextEncoder().encode(text)),
			},
		]),
	) as Record<keyof typeof documents, SourceRef>;
	const hostChecks: HostChecks = {
		sourceSnapshot: {
			states: Object.values(sources).map((s) => ({
				...s,
				...SCOPE,
				status: "available",
			})),
		},
		forgetEpoch: "fixture-forget-1",
		restoreEpoch: "fixture-restore-1",
		policyRevision: access.policyRevision,
	};
	function assertion(
		id: string,
		subjectId: string,
		predicate: string,
		payload: Assertion["payload"],
		source: keyof typeof documents,
		origin: Assertion["origin"] = "model_hypothesis",
		condition?: ConditionSpec,
	): Assertion {
		const evidenceId = `evidence-${id}`;
		return {
			id,
			revision: 1,
			scope: SCOPE,
			subjectId,
			predicate,
			payload,
			evidence: [
				{
					evidenceId,
					kind:
						origin === "runtime_observation"
							? "runtime_measurement"
							: origin === "user_report"
								? "user_statement"
								: "assistant_summary",
					stance: "supports",
					source: sources[source],
					rootEvidenceId: source,
				},
			],
			inputManifest: [sources[source]],
			origin,
			recordedAt: NOW,
			observedAt: NOW,
			freshnessPolicy: { maxAgeMs: 86400000 },
			condition:
				condition ??
				(origin === "model_hypothesis"
					? { kind: "unspecified" }
					: {
							kind: "explicitly_unconditional",
							adoptionEvidenceId: evidenceId,
						}),
			supersedes: [],
			contradicts: [],
			interpretationVersion: "fixture-contract-cycle/1",
			lifecycle: "candidate",
			rootEvidenceIds: [source],
		};
	}
	const relation = (
		relation: "enables" | "serves_goal" | "depends_on" | "correlates_with",
		objectId: string,
	): Assertion["payload"] => ({ kind: "relation", relation, objectId });
	const decision = (text: string): Assertion["payload"] => ({
		kind: "value",
		value: { kind: "string", value: text },
	});
	const initial = [
		assertion(
			"next-step",
			"evaluation-job",
			"next_step",
			decision("run-offline-audit"),
			"before",
		),
		assertion(
			"budget-hypothesis",
			"offline-audit",
			"budget_protection",
			relation("enables", "budget-protection"),
			"before",
		),
		assertion(
			"goal-link",
			"offline-audit",
			"goal",
			relation("serves_goal", GOAL.goalId),
			"operator",
			"user_report",
		),
		assertion(
			"review-dependency",
			"paid-evaluation",
			"prerequisite",
			relation("depends_on", "reviewed-contract"),
			"operator",
			"user_report",
		),
		assertion(
			"diagnostic-association",
			"representation-conflict",
			"association",
			relation("correlates_with", "failed-scores"),
			"before",
		),
		assertion(
			"paid-run-policy",
			"paid-evaluation",
			"allowed",
			{ kind: "value", value: { kind: "boolean", value: true } },
			"operator",
			"user_report",
			CLEAR_CONTRACT,
		),
	];
	const observation = assertion(
		"audit-observation",
		"evaluation-job",
		"representation_conflicts",
		{
			kind: "value",
			value: { kind: "number", value: audit.issues.length, unit: "facts" },
		},
		"audit",
		"runtime_observation",
	);
	const replacement = assertion(
		"next-step",
		"evaluation-job",
		"next_step",
		decision("repair-output-evidence-contract"),
		"after",
	);
	const prediction: QuantitativePrediction = {
		kind: "quantitative",
		predictionId: "audit-prediction",
		revision: 1,
		comparisonId: "single-quote-capacity-audit",
		conditions: {
			subjectId: "evaluation-job",
			metric: "representation_conflicts",
			unit: "facts",
			statistic: "count",
			configuration: "single-quote-candidate/v1",
			inputProfile: "independent.v1/frozen",
		},
		baselineRef: "zero-conflicts",
		baselineValue: 0,
		expectedWindow: { startMs: NOW, endMs: NOW + 1 },
		expectedDirection: "increases",
		measurementTolerance: 0,
		origin: "model_hypothesis",
	};
	return {
		documents,
		prediction,
		sources,
		hostChecks,
		initial,
		observation,
		outcomeRevision,
		replacement,
		adoptInitial: [
			"next-step",
			"goal-link",
			"review-dependency",
			"paid-run-policy",
		],
		replacementBasis: {
			assertion: { id: observation.id },
			outcome: { id: observation.id, revision: outcomeRevision },
			prediction: { id: "audit-prediction", revision: 1 },
		},
		// Obtained from the evaluator contract, independently of the prediction.
		measurement: {
			conditions: {
				subjectId: "evaluation-job",
				metric: "representation_conflicts",
				unit: "facts",
				statistic: "count",
				configuration: singleQuoteRepresentation.contract,
				inputProfile: "independent.v1/frozen",
			},
			window: { startMs: NOW, endMs: NOW + 1 },
			baselineRef: "zero-conflicts",
		},
	};
}
export type CycleFixture = ReturnType<typeof cycleFixture>;
