import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiBudget } from "../../eval/api/client.ts";
import { ApiSession } from "../../eval/api/session.ts";
import { judgeReliable } from "../../eval/api-quality/reliable.ts";
import {
	arms,
	type Answer,
	type Arm,
} from "../../eval/api-quality/protocol.ts";
import { longitudinalEpisodes } from "../../eval/api-quality/longitudinal-fixtures.ts";
import { runJobs, summary } from "../../eval/api-quality/main.ts";
import { summarizeLongitudinal } from "../../eval/api-quality/longitudinal.ts";

const byArm = <T>(f: (arm: Arm) => T): Record<Arm, T> => ({
	raw: f("raw"),
	plain: f("plain"),
	world: f("world"),
	oracle: f("oracle"),
});

test.each([false, true])(
	"judge errors preserve independently completed verdicts (all failures: %s), without retry",
	async (allFail) => {
		const dir = mkdtempSync(join(tmpdir(), "world-judge-recovery-"));
		const budget = new ApiBudget(join(dir, "budget"));
		const called: string[] = [];
		const session = new ApiSession(budget, join(dir, "cache"), {
			key: "fixture",
			fetchImpl: async (_url, init) => {
				const b = JSON.parse(String(init.body));
				const p = JSON.parse(b.input);
				const arm = p.output.answer;
				called.push(arm);
				if (allFail || arm === "plain")
					return new Response("fixture transient failure", { status: 503 });
				return Response.json({
					model: b.model,
					status: "completed",
					usage: { input_tokens: 10, output_tokens: 5 },
					output: [
						{
							type: "message",
							content: [
								{
									type: "output_text",
									text: JSON.stringify({
										label: "output",
										correct: arm !== "raw",
										sourceSupported: true,
										qualificationsPreserved: true,
										appropriateHold: true,
										safetyViolation: arm === "raw",
										referenceConflict: false,
										reason: "fixture verdict",
									}),
								},
							],
						},
					],
				});
			},
		});
		try {
			const answers = byArm<Answer>((arm) => ({
				answer: arm,
				claims: [],
				citations: [],
				hold: true,
			}));
			const contexts = byArm((arm) => ({
				text: arm,
				evidenceIds: [] as string[],
			}));
			const r = await judgeReliable(
				session,
				"claude",
				longitudinalEpisodes()[0]!.checkpoints[0]!.job,
				answers,
				contexts,
			);
			expect(r).toHaveProperty("judgments");
			expect(r).toHaveProperty("errors");
			expect(Object.keys(r.judgments)).toEqual(
				allFail ? [] : ["raw", "world", "oracle"],
			);
			expect(Object.keys(r.errors)).toEqual(allFail ? [...arms] : ["plain"]);
			if (!allFail) expect(r.judgments.raw?.safetyViolation).toBe(true);
			expect(called).toEqual([...arms]);
			expect(session.counts.requests).toBe(4);
		} finally {
			budget.close();
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

test("runJobs saves per-arm errors and known safety violations; summaries retain independent successes", async () => {
	const dir = mkdtempSync(join(tmpdir(), "world-judge-integration-"));
	const budget = new ApiBudget(join(dir, "budget"));
	const episode = longitudinalEpisodes()[0]!,
		step = episode.checkpoints[0]!,
		job = step.job;
	const failed = new Set<string>();
	const session = new ApiSession(budget, join(dir, "cache"), {
		key: "fixture",
		fetchImpl: async (_url, init) => {
			const b = JSON.parse(String(init.body));
			const p = JSON.parse(b.input ?? b.messages[0].content),
				input = p.originalInput ?? p;
			let output: unknown;
			if (input.window)
				output = {
					candidates: job.expected.map((f) => ({
						subject: { kind: "id", id: f.subjectId },
						predicate: f.predicate,
						payload: f.payload,
						modality: "asserted",
						condition: null,
						validTime: null,
						quotes: f.sourceIds.map((id) => ({
							utteranceId: id,
							text: job.sources.find((s) => s.id === id)!.text,
							occurrence: 0,
						})),
					})),
				};
			else if (p.catalog)
				output = {
					refs: p.catalog.map((c: { id: string; revision: number }) => ({
						id: c.id,
						revision: c.revision,
					})),
				};
			else if (p.reference) {
				if (p.visible.context.startsWith("format: ")) {
					const key = String(init.body);
					expect(failed.has(key)).toBe(false);
					failed.add(key);
					return new Response("fixture judge failure", { status: 503 });
				}
				const raw = p.visible.context.startsWith('{"sources":');
				output = {
					label: "output",
					correct: !raw,
					sourceSupported: true,
					qualificationsPreserved: true,
					appropriateHold: true,
					safetyViolation: raw,
					referenceConflict: false,
					reason: "fixture only",
				};
			} else
				output = {
					answer: "fixture only",
					hold: false,
					citations: job.requiredSources,
					claims: job.answerFacts.map((f) => ({
						subjectId: f.subjectId,
						predicate: f.predicate,
						payload: f.payload,
					})),
				};
			const text = JSON.stringify(output);
			return Response.json({
				model: b.model,
				status: "completed",
				stop_reason: "end_turn",
				usage: { input_tokens: 10, output_tokens: 5 },
				output: [{ type: "message", content: [{ type: "output_text", text }] }],
				content: [{ type: "text", text }],
			});
		},
	});
	try {
		const rows = await runJobs(session, dir, false, [job], ["grounded"]);
		expect(rows).toHaveLength(4);
		const saved = readFileSync(join(dir, "cells.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		for (const c of saved) {
			expect(c.judgments.raw.safetyViolation).toBe(true);
			expect(c.judgments.world.correct).toBe(true);
			expect(c.judgments.plain).toBeUndefined();
			expect(c.judgeErrors.plain).toContain("API_HTTP_503");
			expect(c.judgeErrors.world).toBeUndefined();
			expect(c.judgeError).toBeNull();
		}
		const s = summary(rows).find(
			(s) =>
				s.profile === "grounded" &&
				s.extractor === "openai" &&
				s.reader === "openai",
		)!;
		expect(s.byArm.world?.evaluationPassed).toBe(1);
		expect(s.byArm.plain?.missing).toBe(1);
		expect(s.byArm.raw?.safety).toBe(1);
		const temporal = summarizeLongitudinal(
			[{ ...episode, checkpoints: [step] }],
			rows,
		).groups[0]!.arms;
		expect(temporal.find((a) => a.arm === "world")?.correct).toBe(1);
		expect(temporal.find((a) => a.arm === "plain")?.missing).toBe(1);
		expect(temporal.find((a) => a.arm === "raw")?.unsafeAnswers).toBe(1);
		expect(failed.size).toBeGreaterThan(0);
	} finally {
		budget.close();
		rmSync(dir, { recursive: true, force: true });
	}
});
