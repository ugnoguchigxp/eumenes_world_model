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
} from "../../examples/operative-sources-holdout/fixtures.ts";
import {
	instructions,
	presentation,
	schemaFor,
} from "../../examples/operative-sources-holdout/protocol.ts";
import {
	assess,
	summarize,
	type Cell,
} from "../../examples/operative-sources-comparison/results.ts";
import { adoption } from "../../examples/operative-sources-holdout/adoption.ts";
const saved = JSON.parse(
	readExperimentEvidence(
		new URL(
			"../../fixtures/experiments/operative-sources-holdout/2026-10-16.json.gz",
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
	report: { cells: Cell[]; summary: ReturnType<typeof summarize> };
	adoption: ReturnType<typeof adoption>;
};
function measured(id: string, repeat: number, arm: "baseline" | "operative") {
	return saved.report.cells.find(
		(c) => c.questionId === id && c.repeat === repeat && c.arm === arm,
	)!;
}
test("all fresh source extractions rebuild identical SQLite contexts and exact permission calculations", () => {
	expect(saved.protocol.packets).toEqual(packets);
	expect(saved.protocol.questions).toEqual(questions);
	expect(saved.protocol.instructions).toEqual(instructions);
	for (const packet of packets) {
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
test("all 128 first responses reproduce request digests, scores, paired totals and preregistered rejection without model calls", () => {
	for (const cell of saved.report.cells) {
		const { question, context } = saved.contexts.find(
			(c) => c.question.id === cell.questionId,
		)!;
		const response =
			saved.responses[`answer-${cell.questionId}-${cell.repeat}-${cell.arm}`]!;
		expect(
			hash(
				Buffer.from(
					JSON.stringify({
						prompt: presentation(question, context),
						schema: schemaFor(context, cell.arm),
					}),
				),
			),
		).toBe(response.requestDigest);
		expect(assess(question, context, cell.arm, response.raw)).toEqual(
			cell.score!,
		);
		expect(Object.keys(JSON.parse(response.raw)).at(-1)).toBe("decision");
	}
	expect(summarize(saved.report.cells, questions)).toEqual(
		saved.report.summary,
	);
	expect(adoption(saved.report.cells)).toEqual(saved.adoption);
	expect(saved.adoption.adopted).toBe(false);
	expect(saved.report.summary.unseen.pairs).toEqual({
		better: 1,
		worse: 2,
		bothCorrect: 45,
		bothWrong: 0,
		unanswered: 0,
	});
});
test("unseen improvement does not hide future-rule application and dropped operative permission source", () => {
	const improvement = measured("AR03", 0, "baseline").score!;
	expect(improvement.retiredSourceLeak).toBe(true);
	expect(improvement.assessmentsCorrect).toBe(false);
	expect(measured("AR03", 0, "operative").score!.primaryCorrect).toBe(true);
	const future = measured("PC01", 0, "operative").score!;
	expect(future.answer!.decision).toBe("deny");
	expect(future.decisionCorrect).toBe(false);
	expect(future.grounding!.passed).toBe(true);
	expect(measured("PC01", 0, "baseline").score!.primaryCorrect).toBe(true);
	const context = saved.contexts.find((c) => c.question.id === "PC01")!.context;
	expect(
		context.derivedView!.evaluations.find(
			(e) => e.assertionId === "PC4:claim:0",
		)!.reasons,
	).toContain("CLAIM_NOT_VALID");
	const missing = measured("CV04", 1, "operative").score!;
	expect(missing.answer!.governingSources).toEqual(["CV5"]);
	expect(missing.assessmentsCorrect).toBe(true);
	expect(missing.grounding!.passed).toBe(false);
	expect(measured("CV04", 1, "baseline").score!.primaryCorrect).toBe(true);
	expect(saved.adoption.conditions.preservationControlsCorrect).toBe(false);
});
