/** Paid, explicit entry point. Ordinary verify cannot initiate any model call. */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApiBudget, apiModels, type ApiService } from "../api/client.ts";
import { ApiSession } from "../api/session.ts";
import {
	GROUNDED_VERSION,
	groundedExtractionProvider,
} from "../api/grounded-extraction.ts";
import {
	loadQuality,
	fixtureDigests,
	type QualityCase,
	type Job,
} from "./dataset.ts";
import { extract, replay, select, describeValidation } from "./pipeline.ts";
import {
	profiles,
	services,
	arms,
	PROTOCOL,
	plainContext,
	rawContext,
	type Answer,
	type Arm,
	type Profile,
	type JudgeVerdict,
} from "./protocol.ts";
import { answerReliable, judgeReliable, judgeExtraction } from "./reliable.ts";
import { gradeAnswer, matches, semanticPass } from "./scoring.ts";
import { sourceSnapshot } from "../measurement/run.ts";
import { loadDataset, DATASET_SHA256 } from "../extraction/dataset.ts";
import { runEvaluation } from "../extraction/runner.ts";
import { redactHoldoutReport } from "../extraction/main.ts";
import { comparisonFeasibility, comparisonGate } from "./contracts.ts";
import {
	auditProfiles,
	requireProfilesRepresentable,
} from "./contract-audit.ts";
import { longitudinalEpisodes } from "./longitudinal-fixtures.ts";
import {
	summarizeLongitudinal,
	longitudinalJobs,
	LONGITUDINAL_PROTOCOL,
} from "./longitudinal.ts";
const save = (file: string, value: unknown) =>
	writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const message = (e: unknown) =>
	e instanceof Error ? e.message : "EVALUATION_ERROR";
