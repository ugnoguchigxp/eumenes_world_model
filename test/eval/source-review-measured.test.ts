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
} from "../../examples/source-review-comparison/fixtures.ts";
import {
	instructions,
	presentation,
	schemaFor,
} from "../../examples/source-review-comparison/protocol.ts";
import {
	review,
	type Response,
} from "../../examples/source-review-comparison/review.ts";
import {
	assess,
	summarize,
	type Cell,
} from "../../examples/source-review-comparison/results.ts";
import { adoption } from "../../examples/source-review-comparison/adoption.ts";
const saved = JSON.parse(
	readExperimentEvidence(
		new URL(
			"../../fixtures/experiments/source-review-comparison/2026-10-16.json.gz",
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
test("fresh extractions rebuild all available SQLite contexts and preserve failed denominators", () => {
	expect(saved.protocol.packets).toEqual(packets);
	expect(saved.protocol.questions).toEqual(questions);
	expect(saved.protocol.instructions).toEqual(instructions);
	for (const p of packets) {
		const raw = saved.responses[`extract-${p.id}`]!.raw;
		if (p.id === "cistern-valve") {
			expect(() => interpret(p, raw)).toThrow(
				"extraction_not_one_valid_candidate:RV8",
			);
			const failed = saved.report.cells.filter((c) => c.packet === p.id);
			expect(failed).toHaveLength(24);
			expect(failed.every((c) => c.status === "failed" && !c.score)).toBe(true);
			continue;
		}
		const material = interpret(p, raw);
		for (const q of questions.filter(
			(q) => q.suite === "unseen" && q.packet === p.id,
		)) {
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
	expect(calls).toHaveLength(56);
	expect(new Set(calls).size).toBe(56);
	expect(Object.keys(saved.responses)).toHaveLength(84);
	expect(summarize(saved.report.cells, questions)).toEqual(
		saved.report.summary,
	);
	expect(adoption(saved.report.cells)).toEqual(saved.adoption);
});
test("both reviews repair the known miss, but unseen coherent error survives and focused review loses to control", () => {
	expect(saved.report.cells).toHaveLength(108);
	expect(
		new Set(
			saved.report.cells.map((c) => `${c.questionId}:${c.repeat}:${c.arm}`),
		).size,
	).toBe(108);
	const rows = (id: string, repeat: number) =>
		saved.report.cells.filter(
			(c) => c.questionId === id && c.repeat === repeat,
		);
	for (const repeat of [0, 1]) {
		const known = rows("KR07", repeat);
		expect(known.find((c) => c.arm === "baseline")!.score!.primaryCorrect).toBe(
			false,
		);
		for (const c of known.filter((c) => c.arm !== "baseline"))
			expect(c.score!.primaryCorrect).toBe(true);
		expect(rows("KR08", repeat).every((c) => c.score!.primaryCorrect)).toBe(
			true,
		);
	}
	const missed = rows("TC01", 0);
	expect(
		missed.every((c) => c.review!.accepted && !c.score!.primaryCorrect),
	).toBe(true);
	const context = saved.contexts.find((c) => c.question.id === "TC01")!.context;
	expect(
		context.derivedView.evaluations.find(
			(e) => e.assertionId === "TC2:claim:0",
		)!.reasons,
	).toContain("CLAIM_NOT_VALID");
	const extra = rows("KC01", 0);
	expect(extra.find((c) => c.arm === "control")!.score!.primaryCorrect).toBe(
		true,
	);
	expect(extra.find((c) => c.arm === "selection")!.review!.accepted).toBe(
		false,
	);
	expect(
		extra.find((c) => c.arm === "selection")!.score!.grounding!.issues,
	).toContain("decision_assessment_mismatch");
	const s = saved.report.summary.unseen;
	expect(s.byArm.baseline!.primaryCorrect).toBe(18);
	expect(s.byArm.control!.primaryCorrect).toBe(23);
	expect(s.byArm.selection!.primaryCorrect).toBe(22);
	expect(s.pairs.controlVersusBaseline).toEqual({
		better: 5,
		worse: 0,
		bothCorrect: 18,
		bothWrong: 1,
		unanswered: 8,
	});
	expect(s.pairs.versusBaseline).toEqual({
		better: 4,
		worse: 0,
		bothCorrect: 18,
		bothWrong: 2,
		unanswered: 8,
	});
	expect(s.pairs.versusControl).toEqual({
		better: 0,
		worse: 1,
		bothCorrect: 22,
		bothWrong: 1,
		unanswered: 8,
	});
	expect(saved.adoption).toEqual({
		retained: false,
		preferred: false,
		conditions: {
			complete: false,
			historicalRepairs: true,
			noPairedRegression: true,
			unseenImprovement: true,
			multiplePackets: true,
		},
		instructionAdvantage: false,
		correctnessPreservedAgainstControl: false,
	});
});
test("invalidated identity-collision run is separate and no semantic protocol was tuned after seeing its answers", () => {
	const invalid = JSON.parse(
		readExperimentEvidence(
			new URL(
				"../../fixtures/experiments/source-review-comparison/2026-10-16-invalidated.json.gz",
				import.meta.url,
			),
			"utf8",
		),
	);
	expect(invalid.status).toBe("invalidated");
	expect(invalid.usage.completedResponses).toBe(37);
	const old = invalid.protocol;
	old.packets.find((p: { id: string }) => p.id === "reservoir-valve").id =
		"cistern-valve";
	for (const q of old.questions)
		if (q.suite === "unseen" && q.packet === "reservoir-valve")
			q.packet = "cistern-valve";
	expect(old.packets).toEqual(saved.protocol.packets);
	expect(old.questions).toEqual(saved.protocol.questions);
	expect(old.instructions).toEqual(saved.protocol.instructions);
	const full = JSON.parse(
		readExperimentEvidence(
			new URL(
				"../../fixtures/experiments/source-review-comparison/2026-10-16.json.gz",
				import.meta.url,
			),
			"utf8",
		),
	);
	const { codeDigests: priorDigests, ...priorProtocol } = old;
	const { codeDigests: finalDigests, ...finalProtocol } = full.protocol;
	expect(priorProtocol).toEqual(finalProtocol);
	expect(
		Object.keys(finalDigests).filter(
			(k) => finalDigests[k] !== priorDigests[k],
		),
	).toEqual([
		"examples/source-review-comparison/fixtures.ts",
		"examples/source-review-comparison/main.ts",
		"test/eval/source-review.test.ts",
	]);
});
