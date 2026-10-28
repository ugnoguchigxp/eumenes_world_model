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
	regressions,
	type SourceQuestion,
} from "../../examples/audit-repair-comparison/fixtures.ts";
import {
	instructions,
	presentation,
	schemaFor,
} from "../../examples/audit-repair-comparison/protocol.ts";
import {
	review,
	reviewPrompt,
	type Response,
} from "../../examples/audit-repair-comparison/review.ts";
import {
	assess,
	summarize,
	type Cell,
} from "../../examples/audit-repair-comparison/results.ts";
import { adoption } from "../../examples/audit-repair-comparison/adoption.ts";
const saved = JSON.parse(
	readExperimentEvidence(
		new URL(
			"../../fixtures/experiments/audit-repair-comparison/2026-10-16.json.gz",
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
	responses: Record<
		string,
		{
			raw: string;
			usage: { input_tokens: number; output_tokens: number };
			latencyMs: number;
			requestDigest: string;
		}
	>;
	report: { cells: Cell[]; summary: ReturnType<typeof summarize> };
	adoption: ReturnType<typeof adoption>;
};
function cached(key: string): Response {
	const r = saved.responses[key]!;
	return {
		raw: r.raw,
		inputTokens: r.usage.input_tokens,
		outputTokens: r.usage.output_tokens,
		latencyMs: r.latencyMs,
	};
}
test("three new extractions rebuild SQLite inputs; self-withdrawal rejection preserves all 24 failed endpoints", () => {
	expect(saved.protocol.packets).toEqual(packets);
	expect(saved.protocol.questions).toEqual(questions);
	expect(saved.protocol.instructions).toEqual(instructions);
	for (const p of packets) {
		const raw = saved.responses[`extract-${p.id}`]!.raw;
		if (p.id === "canopy-motor") {
			expect(() => interpret(p, raw)).toThrow("invalid_withdrawal_target");
			const failed = saved.report.cells.filter((c) => c.packet === p.id);
			expect(failed).toHaveLength(24);
			expect(failed.every((c) => c.status === "failed" && !c.score)).toBe(true);
			continue;
		}
		const material = interpret(p, raw);
		for (const q of questions.filter((q) => q.packet === p.id)) {
			const store = openTestStore();
			try {
				store.write((db) => persist(db, material, q.asOf));
				const context = store.read((db) => contexts(db, material, q).world);
				expect(context).toEqual(
					saved.contexts.find((c) => c.question.id === q.id)!.context,
				);
				expect(context.sources.map((s) => s.id)).toEqual(
					p.documents.map((d) => d.id),
				);
				for (const [id, x] of Object.entries(q.expectedAssessments)) {
					const u = context.derivedView.slice.units.find((u) =>
						u.sources.some((s) => s.id === id),
					)!;
					expect(
						context.derivedView.evaluations.find(
							(e) => e.assertionId === u.assertionId,
						)!.result,
					).toBe(x);
				}
			} finally {
				store.close();
			}
		}
	}
});
test("all shared-first-answer branches replay without model calls and reproduce requests, costs, audits and scores", async () => {
	const calls: string[] = [];
	for (const cell of saved.report.cells) {
		if (cell.status === "failed") continue;
		const { question, context } = saved.contexts.find(
			(c) => c.question.id === cell.questionId,
		)!;
		const seed = regressions.find((r) => r.question.id === cell.questionId);
		const initial = seed
			? { raw: seed.seedRaw, inputTokens: 0, outputTokens: 0, latencyMs: 0 }
			: cached(`initial-${cell.questionId}-${cell.repeat}`);
		if (!seed)
			expect(
				hash(
					Buffer.from(
						JSON.stringify({
							prompt: presentation(question, context),
							schema: schemaFor(context),
						}),
					),
				),
			).toBe(
				saved.responses[`initial-${cell.questionId}-${cell.repeat}`]!
					.requestDigest,
			);
		const output = await review(
			question,
			context,
			initial,
			cell.arm,
			async (prompt, schema) => {
				const key = `repair-${cell.questionId}-${cell.repeat}-${cell.arm}`;
				calls.push(key);
				expect(hash(Buffer.from(JSON.stringify({ prompt, schema })))).toBe(
					saved.responses[key]!.requestDigest,
				);
				return cached(key);
			},
		);
		const { raw, inputTokens, outputTokens, latencyMs, ...details } = output;
		expect(raw).toBe(cell.raw!);
		expect(details).toEqual(cell.review!);
		expect({ inputTokens, outputTokens, latencyMs }).toEqual({
			inputTokens: cell.inputTokens,
			outputTokens: cell.outputTokens,
			latencyMs: cell.latencyMs,
		});
		expect(assess(question, context, cell.arm, raw)).toEqual(cell.score!);
	}
	expect(calls).toHaveLength(24);
	expect(new Set(calls).size).toBe(24);
	expect(Object.keys(saved.responses)).toHaveLength(52);
	expect(summarize(saved.report.cells, questions)).toEqual(
		saved.report.summary,
	);
	expect(adoption(saved.report.cells)).toEqual(saved.adoption);
	expect(saved.adoption.retained).toBe(false);
	expect(saved.adoption.preferred).toBe(false);
});
test("known repairs improve equally with and without feedback while unseen ceiling and audit blind spot remain explicit", () => {
	for (const r of regressions)
		for (const repeat of [0, 1]) {
			const rows = saved.report.cells.filter(
				(c) => c.questionId === r.question.id && c.repeat === repeat,
			);
			if (r.expectedTrigger) {
				expect(
					rows.find((c) => c.arm === "baseline")!.score!.primaryCorrect,
				).toBe(false);
				for (const arm of ["control", "audit"] as const) {
					expect(rows.find((c) => c.arm === arm)!.score!.primaryCorrect).toBe(
						true,
					);
					expect(rows.find((c) => c.arm === arm)!.review!.repairAttempted).toBe(
						true,
					);
				}
				const { structuralAudit, ...auditInput } = JSON.parse(
					reviewPrompt(r.question, r.context, r.seedRaw, "audit"),
				);
				expect(structuralAudit.passed).toBe(false);
				expect(auditInput).toEqual(
					JSON.parse(reviewPrompt(r.question, r.context, r.seedRaw, "control")),
				);
			} else
				for (const row of rows) {
					expect(row.raw).toBe(r.seedRaw);
					expect(row.review!.repairAttempted).toBe(false);
				}
		}
	const blind = saved.report.cells.filter((c) => c.questionId === "KR07");
	expect(blind).toHaveLength(6);
	expect(
		blind.every((c) => c.review!.accepted && !c.score!.primaryCorrect),
	).toBe(true);
	const unseen = saved.report.cells.filter(
		(c) => c.suite === "unseen" && c.status === "answered",
	);
	expect(unseen).toHaveLength(72);
	expect(
		unseen.every((c) => c.score!.primaryCorrect && !c.review!.repairAttempted),
	).toBe(true);
	expect(saved.report.summary.regression.pairs.versusBaseline.better).toBe(12);
	expect(saved.report.summary.unseen.pairs.versusBaseline.better).toBe(0);
	expect(saved.report.summary.all.pairs.versusControl.better).toBe(0);
});
