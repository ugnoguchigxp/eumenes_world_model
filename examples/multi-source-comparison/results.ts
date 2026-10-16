import { asRecord } from "../../src/index.ts";
import { arms, type Arm, type Decision, type Question } from "./fixtures.ts";
export interface Answer {
	decision: Decision;
	governingSources: string[];
	explanation: string;
}
export interface Cell {
	questionId: string;
	repeat: number;
	arm: Arm;
	answer: Answer;
	decisionCorrect: boolean;
	governingSourcesCorrect: boolean;
	jointCorrect: boolean;
	latencyMs: number;
	inputTokens: number;
	outputTokens: number;
}
export function parseAnswer(raw: string): Answer {
	const item = asRecord(JSON.parse(raw));
	if (
		!item ||
		!["allow", "deny", "hold"].includes(String(item["decision"])) ||
		!Array.isArray(item["governingSources"]) ||
		item["governingSources"].some((id) => typeof id !== "string") ||
		typeof item["explanation"] !== "string" ||
		!item["explanation"].trim()
	)
		throw new Error("invalid_answer");
	const ids = item["governingSources"] as string[];
	if (new Set(ids).size !== ids.length)
		throw new Error("duplicate_answer_sources");
	return {
		decision: item["decision"] as Decision,
		governingSources: ids,
		explanation: item["explanation"],
	};
}
/** Exact field scoring against a pre-frozen oracle, never a text/keyword judge. */
export function score(question: Question, answer: Answer) {
	const decisionCorrect = answer.decision === question.expected.decision;
	const governingSourcesCorrect =
		JSON.stringify([...answer.governingSources].sort()) ===
		JSON.stringify([...question.expected.governingSources].sort());
	return {
		decisionCorrect,
		governingSourcesCorrect,
		jointCorrect: decisionCorrect && governingSourcesCorrect,
	};
}
export function order(index: number, repeat: number): readonly Arm[] {
	return (index + repeat) % 2 === 0 ? arms : [...arms].reverse();
}
export function summarize(cells: readonly Cell[]) {
	const byArm = Object.fromEntries(
		arms.map((arm) => {
			const rows = cells.filter((c) => c.arm === arm);
			return [
				arm,
				{
					answers: rows.length,
					decisionCorrect: rows.filter((c) => c.decisionCorrect).length,
					governingSourcesCorrect: rows.filter((c) => c.governingSourcesCorrect)
						.length,
					jointCorrect: rows.filter((c) => c.jointCorrect).length,
					inputTokens: rows.reduce((n, c) => n + c.inputTokens, 0),
					outputTokens: rows.reduce((n, c) => n + c.outputTokens, 0),
					meanLatencyMs: rows.length
						? rows.reduce((n, c) => n + c.latencyMs, 0) / rows.length
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
		incomplete: 0,
	};
	for (const raw of cells.filter((c) => c.arm === "raw")) {
		const world = cells.find(
			(c) =>
				c.arm === "world" &&
				c.questionId === raw.questionId &&
				c.repeat === raw.repeat,
		);
		if (!world) pairs.incomplete++;
		else if (world.jointCorrect && !raw.jointCorrect) pairs.better++;
		else if (!world.jointCorrect && raw.jointCorrect) pairs.worse++;
		else if (world.jointCorrect) pairs.bothCorrect++;
		else pairs.bothWrong++;
	}
	return { byArm, pairs };
}