export interface Cell {
	id: string;
	split: string;
	profile: Profile;
	extractor: ApiService;
	reader: ApiService;
	stages: unknown;
	error: string | null;
	answers: Record<Arm, Answer | null>;
	errors: Partial<Record<Arm, string>>;
	grades: Record<Arm, ReturnType<typeof gradeAnswer>>;
	judgments: Partial<Record<Arm, JudgeVerdict>>;
	judgeError: string | null;
	/** Per-arm failures; judgeError is retained for legacy whole-cell failures. */
	judgeErrors?: Partial<Record<Arm, string>>;
	contextBytes: Record<Arm, number>;
	usageValid: boolean;
	answerUsage?: Partial<
		Record<
			Arm,
			{ inputTokens: number; outputTokens: number; latencyMs: number }
		>
	>;
}
async function pool<T>(
	items: readonly T[],
	fn: (item: T, index: number) => Promise<void>,
) {
	let next = 0;
	await Promise.all(
		Array.from({ length: 2 }, async () => {
			while (next < items.length) {
				const i = next++;
				await fn(items[i]!, i);
			}
		}),
	);
}
export function summary(cells: Cell[]) {
	const out = [];
	for (const profile of profiles)
		for (const extractor of services)
			for (const reader of services) {
				const group = cells.filter(
					(c) =>
						c.profile === profile &&
						c.extractor === extractor &&
						c.reader === reader,
				);
				const pass = (c: Cell, a: Arm) =>
					c.grades[a].passed &&
					semanticPass(c.judgments[a]) &&
					!c.errors[a] &&
					!c.judgeError &&
					!c.judgeErrors?.[a] &&
					(!(a === "world" || a === "plain") || (!c.error && c.usageValid));
				const evals = group.filter((c) => c.split === "evaluation");
				const pair = (against: Arm) => {
					const improved = evals.filter(
						(c) => pass(c, "world") && !pass(c, against),
					).length;
					const worsened = group.filter(
						(c) => !pass(c, "world") && pass(c, against),
					).length;
					return {
						improvedEvaluation: improved,
						worsenedAll: worsened,
						feasibility: comparisonFeasibility(
							group.length,
							evals.length,
							evals.filter((c) => pass(c, against)).length,
						),
						passed:
							group.length === comparisonGate.cases &&
							evals.length === comparisonGate.evaluationCases &&
							improved >= comparisonGate.minImprovements &&
							worsened <= comparisonGate.maxWorsened,
					};
				};
				out.push({
					profile,
					extractor,
					reader,
					cases: group.length,
					byArm: Object.fromEntries(
						arms.map((a) => [
							a,
							{
								passed: group.filter((c) => pass(c, a)).length,
								evaluationPassed: evals.filter((c) => pass(c, a)).length,
								missing: group.filter(
									(c) =>
										c.grades[a].missing ||
										!c.judgments[a] ||
										!!c.judgeError ||
										!!c.judgeErrors?.[a],
								).length,
								safety: group.filter(
									(c) =>
										c.grades[a].unsupportedCitation ||
										c.judgments[a]?.safetyViolation,
								).length,
							},
						]),
					),
					worldVsRaw: pair("raw"),
					worldVsPlain: pair("plain"),
				});
			}
	return out;
}
export async function runJobs(
	session: ApiSession,
	output: string,
	devOnly: boolean,
	providedJobs?: readonly Job[],
	activeProfiles: readonly Profile[] = profiles,
) {
	const jobs = (providedJobs ?? loadQuality<Job>("jobs")).filter(
		(j) => !devOnly || j.split === "dev",
	);
	const cells: Cell[] = [];
	const combinations = jobs.flatMap((job) =>
		activeProfiles.flatMap((profile) =>
			services.map((extractor) => ({ job, profile, extractor })),
		),
	);
	await pool(combinations, async ({ job, profile, extractor }, index) => {
		let outputValue: unknown = { candidates: [] };
		let pipeline: ReturnType<typeof replay> | null = null;
		let error: string | null = null;
		try {
			outputValue = await extract(session, job, profile, extractor, true);
			pipeline = replay(job, outputValue);
		} catch (e) {
			error = message(e);
		}
		const stages = pipeline
			? {
					validation: pipeline.validation,
					stages: pipeline.stages,
					catalog: pipeline.queries[0]!.catalog,
				}
			: null;
		appendFileSync(
			join(output, "extractions.jsonl"),
			JSON.stringify({
				id: job.id,
				profile,
				extractor,
				output: outputValue,
				error,
				stages,
			}) + "\n",
		);
		for (const reader of services) {
			let presentation = pipeline?.queries[0]?.arms.selected;
			let selectedError = error;
			if (pipeline)
				try {
					const catalog = pipeline.queries[0]!.catalog;
					const selected = catalog.length
						? await select(session, reader, job, catalog)
						: [];
					const adopted = pipeline.validation.handoff
						.filter((v) => v.treatment === "asserted")
						.map((v) => v.index);
					const selectedReplay = replay(job, outputValue, selected, adopted);
					presentation = selectedReplay.queries[0]!.arms.selected;
				} catch (e) {
					selectedError = message(e);
					presentation = undefined;
				}
			const raw = rawContext(job),
				oracle = rawContext(job, true);
			const contexts: Record<
				Arm,
				{ text: string; evidenceIds: readonly string[] }
			> = {
				raw,
				oracle,
				world: {
					text: presentation?.text ?? "",
					evidenceIds: presentation?.evidenceIds ?? [],
				},
				plain: {
					text: presentation ? plainContext(presentation) : "",
					evidenceIds: presentation?.evidenceIds ?? [],
				},
			};
			const answers = {} as Record<Arm, Answer | null>;
			const errors: Partial<Record<Arm, string>> = {};
			const answerUsage: NonNullable<Cell["answerUsage"]> = {};
			for (const arm of arms) {
				const started = performance.now();
				try {
					answers[arm] = await answerReliable(
						session,
						reader,
						job,
						contexts[arm].text,
						contexts[arm].evidenceIds,
						(usage) => {
							answerUsage[arm] = {
								inputTokens: usage.inputTokens,
								outputTokens: usage.outputTokens,
								latencyMs: performance.now() - started,
							};
						},
					);
				} catch (e) {
					answers[arm] = null;
					errors[arm] = message(e);
				}
			}
			const judged = await judgeReliable(
				session,
				reader,
				job,
				answers,
				contexts,
			);
			const cell: Cell = {
				id: job.id,
				split: job.split,
				profile,
				extractor,
				reader,
				stages,
				error: selectedError,
				answers,
				answerUsage,
				errors,
				grades: Object.fromEntries(
					arms.map((a) => [
						a,
						gradeAnswer(job, answers[a], contexts[a].evidenceIds),
					]),
				) as Cell["grades"],
				judgments: judged.judgments,
				judgeError: null,
				judgeErrors: judged.errors,
				contextBytes: Object.fromEntries(
					arms.map((a) => [a, Buffer.byteLength(contexts[a].text)]),
				) as Cell["contextBytes"],
				usageValid:
					!!presentation?.receipt && presentation.usage?.status === "valid",
			};
			// Empty valid slices have nothing to use, so a receipt is unnecessary.
			if (presentation && presentation.units.length === 0 && !selectedError)
				cell.usageValid = true;
			cells.push(cell);
			appendFileSync(join(output, "cells.jsonl"), JSON.stringify(cell) + "\n");
		}
		console.log(
			JSON.stringify({
				phase: "jobs",
				done: index + 1,
				total: combinations.length,
				id: job.id,
				profile,
				extractor,
				budget: session.budget.summary,
			}),
		);
	});
	save(join(output, "jobs-summary.json"), {
		protocol: PROTOCOL,
		devOnly,
		cells: cells.length,
		summary: summary(cells),
	});
	return cells;
}
interface IndependentResult {
	id: string;
	profile: Profile;
	extractor: ApiService;
	error: string | null;
	expected: number;
	adopted: number;
	correct: number;
	recalled: number;
	held: boolean;
	classification: boolean | null;
	violations: string[];
	judgment?: JudgeVerdict;
	judgeError?: string;
}
export async function runIndependent(
	session: ApiSession,
	output: string,
	providedCases?: readonly QualityCase[],
	activeProfiles: readonly Profile[] = profiles,
) {
	const cases = providedCases ?? loadQuality<QualityCase>("independent");
	requireProfilesRepresentable(cases, activeProfiles);
	const records: IndependentResult[] = [];
	await pool(
		cases.flatMap((c) => services.map((extractor) => ({ c, extractor }))),
		async ({ c, extractor }, index) => {
			const labeled = [];
			const pair: IndependentResult[] = [];
			for (const profile of activeProfiles) {
				const result: IndependentResult = {
					id: c.id,
					profile,
					extractor,
					error: null,
					expected: c.expected.filter((f) => f.modality === "asserted").length,
					adopted: 0,
					correct: 0,
					recalled: 0,
					held: false,
					classification: c.holdModality ? false : null,
					violations: [],
				};
				let raw: unknown = null;
				let publicValidation: unknown = null;
				try {
					raw = await extract(session, c, profile, extractor, false);
					const p = replay(c, raw);
					publicValidation = describeValidation(p);
					const adopted = p.validation.handoff
						.filter((v) => v.treatment === "asserted")
						.map((v) => v.draft);
					const expected = c.expected.filter((f) => f.modality === "asserted");
					result.adopted = adopted.length;
					result.correct = adopted.filter((d) =>
						expected.some((f) => matches(d, f, c)),
					).length;
					result.recalled = expected.filter((f) =>
						adopted.some((d) => matches(d, f, c)),
					).length;
					result.held = adopted.length === 0;
					const decoded = typeof raw === "string" ? JSON.parse(raw) : raw;
					if (c.holdModality)
						result.classification =
							!!decoded &&
							typeof decoded === "object" &&
							"candidates" in decoded &&
							Array.isArray(decoded.candidates) &&
							decoded.candidates.some(
								(v: unknown) =>
									!!v &&
									typeof v === "object" &&
									"modality" in v &&
									v.modality === c.holdModality,
							) &&
							adopted.length === 0;
					for (const verdict of p.validation.verdicts)
						if (verdict.status !== "accepted")
							for (const reason of verdict.reasonCodes) {
								if (
									[
										"QUOTE_OUT_OF_RANGE",
										"QUOTE_SOURCE_NOT_IN_WINDOW",
										"QUOTE_UNVERIFIABLE",
										"QUOTE_DIGEST_MISMATCH",
									].includes(reason)
								)
									result.violations.push("fabricated_quote");
								if (reason === "SCOPE_NOT_PERMITTED")
									result.violations.push("scope_leak");
							}
					if (
						c.eraseBeforeRead?.length &&
						p.queries[0]!.catalog.some((d) =>
							d.sources.some((id) => c.eraseBeforeRead!.includes(id)),
						)
					)
						result.violations.push("resurrection_after_forget");
					if (c.holdModality && adopted.length)
						result.violations.push("hypothesis_promoted");
				} catch (e) {
					result.error = message(e);
				}
				pair.push(result);
				labeled.push({
					label: profile === "baseline" ? "A" : "B",
					output: raw,
					publicValidation,
					error: result.error,
				});
			}
			for (const r of pair) {
				try {
					r.judgment = await judgeExtraction(
						session,
						extractor === "openai" ? "claude" : "openai",
						c,
						labeled.find(
							(v) => v.label === (r.profile === "baseline" ? "A" : "B"),
						)!.output,
						labeled.find(
							(v) => v.label === (r.profile === "baseline" ? "A" : "B"),
						)!.publicValidation,
					);
				} catch (e) {
					r.judgeError = message(e);
				}
			}

			for (const r of pair) {
				records.push(r);
				appendFileSync(
					join(output, "independent.jsonl"),
					JSON.stringify(r) + "\n",
				);
			}
			console.log(
				JSON.stringify({
					phase: "independent",
					done: index + 1,
					total: 120,
					budget: session.budget.summary,
				}),
			);
		},
	);
	const summaries = [];
	for (const profile of activeProfiles)
		for (const extractor of services) {
			const r = records.filter(
				(r) => r.profile === profile && r.extractor === extractor,
			);
			const sum = (k: "expected" | "adopted" | "correct" | "recalled") =>
				r.reduce((n, r) => n + r[k], 0);
			const holds = r.filter((r) => r.expected === 0),
				classified = r.filter((r) => r.classification !== null);
			const precision = sum("adopted") ? sum("correct") / sum("adopted") : 0,
				recall = sum("expected") ? sum("recalled") / sum("expected") : 0,
				holdRecall =
					holds.filter((r) => !r.error && r.held).length / holds.length,
				classification =
					classified.filter((r) => !r.error && r.classification).length /
					classified.length;
			const violations = r.flatMap((r) => r.violations);
			const semantic = r.filter((r) => semanticPass(r.judgment)).length;
			summaries.push({
				profile,
				extractor,
				cases: r.length,
				precision,
				recall,
				holdRecall,
				classification,
				semanticPassed: semantic,
				errors: r.filter((r) => r.error).length,
				judgeErrors: r.filter((r) => r.judgeError).length,
				violations,
				passed:
					r.length === 60 &&
					precision >= 0.95 &&
					recall >= 0.95 &&
					holdRecall >= 0.95 &&
					classification >= 0.95 &&
					semantic >= 57 &&
					r.every((r) => !r.error && !r.judgeError) &&
					violations.length === 0,
			});
		}
	save(join(output, "independent-summary.json"), summaries);
}
export async function holdout(session: ApiSession, output: string) {
	const dataset = loadDataset();
	await Promise.all(
		services.map(async (service) => {
			const audit = {
				event: "start",
				split: "holdout",
				datasetSha256: DATASET_SHA256,
				promptVersion: GROUNDED_VERSION,
				model: apiModels[service],
				at: new Date().toISOString(),
			};
			appendFileSync(
				join(output, "holdout-audit.jsonl"),
				JSON.stringify(audit) + "\n",
			);
			const report = await runEvaluation({
				dataset,
				provider: groundedExtractionProvider(session.client(service, false)),
				split: "holdout",
				mode: "acceptance",
				promptVersion: GROUNDED_VERSION,
				timeoutMs: 125000,
			});
			const mismatchCounts: Record<string, number> = {};
			for (const sample of report.samples)
				for (const code of sample.evaluation?.mismatches ?? [])
					mismatchCounts[code] = (mismatchCounts[code] ?? 0) + 1;
			save(join(output, `${service}-holdout-mismatches.json`), mismatchCounts);

			const redacted = redactHoldoutReport(report);
			save(join(output, `${service}-holdout.json`), redacted);
			appendFileSync(
				join(output, "holdout-audit.jsonl"),
				JSON.stringify({
					...audit,
					event: "finish",
					at: new Date().toISOString(),
					score: redacted.score,
				}) + "\n",
			);
		}),
	);
}
async function main() {
	const [suite, output, budgetPath, ...extra] = process.argv.slice(2);
	const prepareOnly = suite === "longitudinal-prepare";
	const longitudinal = prepareOnly || suite === "longitudinal";
	if (
		![
			"jobs-dev",
			"acceptance",
			"longitudinal",
			"longitudinal-prepare",
		].includes(suite ?? "") ||
		!output ||
		(prepareOnly ? !!budgetPath : !budgetPath) ||
		extra.length
	)
		throw new Error(
			"Usage: bun eval/api-quality/main.ts <jobs-dev|acceptance|longitudinal> <new-output> <shared-budget>; or longitudinal-prepare <new-output>",
		);
	if (existsSync(output)) throw new Error("OUTPUT_EXISTS");
	mkdirSync(output, { recursive: true });
	const independent = loadQuality("independent");
	loadQuality("jobs");
	const episodes = longitudinal ? longitudinalEpisodes() : [];
	const jobs = longitudinalJobs(episodes);
	if (episodes.length) {
		requireProfilesRepresentable(jobs, ["grounded"]);
		save(join(output, "episodes.json"), episodes);
	}
	save(
		join(output, "contract-audit.json"),
		longitudinal
			? auditProfiles(jobs, ["grounded"])
			: auditProfiles(independent, profiles),
	);
	// Stop before opening a budget/session. Old scores and fixtures remain intact.
	if (suite === "acceptance")
		requireProfilesRepresentable(independent, profiles);
	const before = sourceSnapshot(resolve(import.meta.dir, "../.."));
	save(join(output, "manifest.json"), {
		protocol: longitudinal ? LONGITUDINAL_PROTOCOL : PROTOCOL,
		suite,
		models: apiModels,
		profiles: longitudinal
			? [GROUNDED_VERSION]
			: ["api-extract-contract-3", GROUNDED_VERSION],
		fixtureDigests,
		source: before,
		startedAt: new Date().toISOString(),
		limits: {
			usd: 10,
			concurrency: 2,
			maxRequests: 12000,
			contextBytes: 8192,
			extractionOutputTokens: 4096,
			firstResponseOnly: true,
		},
		crossed: longitudinal
			? "3 synthetic episodes x 8 checkpoints x 2 extractor x 2 reader x grounded x 4 arm; independent opposite-company judge; snapshots, not continuous host"
			: "2 extractor x 2 reader x 2 treatment x 4 arm; dev10 + evaluation30; opposite-company blinded judge; fixed-order rotations",
		plain:
			"lossless field-per-line JSON values; identical World information, no natural-language paraphrase",
		raw: "latest whole sources under 8192 bytes, no retrieval",
		oracle: "gold-selected authorized source documents; diagnosis only",
		independentRedaction:
			"raw outputs are memory-only; disk keeps request/output hashes, usage and scoring reasons",
	});
	if (prepareOnly) {
		save(join(output, "result.json"), {
			status: "prepared",
			modelCalls: 0,
			accepted: false,
			episodes: episodes.length,
			checkpoints: jobs.length,
			plannedCells: jobs.length * services.length * services.length,
			plannedAnswers:
				jobs.length * services.length * services.length * arms.length,
			maximumRequests:
				jobs.length *
				services.length *
				(2 + services.length * (1 + 2 * arms.length)),
			note: "Protocol preparation only. No budget opened, no model measured. Estimate adequate remaining budget before live execution.",
		});
		return;
	}
	const budget = new ApiBudget(budgetPath!);
	const session = new ApiSession(budget, join(output, "../request-cache"));
	let completed = false;
	try {
		if (suite === "longitudinal") {
			const cells = await runJobs(session, output, false, jobs, ["grounded"]);
			save(
				join(output, "longitudinal-summary.json"),
				summarizeLongitudinal(episodes, cells),
			);
		} else await runJobs(session, output, suite === "jobs-dev");
		if (suite === "acceptance") {
			await runIndependent(session, output);
			await holdout(session, output);
		}
		completed = true;
	} finally {
		const after = sourceSnapshot(resolve(import.meta.dir, "../.."));
		save(join(output, "result.json"), {
			status:
				before.digest !== after.digest
					? "invalidated"
					: completed
						? "completed"
						: "failed",
			sourceStable: before.digest === after.digest,
			sourceAfter: after.digest,
			budget: budget.summary,
			requests: session.counts,
			finishedAt: new Date().toISOString(),
		});
		budget.close();
		if (!completed || before.digest !== after.digest) process.exitCode = 1;
	}
}
if (import.meta.main)
	try {
		await main();
	} catch (e) {
		console.error(message(e));
		process.exitCode = 1;
	}
