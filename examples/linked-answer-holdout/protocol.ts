import legacy from "./legacy-instructions.json";
import linked from "./linked-instructions.json";
import { answerSchemaFor } from "../multi-source-comparison/protocol.ts";
import {
	linkedContext,
	type AnswerContext,
} from "../multi-source-comparison/world.ts";
import type { Question } from "../multi-source-comparison/fixtures.ts";
export const arms = ["legacy", "linked"] as const;
export type Arm = (typeof arms)[number];
export const instructions = {
	legacy: legacy.instructions,
	linked: linked.instructions,
};
export function presentation(
	question: Question,
	context: AnswerContext,
	arm: Arm,
) {
	return JSON.stringify({
		synthetic: true,
		asOf: new Date(question.asOf).toISOString(),
		asOfEpochMs: question.asOf,
		question: question.question,
		observations: question.observations.map((observation) => ({
			...observation,
			observedAtIso: new Date(observation.observedAt).toISOString(),
		})),
		// v4's lossless join, without v5's optional atomic comparisons.
		context: arm === "linked" ? linkedContext(context) : context,
	});
}
export function schemaFor(context: AnswerContext, arm: Arm) {
	const ids = context.sources.map((s) => s.id);
	if (arm === "linked")
		return answerSchemaFor(
			ids,
			context.derivedView?.slice.units.map((u) => u.assertionId) ?? null,
		);
	return {
		type: "object",
		required: ["decision", "governingSources", "explanation"],
		additionalProperties: false,
		properties: {
			decision: { type: "string", enum: ["allow", "deny", "hold"] },
			governingSources: { type: "array", items: { type: "string", enum: ids } },
			explanation: { type: "string" },
		},
	};
}
export function order(index: number, repeat: number): readonly Arm[] {
	return (index + repeat) % 2 === 0 ? arms : [...arms].reverse();
}
export const design = {
	kind: "new synthetic packets held out from v4 prompt development; not independent authors or real-world validation",
	contrasts:
		"v2 instruction/output/separate-evaluation bundle versus unchanged v4 instruction/output/linked-calculation bundle; individual component effects not isolated",
	repeats: 2,
	concurrency: 2,
	plannedExtractions: 8,
	plannedAnswers: 128,
	primary:
		"first response exact decision against pre-frozen oracle; paired question/repeat differences; report all planned cases including failures",
	secondary: [
		"exact governing sources",
		"false allow among oracle nonallow",
		"correct allow",
		"correct hold",
		"linked-only calculation copy/decision consistency",
		"oracle permission-source coverage and assessment results",
		"tokens including extraction",
		"latency",
		"all explanation texts reviewed separately without rescoring",
	],
	adoption:
		"Do not claim general improvement unless paired correctness improves without extra false allows; ties mean additional benefit unconfirmed. Even zero observed failures is not a safety guarantee. Report per packet and both repetitions; no statistical claim from 128 independent samples.",
	budget:
		"8 extraction + 128 answer calls maximum; no model fallback; 120 seconds each; no automatic retry; errors retained and never rescored as correct",
	nonGoals: [
		"changing v4 instructions using holdout outputs",
		"rewriting answers",
		"semantic keyword fixes",
		"new product APIs",
		"adopting candidate assertions",
		"host integration",
		"separate claim of explanation correctness from schema validation",
	],
};
