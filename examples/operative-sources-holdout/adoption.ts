import type { Cell } from "../operative-sources-comparison/results.ts";
import { summarize } from "../operative-sources-comparison/results.ts";
import { questions, preservationControls } from "./fixtures.ts";
import { design } from "./protocol.ts";
export function adoption(cells: readonly Cell[]) {
	const summary = summarize(cells, questions);
	const positiveNewPackets = Object.entries(summary.byPacket)
		.filter(
			([id, s]) =>
				questions.some((q) => q.packet === id && q.suite === "unseen") &&
				s.pairs.better > s.pairs.worse,
		)
		.map(([id]) => id);
	const conditions = {
		allCallsComplete:
			cells.length === design.plannedAnswers &&
			cells.every((c) => c.status === "answered"),
		unseenWinsExceedLosses:
			summary.unseen.pairs.better > summary.unseen.pairs.worse,
		atLeastTwoNewPacketsImprove: positiveNewPackets.length >= 2,
		regressionPrimaryNondecreasing:
			summary.regression.byArm.operative!.primaryCorrect >=
			summary.regression.byArm.baseline!.primaryCorrect,
		decisionsNondecreasing: [summary.regression, summary.unseen].every(
			(s) =>
				s.byArm.operative!.decisionCorrect >= s.byArm.baseline!.decisionCorrect,
		),
		noNewFalseAllow: cells
			.filter((c) => c.arm === "operative" && c.score?.falseAllow)
			.every((c) =>
				cells.some(
					(b) =>
						b.arm === "baseline" &&
						b.questionId === c.questionId &&
						b.repeat === c.repeat &&
						b.score?.falseAllow,
				),
			),
		noRetiredSourceLeak: !cells.some(
			(c) => c.arm === "operative" && c.score?.retiredSourceLeak,
		),
		preservationControlsCorrect: preservationControls.every((id) =>
			[0, 1].every((repeat) =>
				cells.some(
					(c) =>
						c.arm === "operative" &&
						c.questionId === id &&
						c.repeat === repeat &&
						c.score?.primaryCorrect,
				),
			),
		),
	};
	return {
		adopted: Object.values(conditions).every(Boolean),
		conditions,
		positiveNewPackets,
	};
}
