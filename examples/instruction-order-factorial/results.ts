import {
	assess as sharedAssess,
	summarize as sharedSummary,
	type Cell as SharedCell,
} from "../operative-sources-comparison/results.ts";
import type { AnswerContext } from "../multi-source-comparison/world.ts";
import { arms, type Arm } from "./protocol.ts";
import type { SourceQuestion } from "./fixtures.ts";
export function assess(
	q: SourceQuestion,
	context: AnswerContext,
	_arm: Arm,
	raw: string,
) {
	const score = sharedAssess(q, context, "baseline", raw);
	return score;
}
export interface Cell extends Omit<SharedCell, "arm"> {
	arm: Arm;
}
export function summarize(
	cells: readonly Cell[],
	questions: readonly SourceQuestion[],
) {
	function aggregate(qs: readonly SourceQuestion[]) {
		const byArm = Object.fromEntries(
			arms.map((arm) => [
				arm,
				sharedSummary(
					cells
						.filter((c) => c.arm === arm)
						.map((c) => ({ ...c, arm: "baseline" })),
					qs,
				).all.byArm.baseline!,
			]),
		);
		function pair(reference: Arm, candidate: Arm) {
			return sharedSummary(
				cells
					.filter((c) => c.arm === reference || c.arm === candidate)
					.map((c) => ({
						...c,
						arm: c.arm === reference ? "baseline" : "operative",
					})),
				qs,
			).all.pairs;
		}
		const contrasts = {
			instructionAtOriginalOrder: pair("baseline", "instruction"),
			instructionAtRevisedOrder: pair("order", "combined"),
			orderAtOriginalInstruction: pair("baseline", "order"),
			orderAtRevisedInstruction: pair("instruction", "combined"),
			combinedVersusBaseline: pair("baseline", "combined"),
		};
		const n = qs.length * 2;
		const b = byArm.baseline!.primaryCorrect,
			i = byArm.instruction!.primaryCorrect;
		const o = byArm.order!.primaryCorrect,
			c = byArm.combined!.primaryCorrect;
		return {
			byArm,
			contrasts,
			effects: {
				instructionRateDifference: n ? (i - b + (c - o)) / (2 * n) : null,
				orderRateDifference: n ? (o - b + (c - i)) / (2 * n) : null,
				interactionRateDifference: n ? (c - i - o + b) / n : null,
			},
		};
	}
	return {
		all: aggregate(questions),
		regression: aggregate(questions.filter((q) => q.suite === "regression")),
		unseen: aggregate(questions.filter((q) => q.suite === "unseen")),
		byPacket: Object.fromEntries(
			[...new Set(questions.map((q) => q.packet))].map((id) => [
				id,
				aggregate(questions.filter((q) => q.packet === id)),
			]),
		),
	};
}
