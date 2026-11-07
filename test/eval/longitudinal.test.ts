import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiSession } from "../../eval/api/session.ts";
import { ApiBudget } from "../../eval/api/client.ts";
import { runJobs } from "../../eval/api-quality/main.ts";
import { longitudinalEpisodes } from "../../eval/api-quality/longitudinal-fixtures.ts";
import {
	summarizeLongitudinal,
	longitudinalJobs,
} from "../../eval/api-quality/longitudinal.ts";
import type { Cell } from "../../eval/api-quality/main.ts";
import {
	arms,
	services,
	authorizedSources,
	plainContext,
	type Answer,
	type Arm,
	type JudgeVerdict,
} from "../../eval/api-quality/protocol.ts";
import { canonical, gradeAnswer } from "../../eval/api-quality/scoring.ts";
import { replay } from "../../eval/api-quality/pipeline.ts";
import { assertDeclaredPayloads } from "../../eval/api/typed-wire.ts";

const episodes = longitudinalEpisodes();
const verdict: JudgeVerdict = {
	label: "output",
	correct: true,
	sourceSupported: true,
	qualificationsPreserved: true,
	appropriateHold: true,
	safetyViolation: false,
	reason: "fixture verdict only",
};
function cells(): Cell[] {
	return episodes.flatMap((e) =>
		e.checkpoints.flatMap(({ job }) =>
			services.flatMap((extractor) =>
				services.map((reader) => {
					const a: Answer = {
						answer: "fixture reference, never a real-model result",
						hold: job.hold,
						citations: job.requiredSources,
						claims: job.answerFacts.map((f) => ({
							subjectId: f.subjectId,
							predicate: f.predicate,
							payloadJson: canonical(f.payload),
						})),
					};
					return {
						id: job.id,
						split: job.split,
						profile: "grounded",
						extractor,
						reader,
						stages: null,
						error: null,
						answers: Object.fromEntries(
							arms.map((arm) => [arm, a]),
						) as Cell["answers"],
						errors: {},
						grades: Object.fromEntries(
							arms.map((arm) => [
								arm,
								gradeAnswer(job, a, job.requiredSources),
							]),
						) as Cell["grades"],
						judgments: Object.fromEntries(arms.map((arm) => [arm, verdict])),
						judgeError: null,
						contextBytes: { raw: 20, plain: 20, world: 20, oracle: 20 },
						usageValid: true,
					};
				}),
			),
		),
	);
}
const firstArm = (rows: Cell[], arm: Arm = "world") =>
	summarizeLongitudinal(episodes, rows).groups[0]!.arms.find(
		(a) => a.arm === arm,
	)!;

test("all fixed checkpoints preserve caller contracts and never send erased sources to extraction", () => {
	expect(episodes).toHaveLength(3);
	for (const e of episodes) {
		expect(e.checkpoints).toHaveLength(8);
		for (const { job } of e.checkpoints) {
			const eligible = { ...job, sources: authorizedSources(job) };
			expect(
				eligible.sources.every((s) => !job.eraseBeforeRead?.includes(s.id)),
			).toBe(true);
			// No model calls. Empty extraction also exercises forget on a snapshot
			// with no retained value; existing persistent forget tests cover history.
			const p = replay(eligible, { candidates: [] });
			expect(p.queries[0]!.catalog).toEqual([]);
			for (const f of job.expected)
				assertDeclaredPayloads(
					[{ predicate: f.predicate, payload: f.payload }],
					job.predicates,
					job.entities.map((x) => x.id),
				);
		}
	}
});

test("fixture references test metrics only; style changes are not decision changes and costs remain unknown", () => {
	const rows = cells();
	const r = firstArm(rows);
	expect(r.correct).toBe(24);
	expect(r.missing).toBe(0);
	expect(r.justifiedChange).toEqual({ numerator: 18, denominator: 18 });
	expect(r.appropriateHold).toEqual({ numerator: 12, denominator: 12 });
	expect(r.spuriousChange).toEqual({ numerator: 0, denominator: 3 });
	expect(r.wrongReassertion.numerator).toBe(0);
	expect(r.cost.inputTokens).toBeNull();
	expect(summarizeLongitudinal(episodes, rows).accepted).toBe(false);
});

