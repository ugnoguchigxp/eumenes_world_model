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
	raw?: string;
	review?: Omit<
		Awaited<ReturnType<typeof import("./review.ts").review>>,
		"raw" | "inputTokens" | "outputTokens" | "latencyMs"
	>;
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
		return {
			byArm,
			auditByArm: Object.fromEntries(
				arms.map((arm) => {
					const rows = cells.filter(
						(c) => c.arm === arm && qs.some((q) => q.id === c.questionId),
					);
					return [
						arm,
						{
							accepted: rows.filter((c) => c.review?.accepted).length,
							acceptedWrong: rows.filter(
								(c) => c.review?.accepted && !c.score?.primaryCorrect,
							).length,
							rejectedCorrect: rows.filter(
								(c) => c.score?.primaryCorrect && !c.review?.accepted,
							).length,
							newlyCaughtInitial: rows.filter(
								(c) =>
									c.review?.initialAudit.passed &&
									c.review?.initialRole?.passed === false,
							).length,
							finalRoleRejections: rows.filter(
								(c) => c.review?.finalRole?.passed === false,
							).length,
							reviews: rows.filter((c) => c.review?.repairAttempted).length,
						},
					];
				}),
			),
			pairs: {
				versusBaseline: pair("baseline", "role"),
				versusControl: pair("control", "role"),
				controlVersusBaseline: pair("baseline", "control"),
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
