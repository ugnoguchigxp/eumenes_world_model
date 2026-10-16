import { expect, test } from "bun:test";
import type { SourceQuestion } from "../../examples/operative-sources-holdout/fixtures.ts";
import {
	packets,
	questions,
	unseenQuestions,
	preservationControls,
} from "../../examples/operative-sources-holdout/fixtures.ts";
import {
	instructions,
	presentation,
	design,
} from "../../examples/operative-sources-holdout/protocol.ts";
import { instructions as original } from "../../examples/operative-sources-comparison/protocol.ts";
import { regressions } from "../../examples/operative-sources-comparison/fixtures.ts";
import {
	summarize,
	type Cell,
} from "../../examples/operative-sources-comparison/results.ts";
import { adoption } from "../../examples/operative-sources-holdout/adoption.ts";
test("expanded sources are new; unchanged instructions and presentation hide scoring annotations", () => {
	expect(instructions).toBe(original);
	expect(packets).toHaveLength(6);
	expect(packets.flatMap((p) => p.documents)).toHaveLength(19);
	expect(unseenQuestions).toHaveLength(24);
	expect(
		unseenQuestions.filter((q) => q.category.endsWith("/history")),
	).toHaveLength(12);
	expect(new Set(questions.map((q) => q.id)).size).toBe(32);
	expect(design.plannedAnswers).toBe(questions.length * 4);
	for (const q of unseenQuestions) {
		const ids = packets
			.find((p) => p.id === q.packet)!
			.documents.map((d) => d.id);
		expect(q.expected.governingSources.every((id) => ids.includes(id))).toBe(
			true,
		);
		expect(
			Object.keys(q.expectedAssessments).every((id) =>
				q.expected.governingSources.includes(id),
			),
		).toBe(true);
		expect(
			q.retiredOnlySources.every(
				(id) => ids.includes(id) && !q.expected.governingSources.includes(id),
			),
		).toBe(true);
		const context = regressions[0]!.context;
		const altered: SourceQuestion = {
			...q,
			category: "HIDDEN",
			suite: "regression",
			expectedAssessments: {},
			retiredOnlySources: ["HIDDEN"],
			expected: { decision: "hold", governingSources: [], reason: "HIDDEN" },
		};
		expect(presentation(q, context)).toBe(presentation(altered, context));
	}
	expect(preservationControls).toHaveLength(13);
	for (const id of ["CV01", "CV02", "CV03", "CV04"]) {
		const q = questions.find((q) => q.id === id)!;
		expect(q.expected.governingSources).toContain("CV5");
		expect(q.expectedAssessments).not.toHaveProperty("CV5");
	}
});
const successful = (): Cell[] =>
	questions.flatMap((q) =>
		[0, 1].flatMap((repeat) =>
			(["baseline", "operative"] as const).map((arm) => ({
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
test("adoption rejects ceiling ties, single-packet gains, missing calls and damaged old-policy controls", () => {
	expect(summarize([], questions).unseen.byArm.baseline!.planned).toBe(48);
	expect(adoption([]).adopted).toBe(false);
	const cells = successful();
	expect(adoption(cells).adopted).toBe(false);
	for (const c of cells.filter(
		(c) => c.arm === "baseline" && c.questionId === "AR01",
	))
		c.score!.primaryCorrect = false;
	expect(adoption(cells).adopted).toBe(false);
	for (const c of cells.filter(
		(c) => c.arm === "baseline" && c.questionId === "BB01",
	))
		c.score!.primaryCorrect = false;
	expect(adoption(cells).adopted).toBe(true);
	expect(adoption(cells.slice(1)).adopted).toBe(false);
	cells.find(
		(c) => c.arm === "operative" && c.questionId === "CV01",
	)!.score!.primaryCorrect = false;
	expect(adoption(cells).conditions.preservationControlsCorrect).toBe(false);
	expect(adoption(cells).adopted).toBe(false);
});
