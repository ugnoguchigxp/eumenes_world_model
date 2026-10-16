import { expect, test } from "bun:test";
import {
	packets,
	questions,
	regressions,
	unseenQuestions,
	type SourceQuestion,
} from "../../examples/applicability-order-comparison/fixtures.ts";
import {
	arms,
	instructions,
	presentation,
	schemaFor,
	order,
	design,
} from "../../examples/applicability-order-comparison/protocol.ts";
import {
	assess,
	summarize,
	type Cell,
} from "../../examples/applicability-order-comparison/results.ts";
import { adoption } from "../../examples/applicability-order-comparison/adoption.ts";
import saved from "../../examples/applicability-order-comparison/regressions.json";
import { instructions as prior } from "../../examples/operative-sources-comparison/protocol.ts";
test("observed temporal-selection and citation-coverage failures reproduce without weakening the audit", () => {
	expect(saved.observedFailures).toHaveLength(5);
	for (const f of saved.observedFailures) {
		const c = regressions.find((c) => c.question.id === f.questionId)!;
		const s = assess(c.question, c.context, "baseline", f.raw);
		expect(s.primaryCorrect).toBe(false);
		if (f.questionId === "PC01") {
			expect(s.decisionCorrect).toBe(false);
			expect(s.grounding!.passed).toBe(true);
			expect(
				c.context.derivedView!.evaluations.find(
					(e) => e.assertionId === "PC4:claim:0",
				)!.reasons,
			).toContain("CLAIM_NOT_VALID");
		}
		if (f.questionId === "CV04") {
			expect(s.assessmentsCorrect).toBe(true);
			expect(s.grounding!.issues).toContain("uncited_assessment:CV2");
		}
	}
});
test("v5 and prior instructions remain exact; candidate only reorders existing schema fields and does not filter evidence", () => {
	expect(instructions.baseline).toBe(prior.baseline);
	expect(instructions.operative).toBe(prior.operative);
	for (const { question, context } of regressions) {
		const base = schemaFor(context, "baseline"),
			candidate = schemaFor(context, "applicability");
		expect(schemaFor(context, "operative")).toEqual(base);
		expect(candidate.properties).toEqual(base.properties);
		expect([...candidate.required].sort()).toEqual([...base.required].sort());
		expect(Object.keys(candidate.properties)).toEqual([
			"assessments",
			"governingSources",
			"explanation",
			"decision",
		]);
		expect(candidate.properties.governingSources.items.enum).toEqual(
			context.sources.map((s) => s.id),
		);
		const altered: SourceQuestion = {
			...question,
			expected: { decision: "hold", governingSources: [], reason: "HIDDEN" },
			expectedAssessments: {},
			retiredOnlySources: ["HIDDEN"],
			suite: "unseen",
			category: "HIDDEN",
		};
		expect(presentation(altered, context)).toBe(
			presentation(question, context),
		);
	}
});
test("new temporal and mixed-provision cases use balanced schedules and complete planned denominators", () => {
	expect(packets).toHaveLength(4);
	expect(packets.flatMap((p) => p.documents)).toHaveLength(14);
	expect(unseenQuestions).toHaveLength(16);
	expect(regressions).toHaveLength(8);
	expect(new Set(questions.map((q) => q.id)).size).toBe(24);
	expect(design.plannedAnswers).toBe(questions.length * 2 * 3);
	const counts = new Map<string, number>();
	for (let i = 0; i < questions.length; i++)
		for (let repeat = 0; repeat < 2; repeat++) {
			const sequence = order(i, repeat);
			expect([...sequence].sort()).toEqual([...arms].sort());
			const key = sequence.join();
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	expect(counts.size).toBe(6);
	expect([...counts.values()]).toEqual([8, 8, 8, 8, 8, 8]);
	for (const q of unseenQuestions) {
		expect(
			q.retiredOnlySources.every(
				(id) => !q.expected.governingSources.includes(id),
			),
		).toBe(true);
		expect(
			Object.keys(q.expectedAssessments).every((id) =>
				q.expected.governingSources.includes(id),
			),
		).toBe(true);
	}
	const byId = (id: string) => questions.find((q) => q.id === id)!;
	expect(byId("OH02").asOf - byId("OH01").asOf).toBe(1);
	expect(byId("OH04").asOf - byId("OH03").asOf).toBe(1);
	expect(byId("CB02").asOf - byId("CB01").asOf).toBe(1);
	expect(byId("RV03").expected.governingSources).toContain("RV6");
	expect(byId("CC03").expected.governingSources).not.toContain("CC5");
	for (const a of arms)
		expect(summarize([], questions).all.byArm[a]!.planned).toBe(48);
});
function perfect(): Cell[] {
	return questions.flatMap((q) =>
		[0, 1].flatMap((repeat) =>
			arms.map((arm) => ({
				questionId: q.id,
				packet: q.packet,
				suite: q.suite,
				repeat,
				arm,
				status: "answered" as const,
				inputTokens: 0,
				outputTokens: 0,
				latencyMs: 0,
				score: {
					decisionCorrect: true,
					governingSourcesCorrect: true,
					jointCorrect: true,
					falseAllow: false,
					assessmentsCorrect: true,
					primaryCorrect: true,
					retiredSourceLeak: false,
					grounding: {
						passed: true,
						issues: [],
						comparedCalculations: 1,
						calculationMismatches: 0,
						decisionConsistent: true,
						overrides: [],
					},
				},
			})),
		),
	);
}
test("retention requires current comparative improvement; preferred status also needs unseen v5 superiority", () => {
	expect(adoption([]).retained).toBe(false);
	const cells = perfect();
	expect(adoption(cells).retained).toBe(false);
	cells.find(
		(c) => c.questionId === "PC01" && c.arm === "operative",
	)!.score!.primaryCorrect = false;
	expect(adoption(cells).retained).toBe(true);
	expect(adoption(cells).preferred).toBe(false);
	cells.find(
		(c) => c.questionId === "OH01" && c.arm === "baseline",
	)!.score!.primaryCorrect = false;
	expect(adoption(cells).preferred).toBe(true);
	expect(adoption(cells.slice(1)).retained).toBe(false);
	cells.find(
		(c) => c.questionId === "CV04" && c.arm === "applicability",
	)!.score!.primaryCorrect = false;
	expect(adoption(cells).conditions.controlsCorrect).toBe(false);
	expect(adoption(cells).retained).toBe(false);
});
