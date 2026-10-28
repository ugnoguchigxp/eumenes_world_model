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
} from "../../examples/applicability-order-comparison/fixtures.ts";
import {
	arms,
	type Arm,
	instructions,
	presentation,
	schemaFor,
} from "../../examples/applicability-order-comparison/protocol.ts";
import {
	assess,
	summarize,
	type Cell,
} from "../../examples/applicability-order-comparison/results.ts";
import { adoption } from "../../examples/applicability-order-comparison/adoption.ts";
const saved = JSON.parse(
	readExperimentEvidence(
		new URL(
			"../../fixtures/experiments/applicability-order-comparison/2026-10-16.json.gz",
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
function measured(id: string, repeat: number, arm: Arm) {
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
test("all 144 first responses reproduce request digests, scores, paired totals and preregistered candidate retention without model calls", () => {
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
	expect(saved.adoption.retained).toBe(true);
	expect(saved.adoption.preferred).toBe(true);
	expect(saved.report.cells).toHaveLength(144);
	expect(saved.report.summary.unseen.pairs.versusBaseline).toEqual({
		better: 1,
		worse: 0,
		bothCorrect: 31,
		bothWrong: 0,
		unanswered: 0,
	});
	expect(saved.report.summary.all.pairs.versusOperative).toEqual({
		better: 0,
		worse: 0,
		bothCorrect: 48,
		bothWrong: 0,
		unanswered: 0,
	});
});
test("one historical-source improvement does not imply fresh superiority on the two targeted failures", () => {
	for (const id of ["PC01", "CV04"])
		for (const repeat of [0, 1])
			for (const arm of arms)
				expect(measured(id, repeat, arm).score!.primaryCorrect).toBe(true);
	const baseline = measured("CC02", 1, "baseline").score!;
	expect(baseline.primaryCorrect).toBe(false);
	expect(baseline.decisionCorrect).toBe(true);
	expect(baseline.assessmentsCorrect).toBe(true);
	expect(baseline.grounding!.passed).toBe(true);
	expect(baseline.retiredSourceLeak).toBe(false);
	expect(baseline.answer!.governingSources).toContain("CC4");
	for (const arm of ["operative", "applicability"] as const) {
		const score = measured("CC02", 1, arm).score!;
		expect(score.primaryCorrect).toBe(true);
		expect([...score.answer!.governingSources].sort()).toEqual(["CC2", "CC9"]);
	}
	for (const cell of saved.report.cells) {
		const raw =
			saved.responses[`answer-${cell.questionId}-${cell.repeat}-${cell.arm}`]!
				.raw;
		expect(Object.keys(JSON.parse(raw))).toEqual(
			cell.arm === "applicability"
				? ["assessments", "governingSources", "explanation", "decision"]
				: ["governingSources", "assessments", "explanation", "decision"],
		);
	}
});
