import { expect, test } from "bun:test";
import { readExperimentEvidence } from "../support/experiment-evidence.ts";
import { hash } from "../../eval/seed/corpus.ts";
import { openTestStore } from "../support/sqlite-store.ts";
import {
	interpret,
	persist,
	contexts,
} from "../../examples/multi-source-comparison/world.ts";
import {
	packets,
	questions,
	type SourceQuestion,
} from "../../examples/instruction-order-factorial/fixtures.ts";
import {
	arms,
	type Arm,
	instructions,
	presentation,
	schemaFor,
} from "../../examples/instruction-order-factorial/protocol.ts";
import {
	assess,
	summarize,
	type Cell,
} from "../../examples/instruction-order-factorial/results.ts";
import { adoption } from "../../examples/instruction-order-factorial/adoption.ts";
const saved = JSON.parse(
	readExperimentEvidence(
		new URL(
			"../../fixtures/experiments/instruction-order-factorial/2026-10-16.json.gz",
			import.meta.url,
		),
		"utf8",
	),
) as {
	protocol: {
		packets: typeof packets;
		questions: SourceQuestion[];
		instructions: typeof instructions;
	};
	contexts: {
		question: SourceQuestion;
		context: ReturnType<typeof contexts>["world"];
	}[];
	responses: Record<string, { raw: string; requestDigest: string }>;
	callFailures: Record<string, { error: string; requestDigest: string }>;
	report: { cells: Cell[]; summary: ReturnType<typeof summarize> };
	adoption: ReturnType<typeof adoption>;
};
function measured(id: string, repeat: number, arm: Arm) {
	return saved.report.cells.find(
		(c) => c.questionId === id && c.repeat === repeat && c.arm === arm,
	)!;
}
test("three accepted extractions rebuild identical contexts; rejected self-withdrawal keeps all affected cells failed", () => {
	expect(saved.protocol.packets).toEqual(packets);
	expect(saved.protocol.questions).toEqual(questions);
	expect(saved.protocol.instructions).toEqual(instructions);
	for (const packet of packets) {
		if (packet.id === "cargo-lift") {
			expect(() =>
				interpret(packet, saved.responses[`extract-${packet.id}`]!.raw),
			).toThrow("invalid_withdrawal_target");
			const failed = saved.report.cells.filter((c) => c.packet === packet.id);
			expect(failed).toHaveLength(32);
			expect(failed.every((c) => c.status === "failed" && !c.score)).toBe(true);
			continue;
		}
		const material = interpret(
			packet,
			saved.responses[`extract-${packet.id}`]!.raw,
		);
		for (const q of questions.filter((q) => q.packet === packet.id)) {
			const store = openTestStore();
			try {
				store.write((db) => persist(db, material, q.asOf));
				const context = store.read((db) => contexts(db, material, q).world);
				expect(context).toEqual(
					saved.contexts.find((c) => c.question.id === q.id)!.context,
				);
				expect(context.sources.map((s) => s.id)).toEqual(
					packet.documents.map((d) => d.id),
				);
				for (const [id, expected] of Object.entries(q.expectedAssessments)) {
					const unit = context.derivedView.slice.units.find((u) =>
						u.sources.some((s) => s.id === id),
					)!;
					expect(
						context.derivedView.evaluations.find(
							(e) => e.assertionId === unit.assertionId,
						)!.result,
					).toBe(expected);
				}
			} finally {
				store.close();
			}
		}
	}
});
test("all first results and failures reproduce scores, request digests, denominators and non-adoption", () => {
	for (const cell of saved.report.cells) {
		const prepared = saved.contexts.find(
			(c) => c.question.id === cell.questionId,
		);
		if (!prepared) {
			expect(cell.status).toBe("failed");
			continue;
		}
		const { question, context } = prepared;
		const key = `answer-${cell.questionId}-${cell.repeat}-${cell.arm}`;
		const response = saved.responses[key];
		const result = response ?? saved.callFailures[key]!;
		expect(
			hash(
				Buffer.from(
					JSON.stringify({
						prompt: presentation(question, context),
						schema: schemaFor(context, cell.arm),
					}),
				),
			),
		).toBe(result.requestDigest);
		if (response) {
			expect(assess(question, context, cell.arm, response.raw)).toEqual(
				cell.score!,
			);
			const keys = Object.keys(JSON.parse(response.raw));
			expect(keys).toEqual(
				cell.arm === "order" || cell.arm === "combined"
					? ["assessments", "governingSources", "explanation", "decision"]
					: ["governingSources", "assessments", "explanation", "decision"],
			);
		} else {
			expect(cell.status).toBe("failed");
			expect(result).toHaveProperty("error");
		}
	}
	expect(saved.report.cells).toHaveLength(192);
	expect(Object.keys(saved.responses)).toHaveLength(162);
	expect(Object.keys(saved.callFailures)).toHaveLength(2);
	expect(summarize(saved.report.cells, questions)).toEqual(
		saved.report.summary,
	);
	expect(adoption(saved.report.cells)).toEqual(saved.adoption);
	for (const arm of ["instruction", "order", "combined"]) {
		expect(saved.adoption.candidates[arm]!.retained).toBe(false);
		expect(saved.adoption.candidates[arm]!.conditions.complete).toBe(false);
	}
});
test("conditional effects preserve contrasting failures instead of declaring a single causal winner", () => {
	const s = saved.report.summary.unseen;
	expect(arms.map((a) => s.byArm[a]!.primaryCorrect)).toEqual([20, 22, 23, 23]);
	expect(arms.map((a) => s.byArm[a]!.planned)).toEqual([32, 32, 32, 32]);
	expect(arms.map((a) => s.byArm[a]!.answered)).toEqual([24, 24, 24, 24]);
	expect(s.contrasts.instructionAtOriginalOrder.better).toBe(2);
	expect(s.contrasts.instructionAtOriginalOrder.worse).toBe(0);
	expect(s.contrasts.instructionAtRevisedOrder.better).toBe(1);
	expect(s.contrasts.instructionAtRevisedOrder.worse).toBe(1);
	expect(s.effects).toEqual({
		instructionRateDifference: 1 / 32,
		orderRateDifference: 2 / 32,
		interactionRateDifference: -2 / 32,
	});
	expect(saved.adoption.attribution.instruction.descriptiveSupport).toBe(false);
	expect(saved.adoption.attribution.order.descriptiveSupport).toBe(false);
	const future = measured("NP01", 0, "order").score!;
	expect(future.decisionCorrect).toBe(false);
	expect(future.grounding!.passed).toBe(true);
	expect(measured("NP01", 0, "instruction").score!.primaryCorrect).toBe(true);
	const missing = measured("NP01", 1, "instruction").score!;
	expect(missing.decisionCorrect).toBe(true);
	expect(missing.governingSourcesCorrect).toBe(false);
	expect(missing.grounding!.passed).toBe(false);
	const combined = measured("SD01", 1, "combined").score!;
	expect(combined.decisionCorrect).toBe(true);
	expect(combined.assessmentsCorrect).toBe(false);
	expect(combined.grounding!.passed).toBe(false);
	expect(measured("SD01", 1, "order").score!.primaryCorrect).toBe(true);
});
