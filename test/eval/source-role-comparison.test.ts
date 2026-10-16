import { expect, test } from "bun:test";
import {
	packets,
	questions,
	regressions,
	unseenQuestions,
} from "../../examples/source-role-comparison/fixtures.ts";
import {
	parseRoleAnswer,
	assess,
	summarize,
} from "../../examples/source-role-comparison/results.ts";
import {
	presentation,
	schemaFor,
	order,
} from "../../examples/source-role-comparison/protocol.ts";
import observed from "../../examples/source-role-comparison/regression-observed-error.json";
import { extractionPrompt } from "../../examples/multi-source-comparison/world.ts";

test("role experiment has separate regression and unseen cohorts with predeclared applicable rules", () => {
	expect(regressions).toHaveLength(4);
	expect(packets).toHaveLength(4);
	expect(unseenQuestions).toHaveLength(12);
	expect(new Set(questions.map((q) => q.id)).size).toBe(16);
	for (const q of questions) {
		expect(Object.keys(q.expectedRoles).sort()).toEqual(
			[...q.expected.governingSources].sort(),
		);
		expect(
			Object.entries(q.expectedRoles)
				.filter(([, r]) => r !== "supporting_evidence")
				.map(([id]) => id)
				.sort(),
		).toEqual(Object.keys(q.expectedAssessments).sort());
	}
	for (const p of packets) {
		expect(unseenQuestions.filter((q) => q.packet === p.id)).toHaveLength(3);
		expect(Object.keys(JSON.parse(extractionPrompt(p))).sort()).toEqual([
			"documents",
			"entity",
			"observationKeys",
			"synthetic",
		]);
	}
});
test("answer presentation does not disclose expected roles, decisions or cohort", () => {
	for (const c of regressions) {
		const prompt = JSON.parse(presentation(c.question, c.context));
		expect(Object.keys(prompt).sort()).toEqual([
			"asOf",
			"asOfEpochMs",
			"context",
			"observationAvailability",
			"observations",
			"question",
			"synthetic",
		]);
		const changed: typeof c.question = {
			...c.question,
			expected: {
				decision: "deny",
				governingSources: [],
				reason: "oracle changed",
			},
			expectedRoles: {},
			expectedAssessments: {},
			suite: "unseen",
		};
		expect(presentation(changed, c.context)).toBe(
			presentation(c.question, c.context),
		);
		for (const arm of ["baseline", "roles"] as const) {
			const schema = schemaFor(c.context, arm);
			expect(schema.properties.decision.enum).toEqual([
				"allow",
				"deny",
				"hold",
			]);
			expect(Object.keys(schema.properties).at(-1)).toBe("decision");
		}
	}
});
test("real v5 supplementary-source contamination passes self-consistency but fails semantic oracle", () => {
	const c = regressions.find((c) => c.question.id === "O04")!;
	const scored = assess(c.question, c.context, "baseline", observed.response);
	expect(scored.decisionCorrect).toBe(true);
	expect(scored.grounding?.passed).toBe(true);
	expect(scored.assessmentsCorrect).toBe(false);
	expect(scored.primaryCorrect).toBe(false);
});
test("role contract supports mixed documents and rejects contradictory self-declarations without reclassifying", () => {
	for (const role of ["permission_rule", "permission_rule_and_support"]) {
		const parsed = parseRoleAnswer(
			JSON.stringify({
				sources: [
					{
						sourceId: "renamed-rule",
						role,
						assessment: {
							assertionId: "random-claim",
							result: "satisfied",
							overrideReason: null,
						},
					},
					{
						sourceId: "renamed-policy",
						role: "supporting_evidence",
						assessment: null,
					},
				],
				explanation: "fixture",
				decision: "allow",
			}),
		);
		expect(parsed.answer.assessments.map((a) => a.sourceId)).toEqual([
			"renamed-rule",
		]);
		expect(parsed.answer.governingSources).toEqual([
			"renamed-rule",
			"renamed-policy",
		]);
	}
	const raw = (role: string, assessment: unknown) =>
		JSON.stringify({
			sources: [{ sourceId: "arbitrary", role, assessment }],
			explanation: "fixture",
			decision: "hold",
		});
	expect(() =>
		parseRoleAnswer(
			raw("supporting_evidence", {
				assertionId: "x",
				result: "unknown",
				overrideReason: null,
			}),
		),
	).toThrow("support_has_permission_assessment");
	expect(() => parseRoleAnswer(raw("permission_rule", null))).toThrow(
		"permission_missing_assessment",
	);
	expect(() => parseRoleAnswer(raw("invented", null))).toThrow(
		"invalid_source_role",
	);
});
test("a self-consistent but semantically wrong role is not rescued by normalization", () => {
	const c = regressions.find((c) => c.question.id === "O04")!;
	const original = JSON.parse(observed.response);
	const sources = original.assessments.map((a: Record<string, unknown>) => ({
		sourceId: a["sourceId"],
		role: "permission_rule",
		assessment: {
			assertionId: a["assertionId"],
			result: a["result"],
			overrideReason: a["overrideReason"],
		},
	}));
	const scored = assess(
		c.question,
		c.context,
		"roles",
		JSON.stringify({
			sources,
			explanation: original.explanation,
			decision: original.decision,
		}),
	);
	expect(scored.grounding?.passed).toBe(true);
	expect(scored.primaryCorrect).toBe(false);
	expect(scored.roleLabelsCorrect).toBe(false);
	const correct = sources.map(
		(s: { sourceId: string; role: string; assessment: unknown }) =>
			c.question.expectedRoles[s.sourceId] === "supporting_evidence"
				? { ...s, role: "supporting_evidence", assessment: null }
				: s,
	);
	const accepted = assess(
		c.question,
		c.context,
		"roles",
		JSON.stringify({
			sources: correct,
			explanation: "fixture",
			decision: original.decision,
		}),
	);
	expect(accepted.primaryCorrect).toBe(true);
	expect(accepted.roleLabelsCorrect).toBe(true);
});
test("unanswered cases stay in planned denominators and order reverses by repeat", () => {
	const summary = summarize([], questions);
	expect(summary.all.byArm["baseline"]!.planned).toBe(32);
	expect(summary.unseen.byArm["roles"]!.planned).toBe(24);
	expect(summary.regression.byArm["roles"]!.planned).toBe(8);
	expect(summary.all.pairs.unanswered).toBe(32);
	for (let i = 0; i < 16; i++)
		expect(order(i, 1)).toEqual([...order(i, 0)].reverse());
});
