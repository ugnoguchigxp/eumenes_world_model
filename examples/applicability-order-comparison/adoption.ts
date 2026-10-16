import { summarize, type Cell } from "./results.ts";
import { questions, targetControls } from "./fixtures.ts";
import { design } from "./protocol.ts";
export function adoption(cells: readonly Cell[]) {
	const summary = summarize(cells, questions);
	const candidate = cells.filter((c) => c.arm === "applicability");
	const conditions = {
		allCallsComplete:
			cells.length === design.plannedAnswers &&
			cells.every((c) => c.status === "answered"),
		controlsCorrect: targetControls.every((id) =>
			[0, 1].every((repeat) =>
				candidate.some(
					(c) =>
						c.questionId === id &&
						c.repeat === repeat &&
						c.score?.primaryCorrect,
				),
			),
		),
		cohortPrimaryNondecreasing: [summary.regression, summary.unseen].every(
			(s) =>
				["baseline", "operative"].every(
					(a) =>
						s.byArm.applicability!.primaryCorrect >= s.byArm[a]!.primaryCorrect,
				),
		),
		cohortDecisionNondecreasing: [summary.regression, summary.unseen].every(
			(s) =>
				["baseline", "operative"].every(
					(a) =>
						s.byArm.applicability!.decisionCorrect >=
						s.byArm[a]!.decisionCorrect,
				),
		),
		noFalseAllow: !candidate.some((c) => c.score?.falseAllow),
		noRetiredSourceLeak: !candidate.some((c) => c.score?.retiredSourceLeak),
		currentPairedImprovement: [
			summary.all.pairs.versusBaseline,
			summary.all.pairs.versusOperative,
		].some((p) => p.better > p.worse),
	};
	const retained = Object.values(conditions).every(Boolean);
	const unseenSuperiority =
		summary.unseen.pairs.versusBaseline.better >
		summary.unseen.pairs.versusBaseline.worse;
	return {
		retained,
		preferred: retained && unseenSuperiority,
		conditions,
		unseenSuperiority,
	};
}
