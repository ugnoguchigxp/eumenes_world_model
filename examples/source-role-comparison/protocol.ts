import baseline from "./baseline-instructions.json";
import role from "./role-instructions.json";
import { answerSchemaFor } from "../multi-source-comparison/protocol.ts";
import {
	answerPrompt,
	type AnswerContext,
} from "../multi-source-comparison/world.ts";
import type { Question } from "../multi-source-comparison/fixtures.ts";
export const arms = ["baseline", "roles"] as const;
export type Arm = (typeof arms)[number];
export const instructions = {
	baseline: baseline.instructions,
	roles: role.instructions,
};
export function presentation(question: Question, context: AnswerContext) {
	return answerPrompt(question, context);
}
const object = <const T extends Record<string, unknown>>(properties: T) => ({
	type: "object",
	properties,
	required: Object.keys(properties),
	additionalProperties: false,
});
export function schemaFor(context: AnswerContext, arm: Arm) {
	const ids = context.sources.map((s) => s.id);
	const assertionIds =
		context.derivedView?.slice.units.map((u) => u.assertionId) ?? null;
	if (arm === "baseline") return answerSchemaFor(ids, assertionIds);
	const sourceId = { type: "string", enum: ids };
	const assessment = object({
		assertionId: assertionIds
			? { type: "string", enum: assertionIds }
			: { type: "null" },
		result: { type: "string", enum: ["satisfied", "violated", "unknown"] },
		overrideReason: assertionIds
			? { type: ["string", "null"] }
			: { type: "null" },
	});
	return object({
		sources: {
			type: "array",
			items: {
				anyOf: [
					object({
						sourceId,
						role: {
							type: "string",
							enum: ["permission_rule", "permission_rule_and_support"],
						},
						assessment,
					}),
					object({
						sourceId,
						role: { type: "string", enum: ["supporting_evidence"] },
						assessment: { type: "null" },
					}),
				],
			},
		},
		explanation: { type: "string" },
		decision: { type: "string", enum: ["allow", "deny", "hold"] },
	});
}
export function order(index: number, repeat: number): readonly Arm[] {
	return (index + repeat) % 2 === 0 ? arms : [...arms].reverse();
}
export const design = {
	repeats: 2,
	concurrency: 2,
	plannedExtractions: 4,
	plannedAnswers: 64,
	contrast:
		"Frozen v5 versus single source record with LLM-selected role and optional permission assessment. Identical v5 inputs. Instruction/output-contract bundle; no host semantic classification.",
	primary:
		"First response: decision + governing source set + permission-source assessment set/results + existing grounding audit, against frozen oracles. Report regression and unseen separately, including all failures.",
	secondary: [
		"false allow",
		"decision",
		"source set",
		"assessment source set/results",
		"candidate-only role labels",
		"explanation review",
		"usage and latency",
	],
	adoption:
		"Retain as a preferred candidate only if unseen primary paired wins exceed losses, no new false allow, and no loss in decision correctness or regression primary score. Ties mean no demonstrated benefit. Do not promote to shared baseline automatically.",
	budget:
		"At most 4 extraction and 64 answer calls, 120 seconds each. No application retries or fallback. First failures cached; resume does not resample them. SDK transport reconnects are separate.",
	limits:
		"Synthetic role-focused set by the same author/reviewer, not independent human or real-work acceptance. Repetitions and same-packet questions are correlated. Existing regression contexts are frozen; unseen extraction failures stay failures. No prompt or oracle tuning after live execution.",
};
