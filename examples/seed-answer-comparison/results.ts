import { asRecord } from "../../src/index.ts";
import { arms, axes, type Arm, type Axis } from "./protocol.ts";

export interface Answer {
	readonly answer: string;
	readonly citations: readonly string[];
	readonly needsMoreInformation: boolean;
}
export interface Grade extends Record<Axis, number> {
	readonly rationale: string;
	readonly uncertain: boolean;
}
export interface Cell {
	readonly questionId: string;
	readonly repeat: number;
	readonly arm: Arm;
	readonly answer: Answer;
	readonly latencyMs: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly citationsValid: boolean;
}
export interface Judgement {
	readonly questionId: string;
	readonly repeat: number;
	readonly mapping: Readonly<Record<string, Arm>>;
	readonly grades: Readonly<Record<Arm, Grade>>;
}

export function parseAnswer(raw: string): Answer {
	const value = asRecord(JSON.parse(raw));
	if (
		!value ||
		typeof value["answer"] !== "string" ||
		value["answer"].trim().length === 0 ||
		!Array.isArray(value["citations"]) ||
		!value["citations"].every((id) => typeof id === "string") ||
		typeof value["needsMoreInformation"] !== "boolean"
	)
		throw new Error("comparison_invalid_answer");
	return {
		answer: value["answer"],
		citations: value["citations"],
		needsMoreInformation: value["needsMoreInformation"],
	};
}

/** Counterbalanced order, recorded; no sampling seed/temperature claim. */
export function order(index: number, repeat: number): readonly Arm[] {
	const start = (index + repeat) % arms.length;
	return [...arms.slice(start), ...arms.slice(0, start)];
}
export function judgeMapping(
	index: number,
	repeat: number,
): Record<string, Arm> {
	return Object.fromEntries(
		[...order(index + 1, repeat)]
			.reverse()
			.map((arm, i) => [String.fromCharCode(65 + i), arm]),
	);
}

export function parseJudgement(
	raw: string,
	mapping: Readonly<Record<string, Arm>>,
): Record<Arm, Grade> {
	const root = asRecord(JSON.parse(raw));
	if (
		!root ||
		!Array.isArray(root["assessments"]) ||
		root["assessments"].length !== arms.length
	)
		throw new Error("comparison_invalid_judgement");
	const grades = new Map<Arm, Grade>();
	for (const entry of root["assessments"]) {
		const assessment = asRecord(entry);
		const label = assessment?.["label"];
		const arm = typeof label === "string" ? mapping[label] : undefined;
		if (
			!assessment ||
			!arm ||
			grades.has(arm) ||
			typeof assessment["rationale"] !== "string" ||
			typeof assessment["uncertain"] !== "boolean"
		)
			throw new Error("comparison_invalid_judge_label");
		function score(axis: Axis) {
			const value = assessment![axis];
			if (
				typeof value !== "number" ||
				!Number.isInteger(value) ||
				value < 0 ||
				value > 2
			)
				throw new Error("comparison_invalid_score");
			return value;
		}
		grades.set(arm, {
			accuracy: score("accuracy"),
			completeness: score("completeness"),
			scope: score("scope"),
			calibration: score("calibration"),
			rationale: assessment["rationale"],
			uncertain: assessment["uncertain"],
		});
	}
	const get = (arm: Arm) => {
		const grade = grades.get(arm);
		if (!grade) throw new Error("comparison_missing_grade");
		return grade;
	};
	return {
		"no-seed": get("no-seed"),
		"raw-seed": get("raw-seed"),
		"world-seed": get("world-seed"),
	};
}
export const total = (grade: Grade) =>
	axes.reduce((sum, axis) => sum + grade[axis], 0);
const mean = (values: readonly number[]) =>
	values.length === 0
		? null
		: values.reduce((a, b) => a + b, 0) / values.length;

export function summarize(
	cells: readonly Cell[],
	judgements: readonly Judgement[],
) {
	const byArm = Object.fromEntries(
		arms.map((arm) => {
			const graded = judgements
				.map((j) => j.grades[arm])
				.filter((g) => !g.uncertain);
			const answers = cells.filter((cell) => cell.arm === arm);
			return [
				arm,
				{
					answered: answers.length,
					scored: graded.length,
					uncertain: judgements.length - graded.length,
					meanScoreOutOf8: mean(graded.map(total)),
					axes: Object.fromEntries(
						axes.map((axis) => [axis, mean(graded.map((g) => g[axis]))]),
					),
					meanLatencyMs: mean(answers.map((c) => c.latencyMs)),
					meanInputTokens: mean(answers.map((c) => c.inputTokens)),
					meanOutputTokens: mean(answers.map((c) => c.outputTokens)),
					answersWithCitations: answers.filter(
						(c) => c.answer.citations.length > 0,
					).length,
					invalidCitationAnswers: answers.filter((c) => !c.citationsValid)
						.length,
				},
			];
		}),
	);
	const compare = (from: Arm, to: Arm) => {
		const pairs = judgements.map((j) => {
			const a = j.grades[from],
				b = j.grades[to];
			const verdict =
				a.uncertain || b.uncertain
					? "incomparable"
					: axes.some((axis) => b[axis] < a[axis])
						? "worse"
						: total(b) > total(a)
							? "improved"
							: "same";
			return {
				questionId: j.questionId,
				repeat: j.repeat,
				verdict,
				delta: verdict === "incomparable" ? null : total(b) - total(a),
			};
		});
		return {
			from,
			to,
			meanDeltaOutOf8: mean(
				pairs.flatMap((p) => (p.delta === null ? [] : [p.delta])),
			),
			improved: pairs.filter((p) => p.verdict === "improved").length,
			worse: pairs.filter((p) => p.verdict === "worse").length,
			same: pairs.filter((p) => p.verdict === "same").length,
			incomparable: pairs.filter((p) => p.verdict === "incomparable").length,
			pairs,
		};
	};
	return {
		byArm,
		comparisons: [
			compare("no-seed", "raw-seed"),
			compare("no-seed", "world-seed"),
			compare("raw-seed", "world-seed"),
		],
	};
}
