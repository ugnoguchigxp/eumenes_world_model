import { asRecord } from "../../src/index.ts";
import {
	parseGroundedAnswer,
	type GroundedAnswer,
} from "../multi-source-comparison/grounding.ts";
import { assess as assessGrounded } from "../linked-answer-holdout/results.ts";
import type { AnswerContext } from "../multi-source-comparison/world.ts";
import type { RoleQuestion, Role } from "./fixtures.ts";
import { arms, type Arm } from "./protocol.ts";
export function parseRoleAnswer(raw: string): {
	answer: GroundedAnswer;
	roles: Record<string, Role>;
} {
	const value = asRecord(JSON.parse(raw));
	if (!value || !Array.isArray(value["sources"]))
		throw new Error("missing_role_sources");
	const roles: Record<string, Role> = {};
	const ids: string[] = [];
	const assessments: unknown[] = [];
	for (const entry of value["sources"]) {
		const s = asRecord(entry);
		if (
			!s ||
			typeof s["sourceId"] !== "string" ||
			![
				"permission_rule",
				"supporting_evidence",
				"permission_rule_and_support",
			].includes(String(s["role"]))
		)
			throw new Error("invalid_source_role");
		const id = s["sourceId"];
		ids.push(id);
		roles[id] = s["role"] as Role;
		// Check the model's declared contract only; never infer the role from text/IDs/results.
		if (s["role"] === "supporting_evidence") {
			if (s["assessment"] !== null)
				throw new Error("support_has_permission_assessment");
		} else {
			const a = asRecord(s["assessment"]);
			if (!a) throw new Error("permission_missing_assessment");
			assessments.push({ ...a, sourceId: id });
		}
	}
	return {
		answer: parseGroundedAnswer(
			JSON.stringify({
				governingSources: ids,
				assessments,
				explanation: value["explanation"],
				decision: value["decision"],
			}),
		),
		roles,
	};
}
export function assess(
	q: RoleQuestion,
	context: AnswerContext,
	arm: Arm,
	raw: string,
) {
	const parsed = arm === "roles" ? parseRoleAnswer(raw) : null;
	const scored = assessGrounded(
		q,
		context,
		"linked",
		parsed ? JSON.stringify(parsed.answer) : raw,
	);
	return {
		...scored,
		primaryCorrect:
			scored.jointCorrect &&
			scored.assessmentsCorrect === true &&
			scored.grounding?.passed === true,
		roleLabelsCorrect: parsed
			? JSON.stringify(Object.entries(parsed.roles).sort()) ===
				JSON.stringify(Object.entries(q.expectedRoles).sort())
			: null,
		...(parsed ? { declaredRoles: parsed.roles } : {}),
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
	questions: readonly RoleQuestion[],
) {
	function aggregate(qs: readonly RoleQuestion[]) {
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
						roleLabelsCorrect:
							arm === "roles"
								? rows.filter((c) => c.score?.roleLabelsCorrect).length
								: null,
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
						c.questionId === q.id && c.repeat === repeat && c.arm === "roles",
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
