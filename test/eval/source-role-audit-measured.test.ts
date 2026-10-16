import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
} from "../../examples/source-role-audit-comparison/fixtures.ts";
import {
	instructions,
	presentation,
	schemaFor,
} from "../../examples/source-role-audit-comparison/protocol.ts";
import {
	review,
	reviewPrompt,
	type Response,
} from "../../examples/source-role-audit-comparison/review.ts";
import {
	assess,
	summarize,
	type Cell,
} from "../../examples/source-role-audit-comparison/results.ts";
import { adoption } from "../../examples/source-role-audit-comparison/adoption.ts";
const saved = JSON.parse(
	readFileSync(
		new URL(
			"../../examples/source-role-audit-comparison/results/2026-10-16.json",
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
test("all fresh extracted packets rebuild their SQLite contexts and native expected calculations", () => {
	expect(saved.protocol.packets).toEqual(packets);
	expect(saved.protocol.questions).toEqual(questions);
	expect(saved.protocol.instructions).toEqual(instructions);
	for (const p of packets) {
		const material = interpret(p, saved.responses[`extract-${p.id}`]!.raw);
		for (const q of questions.filter(
			(q) => q.suite === "unseen" && q.packet === p.id,
		)) {
			const store = openTestStore();
			try {
				store.write((db) => persist(db, material, q.asOf));
				const ctx = store.read((db) => contexts(db, material, q).world);
				expect(ctx).toEqual(
					saved.contexts.find((c) => c.question.id === q.id)!.context,
				);
				expect(ctx.sources.map((s) => s.id)).toEqual(
					p.documents.map((d) => d.id),
				);
			} finally {
				store.close();
			}
		}
	}
	for (const { question: q, context: ctx } of saved.contexts) {
		for (const [id, result] of Object.entries(q.expectedAssessments)) {
			const u = ctx.derivedView!.slice.units.find((u) =>
				u.sources.some((s) => s.id === id),
			)!;
			expect(
				ctx.derivedView!.evaluations.find(
					(e) => e.assertionId === u.assertionId,
				)!.result,
			).toBe(result);
		}
	}
});
test("all shared-first-answer branches replay without model calls and reproduce requests, costs, audits and scores", async () => {
	const calls: string[] = [];
	const auditCalls: string[] = [];
	for (const cell of saved.report.cells) {
		expect(cell.status).toBe("answered");
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
			async (stage, prompt, schema) => {
				const key = `${stage === "initial" ? "audit" : "final-audit"}-${cell.questionId}-${cell.repeat}${stage === "initial" ? "" : `-${cell.arm}`}`;
				auditCalls.push(key);
				expect(hash(Buffer.from(JSON.stringify({ prompt, schema })))).toBe(
					saved.responses[key]!.requestDigest,
				);
				return cached(key);
			},
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
		expect<Cell["review"]>(details).toEqual(cell.review!);
		expect({ inputTokens, outputTokens, latencyMs }).toEqual({
			inputTokens: cell.inputTokens,
			outputTokens: cell.outputTokens,
			latencyMs: cell.latencyMs,
		});
		expect(assess(question, context, cell.arm, raw)).toEqual(cell.score!);
	}
	expect(calls).toHaveLength(
		Object.keys(saved.responses).filter((k) => k.startsWith("repair-")).length,
	);
	expect(new Set(calls).size).toBe(calls.length);
	expect(new Set(auditCalls).size).toBe(
		Object.keys(saved.responses).filter(
			(k) => k.startsWith("audit-") || k.startsWith("final-audit-"),
		).length,
	);
	expect(summarize(saved.report.cells, questions)).toEqual(
		saved.report.summary,
	);
	expect(adoption(saved.report.cells)).toEqual(saved.adoption);
});
test("known contamination is caught only once; the new out-of-scope observation reference is also falsely accepted", () => {
	expect(saved.report.cells).toHaveLength(90);
	expect(
		new Set(
			saved.report.cells.map((c) => `${c.questionId}:${c.repeat}:${c.arm}`),
		).size,
	).toBe(90);
	const rows = (id: string, repeat: number) =>
		saved.report.cells.filter(
			(c) => c.questionId === id && c.repeat === repeat,
		);
	expect(
		rows("SR01", 0).every(
			(c) =>
				c.review!.accepted &&
				!c.score!.primaryCorrect &&
				!c.review!.repairAttempted,
		),
	).toBe(true);
	const detected = rows("SR01", 1).filter((c) => c.arm !== "baseline");
	expect(detected).toHaveLength(2);
	for (const c of detected) {
		expect(
			c.review!.initialRole!.reviews.find((r) => r.sourceId === "DT2")!.verdict,
		).toBe("inapplicable");
		expect(c.review!.repairAttempted).toBe(true);
		expect(c.score!.primaryCorrect).toBe(true);
	}
	expect(
		rows("CF03", 0).every(
			(c) =>
				c.review!.accepted &&
				!c.score!.primaryCorrect &&
				!c.review!.repairAttempted,
		),
	).toBe(true);
	const falseAudit = rows("CF03", 0).find((c) => c.arm === "role")!.review!
		.initialRole!;
	expect(falseAudit.reviews.find((r) => r.sourceId === "CF4")!.verdict).toBe(
		"applicable",
	);
	const s = saved.report.summary;
	expect(s.regression.byArm.baseline!.primaryCorrect).toBe(4);
	expect(s.regression.byArm.role!.primaryCorrect).toBe(5);
	expect(s.unseen.byArm.baseline!.primaryCorrect).toBe(23);
	expect(s.unseen.byArm.role!.primaryCorrect).toBe(23);
	expect(s.all.pairs.versusBaseline).toEqual({
		better: 1,
		worse: 0,
		bothCorrect: 27,
		bothWrong: 2,
		unanswered: 0,
	});
	expect(s.all.pairs.versusControl).toEqual({
		better: 0,
		worse: 0,
		bothCorrect: 28,
		bothWrong: 2,
		unanswered: 0,
	});
	expect(s.all.auditByArm.role).toEqual({
		accepted: 30,
		acceptedWrong: 2,
		rejectedCorrect: 0,
		newlyCaughtInitial: 1,
		finalRoleRejections: 0,
		reviews: 1,
	});
});
test("necessary references survive, audit feedback is the only revision request difference, and adoption remains false", () => {
	let applicable = 0,
		correctlyFlagged = 0,
		missed = 0;
	for (const c of saved.report.cells.filter((c) => c.arm === "role")) {
		const q = questions.find((q) => q.id === c.questionId)!;
		for (const r of c.review!.initialRole!.reviews) {
			if (q.expected.governingSources.includes(r.sourceId)) {
				expect(r.verdict).toBe("applicable");
				applicable++;
			} else if (r.verdict === "inapplicable") correctlyFlagged++;
			else missed++;
		}
	}
	expect({ applicable, correctlyFlagged, missed }).toEqual({
		applicable: 36,
		correctlyFlagged: 1,
		missed: 2,
	});
	for (const c of saved.report.cells.filter(
		(c) => c.arm !== "baseline" && !c.review!.repairAttempted,
	)) {
		const initial =
			regressions.find((r) => r.question.id === c.questionId)?.seedRaw ??
			saved.responses[`initial-${c.questionId}-${c.repeat}`]!.raw;
		expect(c.raw).toBe(initial);
	}
	const c = saved.report.cells.find(
		(c) => c.questionId === "SR01" && c.repeat === 1 && c.arm === "role",
	)!;
	const seed = regressions[0]!;
	const { sourceRoleAudit, ...rest } = JSON.parse(
		reviewPrompt(
			seed.question,
			seed.context,
			seed.seedRaw,
			"role",
			c.review!.initialRole!,
		),
	);
	expect(rest).toEqual(
		JSON.parse(
			reviewPrompt(
				seed.question,
				seed.context,
				seed.seedRaw,
				"control",
				c.review!.initialRole!,
			),
		),
	);
	expect(sourceRoleAudit).toEqual(c.review!.initialRole);
	expect(saved.adoption).toEqual({
		guardRetained: false,
		repairRetained: false,
		preferred: false,
		detection: {
			complete: true,
			knownCaught: false,
			noFalseFlag: true,
			noFalseRejection: true,
			unseenCatch: false,
		},
		repairs: {
			complete: true,
			knownRepaired: false,
			passingPreserved: true,
			noRegression: true,
			unseenImprovement: false,
			multiplePackets: false,
		},
		feedbackAdvantage: false,
		controlPreserved: true,
	});
});