test("stale answers, missing responses and failed context cannot become successful changes or holds", () => {
	const rows = cells();
	const c = rows.find(
		(c) =>
			c.id === "booth-6" && c.extractor === "openai" && c.reader === "openai",
	)!;
	c.answers.world = { ...rows[0]!.answers.world!, hold: false };
	c.grades.world = {
		passed: false,
		missing: false,
		wrong: true,
		unsupportedCitation: true,
	};
	c.judgments.world = { ...verdict, correct: false, safetyViolation: true };
	const r = firstArm(rows);
	expect(r.wrongReassertion.numerator).toBe(1);
	expect(r.unsafeAnswers).toBe(1);
	expect(r.justifiedChange.numerator).toBe(17);
	expect(r.spuriousChange.numerator).toBe(1);
	const absent = rows.filter((v) => v.id !== "booth-2");
	expect(firstArm(absent).missing).toBe(1);
	expect(firstArm(absent).appropriateHold.denominator).toBe(12);
	c.answers.world = null;
	expect(firstArm(rows).missing).toBe(1);
	const broken = cells();
	broken[0]!.error = "UPSTREAM_FAILED";
	expect(firstArm(broken).correct).toBe(23);
	expect(firstArm(broken).pipelineFailures).toBe(1);
	expect(firstArm(broken, "raw").correct).toBe(24);
});

test("duplicate records and unknown checkpoints are refused rather than counted twice", () => {
	const rows = cells();
	expect(() => firstArm([...rows, rows[0]!])).toThrow(
		"INVALID_LONGITUDINAL_CELLS",
	);
	expect(() => firstArm([{ ...rows[0]!, id: "unknown" }])).toThrow(
		"INVALID_LONGITUDINAL_CELLS",
	);
});

test("malformed payloads remain unaccepted and cannot crash temporal scoring", () => {
	const rows = cells();
	rows[0]!.answers.world = {
		...rows[0]!.answers.world!,
		claims: [
			{
				subjectId: "booth",
				predicate: "capacity",
				payloadJson: "invalid-json",
			},
		],
	};
	expect(firstArm(rows).missing).toBe(1);
	expect(firstArm(rows).correct).toBe(23);
});

test("a hold flag cannot hide old typed claims, and contradictory abstention never succeeds", () => {
	const rows = cells();
	const c = rows.find(
		(c) =>
			c.id === "booth-6" && c.extractor === "openai" && c.reader === "openai",
	)!;
	const retired = episodes[0]!.checkpoints[6]!.retiredFacts[0]!;
	const claim = {
		subjectId: retired.subjectId,
		predicate: retired.predicate,
		payloadJson: canonical(retired.payload),
	};
	c.answers.world = {
		answer: "fixture leak",
		citations: [],
		hold: true,
		claims: [claim, claim],
	};
	c.grades.world = gradeAnswer(
		episodes[0]!.checkpoints[6]!.job,
		c.answers.world,
		[],
	);
	c.judgments.world = {
		...verdict,
		correct: false,
		appropriateHold: false,
		safetyViolation: true,
	};
	const r = firstArm(rows);
	expect(r.wrongReassertion.numerator).toBe(1);
	expect(r).toHaveProperty("contradictoryHolds", 1);
	expect(r.appropriateHold.numerator).toBe(11);
	expect(firstArm(cells())).toHaveProperty("contradictoryHolds", 0);
});

