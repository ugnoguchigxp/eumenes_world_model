import { assess as assessGrounded } from "../linked-answer-holdout/results.ts";
import type { AnswerContext } from "../multi-source-comparison/world.ts";
import type { SourceQuestion } from "./fixtures.ts";
import { arms, type Arm } from "./protocol.ts";
export function assess(
	q: SourceQuestion,
	context: AnswerContext,
	_arm: Arm,
	raw: string,
) {
	const score = assessGrounded(q, context, "linked", raw);
	return {
		...score,
		primaryCorrect:
			score.jointCorrect &&
			score.assessmentsCorrect === true &&
			score.grounding?.passed === true,
		retiredSourceLeak:
			score.answer?.governingSources.some((id) =>
				q.retiredOnlySources.includes(id),
			) ?? false,
	};
}
export interface Cell {
	questionId: string;
	suite: string;
	packet: string;
	repeat: number;
	arm: Arm;
	status: "answered" | "failed";
	error?: string;
	score?: ReturnType<typeof assess>;
	inputTokens: number;
	outputTokens: number;
	latencyMs: number;
}
export function summarize(
	cells: readonly Cell[],
	questions: readonly SourceQuestion[],
) {
	function aggregate(qs: readonly SourceQuestion[]) {
		const selected = cells.filter((c) => qs.some((q) => q.id === c.questionId));
		const byArm = Object.fromEntries(
			arms.map((arm) => {
				const rows = selected.filter((c) => c.arm === arm);
				const answered = rows.filter((c) => c.status === "answered");
				return [
					arm,
					{
						planned: qs.length * 2,
						answered: answered.length,
						failed: rows.filter((c) => c.status === "failed").length,
						primaryCorrect: rows.filter((c) => c.score?.primaryCorrect).length,
						decisionCorrect: rows.filter((c) => c.score?.decisionCorrect)
							.length,
						sourcesCorrect: rows.filter((c) => c.score?.governingSourcesCorrect)
							.length,
						assessmentsCorrect: rows.filter((c) => c.score?.assessmentsCorrect)
							.length,
						groundingPassed: rows.filter((c) => c.score?.grounding?.passed)
							.length,
						falseAllow: rows.filter((c) => c.score?.falseAllow).length,
						retiredSourceLeaks: rows.filter((c) => c.score?.retiredSourceLeak)
							.length,
						inputTokens: rows.reduce((n, c) => n + c.inputTokens, 0),
						outputTokens: rows.reduce((n, c) => n + c.outputTokens, 0),
						meanAnsweredLatencyMs: answered.length
							? answered.reduce((n, c) => n + c.latencyMs, 0) / answered.length
							: null,
					},
				];
			}),
		);
		const pairs = {
			better: 0,
			worse: 0,
			bothCorrect: 0,
			bothWrong: 0,
			unanswered: 0,
		};
		for (const q of qs)
			for (let repeat = 0; repeat < 2; repeat++) {
				const a = selected.find(
					(c) =>
						c.questionId === q.id &&
						c.repeat === repeat &&
						c.arm === "baseline",
				);
				const b = selected.find(
					(c) =>
						c.questionId === q.id &&
						c.repeat === repeat &&
						c.arm === "operative",
				);
				if (a?.status !== "answered" || b?.status !== "answered")
					pairs.unanswered++;
				else if (a.score?.primaryCorrect && b.score?.primaryCorrect)
					pairs.bothCorrect++;
				else if (!a.score?.primaryCorrect && b.score?.primaryCorrect)
					pairs.better++;
				else if (a.score?.primaryCorrect && !b.score?.primaryCorrect)
					pairs.worse++;
				else pairs.bothWrong++;
			}
		return { byArm, pairs };
	}
	return {
		all: aggregate(questions),
		regression: aggregate(questions.filter((q) => q.suite === "regression")),
		unseen: aggregate(questions.filter((q) => q.suite === "unseen")),
		byPacket: Object.fromEntries(
			[...new Set(questions.map((q) => q.packet))].map((p) => [
				p,
				aggregate(questions.filter((q) => q.packet === p)),
			]),
		),
	};
}
