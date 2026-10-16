import { expect, test } from "bun:test";
import {
	arms,
	factors,
	instructions,
	originalRecord,
	orderedRecord,
	schemaFor,
	presentation,
	order,
	design,
} from "../../examples/instruction-order-factorial/protocol.ts";
import { answerInstructions } from "../../examples/multi-source-comparison/protocol.ts";
import {
	packets,
	questions,
	regressions,
	unseenQuestions,
} from "../../examples/instruction-order-factorial/fixtures.ts";
import {
	assess,
	summarize,
	type Cell,
} from "../../examples/instruction-order-factorial/results.ts";
import { adoption } from "../../examples/instruction-order-factorial/adoption.ts";
import failures from "../../examples/instruction-order-factorial/regressions.json";
test("factorial interventions isolate semantic instructions from serialized order, with exact v5", () => {
	expect(instructions.baseline).toBe(answerInstructions);
	expect(instructions.order).toBe(
		instructions.baseline.replace(originalRecord, orderedRecord),
	);
	expect(instructions.combined).toBe(
		instructions.instruction.replace(originalRecord, orderedRecord),
	);
	expect(instructions.instruction.includes("After writing assessments")).toBe(
		false,
	);
	for (const { question, context } of regressions) {
		const original = schemaFor(context, "baseline");
		expect(schemaFor(context, "instruction")).toEqual(original);
		expect(schemaFor(context, "order")).toEqual(schemaFor(context, "combined"));
		for (const arm of arms) {
			const schema = schemaFor(context, arm);
			expect(schema.properties).toEqual(original.properties);
			expect([...schema.required].sort()).toEqual(
				[...original.required].sort(),
			);
			expect(Object.keys(schema.properties)[0]).toBe(
				factors[arm].order ? "assessments" : "governingSources",
			);
			expect(schema.properties.governingSources.items.enum).toEqual(
				context.sources.map((s) => s.id),
			);
		}
		const altered: typeof question = {
			...question,
			expected: { decision: "hold", governingSources: [], reason: "HIDDEN" },
			expectedAssessments: {},
			retiredOnlySources: ["HIDDEN"],
		};
		expect(presentation(altered, context)).toBe(
			presentation(question, context),
		);
	}
});
test("both cohorts balance arm positions and every ordered adjacent pair, with new fixed denominators", () => {
	expect(packets).toHaveLength(4);
	expect(packets.flatMap((p) => p.documents)).toHaveLength(16);
	expect(unseenQuestions).toHaveLength(16);
	expect(regressions).toHaveLength(8);
	expect(new Set(questions.map((q) => q.id)).size).toBe(24);
	expect(design.plannedAnswers).toBe(192);
	for (const start of [0, 8]) {
		const size = start === 0 ? 8 : 16;
		const positions = Object.fromEntries(arms.map((a) => [a, [0, 0, 0, 0]]));
		const adjacent = new Map<string, number>();
		for (let i = start; i < start + size; i++)
			for (let repeat = 0; repeat < 2; repeat++) {
				const seq = order(i, repeat);
				expect([...seq].sort()).toEqual([...arms].sort());
				seq.forEach((a, j) => (positions[a]![j] = positions[a]![j]! + 1));
				for (let j = 1; j < seq.length; j++) {
					const key = `${seq[j - 1]}:${seq[j]}`;
					adjacent.set(key, (adjacent.get(key) ?? 0) + 1);
				}
			}
		for (const a of arms)
			expect(positions[a]).toEqual([size / 2, size / 2, size / 2, size / 2]);
		expect(adjacent.size).toBe(12);
		expect([...adjacent.values()].every((n) => n === size / 2)).toBe(true);
	}
	for (const q of unseenQuestions) {
		expect(
			Object.keys(q.expectedAssessments).every((id) =>
				q.expected.governingSources.includes(id),
			),
		).toBe(true);
		expect(
			q.retiredOnlySources.some((id) =>
				q.expected.governingSources.includes(id),
			),
		).toBe(false);
	}
	for (const arm of arms)
		expect(summarize([], questions).all.byArm[arm]!.planned).toBe(48);
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
				},
			})),
		),
	);
}
test("factor effects and retention distinguish ceiling, one-packet gains and interactions without changing scores", () => {
	const cells = perfect();
	expect(adoption(cells).candidates.combined!.retained).toBe(false);
	expect(adoption(cells).attribution.instruction.descriptiveSupport).toBe(
		false,
	);
	const fail = (id: string, arm: Cell["arm"]) => {
		cells.find(
			(c) => c.questionId === id && c.repeat === 0 && c.arm === arm,
		)!.score!.primaryCorrect = false;
	};
	fail("NP01", "baseline");
	expect(adoption(cells).candidates.combined!.retained).toBe(false);
	fail("MV02", "baseline");
	expect(adoption(cells).candidates.combined!.retained).toBe(true);
	expect(adoption(cells).attribution.instruction.descriptiveSupport).toBe(true);
	const s = summarize(cells, questions).unseen;
	expect(s.effects.instructionRateDifference).toBe(2 / 64);
	expect(s.effects.orderRateDifference).toBe(2 / 64);
	expect(s.effects.interactionRateDifference).toBe(-2 / 32);
	fail("SD03", "combined");
	expect(adoption(cells).attribution.instruction.descriptiveSupport).toBe(
		false,
	);
	expect(adoption(cells.slice(1)).candidates.combined!.retained).toBe(false);
});
test("saved temporal, missing-source and historical-source failures remain failures under unchanged scoring", () => {
	expect(failures.observedFailures).toHaveLength(6);
	for (const f of failures.observedFailures) {
		const c = regressions.find((c) => c.question.id === f.questionId)!;
		for (const arm of arms)
			expect(assess(c.question, c.context, arm, f.raw).primaryCorrect).toBe(
				false,
			);
	}
});
