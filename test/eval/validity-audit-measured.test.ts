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
} from "../../examples/validity-audit-comparison/fixtures.ts";
import {
	instructions,
	presentation,
	schemaFor,
} from "../../examples/validity-audit-comparison/protocol.ts";
import {
	review,
	reviewPrompt,
	type Response,
} from "../../examples/validity-audit-comparison/review.ts";
import {
	assess,
	summarize,
	type Cell,
} from "../../examples/validity-audit-comparison/results.ts";
import { adoption } from "../../examples/validity-audit-comparison/adoption.ts";
const saved = JSON.parse(
	readExperimentEvidence(
		new URL(
			"../../fixtures/experiments/validity-audit-comparison/2026-10-16.json.gz",
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
	const ctx = saved.contexts.find((c) => c.question.id === "FH02")!.context;
	const expired = ctx.derivedView!.slice.units.find((u) =>
		u.sources.some((s) => s.id === "FH7"),
	)!;
	expect(
		ctx.derivedView!.evaluations.find(
			(e) => e.assertionId === expired.assertionId,
		)!.reasons,
	).toContain("CLAIM_NOT_VALID");
});
test("all shared-first-answer branches replay without model calls and reproduce requests, costs, audits and scores", async () => {
	const calls: string[] = [];
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
	expect(calls).toHaveLength(18);
	expect(new Set(calls).size).toBe(18);
	expect(Object.keys(saved.responses)).toHaveLength(45);
	expect(summarize(saved.report.cells, questions)).toEqual(
		saved.report.summary,
	);
	expect(adoption(saved.report.cells)).toEqual(saved.adoption);
});
test("all known temporal misses are detected, six are repaired, and the two remaining candidate errors are rejected", () => {
	expect(saved.report.cells).toHaveLength(108);
	expect(
		new Set(
			saved.report.cells.map((c) => `${c.questionId}:${c.repeat}:${c.arm}`),
		).size,
	).toBe(108);
	const s = saved.report.summary.regression;
	expect(s.byArm.baseline!.primaryCorrect).toBe(4);
	expect(s.byArm.control!.primaryCorrect).toBe(8);
	expect(s.byArm.validity!.primaryCorrect).toBe(10);
	expect(s.auditByArm.validity).toEqual({
		accepted: 10,
		acceptedWrong: 0,
		rejectedCorrect: 0,
		newlyCaughtInitial: 8,
		finalTemporalViolations: 2,
		reviews: 8,
	});
	expect(s.auditByArm.control!.acceptedWrong).toBe(3);
	expect(s.pairs.versusControl).toEqual({
		better: 3,
		worse: 1,
		bothCorrect: 7,
		bothWrong: 1,
		unanswered: 0,
	});
	for (const r of regressions.filter((r) => !r.expectedInvalid)) {
		const cells = saved.report.cells.filter(
			(c) => c.questionId === r.question.id,
		);
		expect(cells).toHaveLength(6);
		for (const c of cells) {
			expect(c.raw).toBe(r.seedRaw);
			expect(c.review!.repairAttempted).toBe(false);
			expect(c.review!.accepted).toBe(true);
		}
	}
	const rejected = saved.report.cells.filter(
		(c) => c.arm === "validity" && !c.review!.accepted,
	);
	expect(rejected.map((c) => `${c.questionId}:${c.repeat}`)).toEqual([
		"VT02:0",
		"VT03:1",
	]);
	expect(
		rejected.every(
			(c) =>
				!c.score!.primaryCorrect &&
				c.score!.decisionCorrect &&
				c.review!.finalValidity.invalidClaims.length === 1,
		),
	).toBe(true);
});
test("unseen results do not establish new temporal detection or feedback superiority; paired requests differ only in audit feedback", () => {
	const s = saved.report.summary.unseen;
	expect(s.byArm.baseline!.primaryCorrect).toBe(22);
	expect(s.byArm.control!.primaryCorrect).toBe(23);
	expect(s.byArm.validity!.primaryCorrect).toBe(23);
	expect(s.pairs.versusControl).toEqual({
		better: 0,
		worse: 0,
		bothCorrect: 23,
		bothWrong: 1,
		unanswered: 0,
	});
	expect(s.auditByArm.validity).toEqual({
		accepted: 24,
		acceptedWrong: 1,
		rejectedCorrect: 0,
		newlyCaughtInitial: 0,
		finalTemporalViolations: 0,
		reviews: 1,
	});
	const unseenReviews = saved.report.cells.filter(
		(c) => c.suite === "unseen" && c.review!.repairAttempted,
	);
	expect(
		unseenReviews.map((c) => `${c.questionId}:${c.repeat}:${c.arm}`),
	).toEqual(["BW02:0:control", "BW02:0:validity"]);
	for (const c of saved.report.cells.filter(
		(c) => c.questionId === "DT04" && c.repeat === 0,
	)) {
		expect(c.raw).toBe(saved.responses["initial-DT04-0"]!.raw);
		expect(c.review!.accepted).toBe(true);
		expect(c.score!.primaryCorrect).toBe(false);
	}
	let pairs = 0;
	for (const cell of saved.report.cells.filter(
		(c) => c.arm === "validity" && c.review!.repairAttempted,
	)) {
		const { question, context } = saved.contexts.find(
			(c) => c.question.id === cell.questionId,
		)!;
		const raw =
			regressions.find((r) => r.question.id === cell.questionId)?.seedRaw ??
			saved.responses[`initial-${cell.questionId}-${cell.repeat}`]!.raw;
		const { validityAudit, ...rest } = JSON.parse(
			reviewPrompt(question, context, raw, "validity"),
		);
		expect(rest).toEqual(
			JSON.parse(reviewPrompt(question, context, raw, "control")),
		);
		expect(validityAudit).toEqual(cell.review!.initialValidity);
		pairs++;
	}
	expect(pairs).toBe(9);
	expect(saved.adoption).toEqual({
		guardRetained: false,
		repairRetained: false,
		preferred: false,
		detection: {
			complete: true,
			knownCaught: true,
			noFalseInitialFlag: true,
			noFalseRejection: true,
			unseenNewCatch: false,
		},
		repair: {
			complete: true,
			historicalRepairs: false,
			passingPreserved: true,
			noPairedRegression: true,
			unseenImprovement: true,
			multiplePackets: false,
		},
		feedbackAdvantage: false,
		controlPreserved: false,
	});
});
