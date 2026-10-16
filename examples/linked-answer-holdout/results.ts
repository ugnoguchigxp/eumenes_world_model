import {
	parseAnswer,
	score,
	type Answer,
} from "../multi-source-comparison/results.ts";
import {
	auditGrounding,
	parseGroundedAnswer,
	type GroundedAnswer,
	type GroundingAudit,
} from "../multi-source-comparison/grounding.ts";
import type { AnswerContext } from "../multi-source-comparison/world.ts";
import type { HoldoutQuestion } from "./fixtures.ts";
import { arms, type Arm } from "./protocol.ts";
export interface Cell {
	questionId: string;
	packet: string;
	repeat: number;
	arm: Arm;
	status: "answered" | "failed";
	error?: string;
	answer?: Answer | GroundedAnswer;
	decisionCorrect: boolean;
	governingSourcesCorrect: boolean;
	jointCorrect: boolean;
	falseAllow: boolean;
	grounding?: GroundingAudit;
	assessmentsCorrect?: boolean;
	inputTokens: number;
	outputTokens: number;
	latencyMs: number;
}
export function assess(
	question: HoldoutQuestion,
	context: AnswerContext,
	arm: Arm,
	raw: string,
): Pick<
	Cell,
	| "answer"
	| "decisionCorrect"
	| "governingSourcesCorrect"
	| "jointCorrect"
	| "falseAllow"
	| "grounding"
	| "assessmentsCorrect"
> {
	const grounded = arm === "linked" ? parseGroundedAnswer(raw) : undefined;
	const answer = grounded ?? parseAnswer(raw);
	const base = {
		answer,
		...score(question, answer),
		falseAllow:
			question.expected.decision !== "allow" && answer.decision === "allow",
	};
	if (!grounded) return base;
	const declarations = grounded.assessments;
	const expected = Object.entries(question.expectedAssessments);
	return {
		...base,
		grounding: auditGrounding(grounded, context),
		assessmentsCorrect:
			declarations.length === expected.length &&
			expected.every(
				([id, result]) =>
					declarations.filter((a) => a.sourceId === id && a.result === result)
						.length === 1,
			),
	};
}
export function summarize(
	cells: readonly Cell[],
	questions: readonly HoldoutQuestion[],
	repeats = 2,
) {
	const aggregate = (
		rows: readonly Cell[],
		selected: readonly HoldoutQuestion[],
	) =>
		Object.fromEntries(
			arms.map((arm) => {
				const a = rows.filter((c) => c.arm === arm);
				const correct = (decision: string) =>
					a.filter(
						(c) =>
							c.decisionCorrect &&
							selected.find((q) => q.id === c.questionId)?.expected.decision ===
								decision,
					).length;
				return [
					arm,
					{
						planned: selected.length * repeats,
						answered: a.filter((c) => c.status === "answered").length,
						failed: a.filter((c) => c.status === "failed").length,
						decisionCorrect: a.filter((c) => c.decisionCorrect).length,
						sourcesCorrect: a.filter((c) => c.governingSourcesCorrect).length,
						jointCorrect: a.filter((c) => c.jointCorrect).length,
						falseAllow: a.filter((c) => c.falseAllow).length,
						nonAllowCases:
							selected.filter((q) => q.expected.decision !== "allow").length *
							repeats,
						correctAllow: correct("allow"),
						correctHold: correct("hold"),
						groundingPassed:
							arm === "linked"
								? a.filter((c) => c.grounding?.passed).length
								: null,
						assessmentOracleCorrect:
							arm === "linked"
								? a.filter((c) => c.assessmentsCorrect).length
								: null,
						correctAndGrounded:
							arm === "linked"
								? a.filter(
										(c) =>
											c.jointCorrect &&
											c.assessmentsCorrect &&
											c.grounding?.passed,
									).length
								: null,
						inputTokens: a.reduce((n, c) => n + c.inputTokens, 0),
						outputTokens: a.reduce((n, c) => n + c.outputTokens, 0),
						meanLatencyMs: a.length
							? a.reduce((n, c) => n + c.latencyMs, 0) / a.length
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
	for (const q of questions)
		for (let repeat = 0; repeat < repeats; repeat++) {
			const a = cells.find(
				(c) =>
					c.questionId === q.id && c.repeat === repeat && c.arm === "legacy",
			);
			const b = cells.find(
				(c) =>
					c.questionId === q.id && c.repeat === repeat && c.arm === "linked",
			);
			if (a?.status !== "answered" || b?.status !== "answered")
				pairs.unanswered++;
			else if (a.decisionCorrect && b.decisionCorrect) pairs.bothCorrect++;
			else if (!a.decisionCorrect && b.decisionCorrect) pairs.better++;
			else if (a.decisionCorrect && !b.decisionCorrect) pairs.worse++;
			else pairs.bothWrong++;
		}
	return {
		byArm: aggregate(cells, questions),
		pairs,
		byPacket: Object.fromEntries(
			[...new Set(questions.map((q) => q.packet))].map((id) => [
				id,
				aggregate(
					cells.filter((c) => c.packet === id),
					questions.filter((q) => q.packet === id),
				),
			]),
		),
	};
}