test.each([0, 1, 2, 3, 4, 5, 6, 7])(
	"checkpoint %s uses the existing API/SQLite/judge path with costs and no gold leakage",
	async (index) => {
		const dir = mkdtempSync(join(tmpdir(), "world-longitudinal-"));
		const budget = new ApiBudget(join(dir, "budget"));
		const step = episodes[0]!.checkpoints[index]!;
		const job = longitudinalJobs([{ id: "fixture", checkpoints: [step] }])[0]!;
		let requests = 0;
		const session = new ApiSession(budget, join(dir, "cache"), {
			key: "fixture-only",
			fetchImpl: async (_url, init) => {
				requests++;
				const body = JSON.parse(String(init.body));
				const prompt = JSON.parse(body.input ?? body.messages[0].content);
				const input = prompt.originalInput ?? prompt;
				let output: unknown;
				if (input.window) {
					expect(input.window).toEqual(
						job.sources.map((s) => ({
							utteranceId: s.id,
							text: s.text,
							origin: "document_claim",
						})),
					);
					expect(input).not.toHaveProperty("expected");
					expect(input).not.toHaveProperty("retiredFacts");
					output = {
						candidates: job.expected.map((f) => ({
							subject: { kind: "id", id: f.subjectId },
							predicate: f.predicate,
							payload: f.payload,
							modality: "asserted",
							validTime: null,
							condition:
								f.condition?.kind === "expression"
									? { nodes: [f.condition.expression] }
									: null,
							quotes: f.sourceIds.map((id) => ({
								utteranceId: id,
								text: job.sources.find((s) => s.id === id)!.text,
								occurrence: 0,
							})),
						})),
					};
				} else if (prompt.catalog) {
					output = {
						refs: prompt.catalog.map((c: { id: string; revision: number }) => ({
							id: c.id,
							revision: c.revision,
						})),
					};
				} else if (prompt.reference)
					output = { ...verdict, referenceConflict: false };
				else {
					expect(prompt).not.toHaveProperty("answerFacts");
					expect(prompt).not.toHaveProperty("retiredFacts");
					output = {
						hold: job.hold,
						claims: job.answerFacts.map((f) => ({
							subjectId: f.subjectId,
							predicate: f.predicate,
							payload: f.payload,
						})),
						answer: "fixture answer, not model quality",
						citations: job.requiredSources,
					};
				}
				const text = JSON.stringify(output);
				return Response.json({
					model: body.model,
					status: "completed",
					stop_reason: "end_turn",
					usage: { input_tokens: 10, output_tokens: 5 },
					output: [
						{ type: "message", content: [{ type: "output_text", text }] },
					],
					content: [{ type: "text", text }],
				});
			},
		});
		try {
			const rows = await runJobs(session, dir, false, [job], ["grounded"]);
			expect(rows).toHaveLength(4);
			expect(requests).toBeGreaterThan(0);
			for (const row of rows) {
				expect(row.error).toBeNull();
				expect(row.judgeError).toBeNull();
				expect(row.usageValid).toBe(true);
				for (const arm of arms) {
					expect(row.grades[arm].passed).toBe(true);
					expect(row.answerUsage?.[arm]?.inputTokens).toBe(10);
					expect(row.answerUsage?.[arm]?.outputTokens).toBe(5);
				}
			}
		} finally {
			budget.close();
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

test("World and plain keep identical material at the existing byte budget", () => {
	const job = episodes[0]!.checkpoints[0]!.job;
	const f = job.answerFacts[0]!,
		source = job.sources[0]!;
	const p = replay(
		job,
		{
			candidates: [
				{
					subject: { kind: "id", id: f.subjectId },
					predicate: f.predicate,
					payload: f.payload,
					modality: "asserted",
					quote: {
						utteranceId: source.id,
						startByte: 0,
						endByte: Buffer.byteLength(source.text),
					},
				},
			],
		},
		[0],
	);
	const view = p.queries[0]!.arms.selected;
	expect(view.units).toHaveLength(1);
	const plain = plainContext(view);
	expect(Buffer.byteLength(plain)).toBeLessThanOrEqual(8192);
	expect(view.bytes).toBeLessThanOrEqual(8192);
	const decoded = Object.fromEntries(
		plain.split("\n").map((line) => {
			const at = line.indexOf(": ");
			return [line.slice(0, at), JSON.parse(line.slice(at + 2))];
		}),
	);
	const { kind: _kind, ...world } = JSON.parse(view.text);
	expect(decoded).toEqual(world);
});

test("offline preparation is executable without a budget or provider and cannot overwrite evidence", () => {
	const dir = mkdtempSync(join(tmpdir(), "world-longitudinal-prepare-"));
	const output = join(dir, "prepared");
	const args = [
		process.execPath,
		"eval/api-quality/main.ts",
		"longitudinal-prepare",
		output,
	];
	try {
		const p = Bun.spawnSync(args, {
			env: { ...process.env, OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "" },
		});
		expect(p.exitCode).toBe(0);
		const result = JSON.parse(
			readFileSync(join(output, "result.json"), "utf8"),
		);
		expect(result).toMatchObject({
			status: "prepared",
			modelCalls: 0,
			accepted: false,
			episodes: 3,
			checkpoints: 24,
			plannedCells: 96,
			plannedAnswers: 384,
			maximumRequests: 960,
		});
		expect(existsSync(join(output, "cells.jsonl"))).toBe(false);
		const audit = JSON.parse(
			readFileSync(join(output, "contract-audit.json"), "utf8"),
		);
		expect(audit.status).toBe("no_capacity_conflict");
		expect(audit.profiles).toHaveLength(1);
		expect(audit.profiles[0]).toMatchObject({
			profile: "grounded",
			audit: { cases: 24 },
		});
		expect(Bun.spawnSync(args).exitCode).toBe(1);
		expect(readFileSync(join(output, "result.json"), "utf8")).toBe(
			JSON.stringify(result, null, 2) + "\n",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
