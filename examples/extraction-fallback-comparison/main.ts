import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	writeFileSync,
	existsSync,
	appendFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { parseArgs } from "node:util";
import { hash } from "../../eval/seed/corpus.ts";
import { asRecord } from "../../src/index.ts";
import { openTestStore } from "../../test/support/sqlite-store.ts";
import { MODEL, withLuna, type LunaResult } from "../seed-luna/luna.ts";
import {
	answerInstructions,
	answerSchemaFor,
} from "../multi-source-comparison/protocol.ts";
import {
	interpret,
	persist,
	contexts,
	answerPrompt,
	type AnswerContext,
} from "../multi-source-comparison/world.ts";
import { assess } from "../linked-answer-holdout/results.ts";
import {
	scenarios as sourceScenarios,
	design as sourceDesign,
	VERSION,
} from "./fixtures.ts";
import { retryScenarios, retryDesign } from "./retry-fixtures.ts";
import { retryExtraction, retryInstructions } from "./retry.ts";
import { recover } from "./recovery.ts";
const { values } = parseArgs({
	options: {
		resume: { type: "string" },
		recovery: { type: "string", default: "source-only" },
		"prepare-only": { type: "boolean", default: false },
	},
	strict: true,
});
if (!["source-only", "reextract"].includes(values.recovery))
	throw new Error("invalid_recovery_mode");
const scenarios =
	values.recovery === "reextract" ? retryScenarios : sourceScenarios;
const design = values.recovery === "reextract" ? retryDesign : sourceDesign;
const root = resolve(import.meta.dir, "../..");
const output = values.resume
	? resolve(values.resume)
	: resolve(
			root,
			"artifacts/extraction-fallback-comparison",
			`${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
		);
mkdirSync(resolve(output, "cache"), { recursive: true });
console.log(`Run: ${output}`);
const codePaths: string[] = [];
for (const folder of [
	"src",
	"examples/linked-answer-holdout",
	"examples/source-role-comparison",
	"examples/extraction-fallback-comparison",
	"examples/multi-source-comparison",
	"examples/seed-luna",
])
	for await (const file of new Bun.Glob("**/*.{ts,json}").scan({
		cwd: resolve(root, folder),
	}))
		codePaths.push(`${folder}/${file}`);
codePaths.push(
	"eval/seed/corpus.ts",
	"test/support/sqlite-store.ts",
	"package.json",
	"bun.lock",
);
codePaths.sort();
const digests = Object.fromEntries(
	codePaths.map((f) => [f, hash(readFileSync(resolve(root, f)))]),
);
const protocol = {
	version: VERSION,
	recovery: values.recovery,
	retryInstructions: values.recovery === "reextract" ? retryInstructions : null,
	model: MODEL,
	reasoningEffort: "medium",
	samplingSeed: null,
	temperature: null,
	runtime: { bun: Bun.version, sdk: "0.163.0" },
	scenarios,
	design,
	answerInstructions,
	codeDigests: digests,
};
const protocolText = JSON.stringify(protocol, null, 2);
const protoPath = resolve(output, "protocol.json");
if (values.resume) {
	if (readFileSync(protoPath, "utf8") !== protocolText)
		throw new Error("frozen_protocol_changed");
} else {
	writeFileSync(protoPath, protocolText, { flag: "wx" });
	for (const f of codePaths) {
		const dest = resolve(output, "frozen-code", f);
		mkdirSync(dirname(dest), { recursive: true });
		writeFileSync(dest, readFileSync(resolve(root, f)), { flag: "wx" });
	}
}
type Run = (prompt: string, schema: unknown) => Promise<LunaResult>;
let newCalls = 0;
let reused = 0;
async function call(key: string, prompt: string, schema: unknown, run: Run) {
	const file = resolve(output, "cache", `${key}.json`);
	const failure = resolve(output, "cache", `${key}-failure.json`);
	const requestDigest = hash(Buffer.from(JSON.stringify({ prompt, schema })));
	if (existsSync(failure))
		throw new Error(JSON.parse(readFileSync(failure, "utf8")).error as string);
	if (existsSync(file)) {
		const v = asRecord(JSON.parse(readFileSync(file, "utf8")));
		const response = asRecord(v?.["response"]);
		const usage = asRecord(response?.["usage"]);
		if (
			v?.["requestDigest"] !== requestDigest ||
			typeof v?.["latencyMs"] !== "number" ||
			typeof response?.["raw"] !== "string" ||
			typeof usage?.["input_tokens"] !== "number" ||
			typeof usage?.["output_tokens"] !== "number"
		)
			throw new Error("invalid_cache");
		reused++;
		return {
			raw: response["raw"],
			inputTokens: usage["input_tokens"],
			outputTokens: usage["output_tokens"],
			latencyMs: v["latencyMs"],
		};
	}
	writeFileSync(
		resolve(output, "cache", `${key}-request.json`),
		JSON.stringify({ prompt, schema, requestDigest }, null, 2),
	);
	const event = (event: string, error?: string) =>
		appendFileSync(
			resolve(output, "events.jsonl"),
			JSON.stringify({
				key,
				event,
				at: new Date().toISOString(),
				...(error ? { error } : {}),
			}) + "\n",
		);
	event("started");
	const start = performance.now();
	newCalls++;
	try {
		const response = await run(prompt, schema);
		if (!response.usage) throw new Error("usage_missing");
		const latencyMs = performance.now() - start;
		writeFileSync(
			file,
			JSON.stringify({ requestDigest, response, latencyMs }, null, 2),
			{ flag: "wx" },
		);
		event("completed");
		return {
			raw: response.raw,
			inputTokens: response.usage.input_tokens,
			outputTokens: response.usage.output_tokens,
			latencyMs,
		};
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		writeFileSync(failure, JSON.stringify({ requestDigest, error }), {
			flag: "wx",
		});
		event("failed", error);
		throw e;
	}
}
type Arm = (typeof design.arms)[number];
type Score = ReturnType<typeof assess>;
interface Cell {
	scenario: string;
	questionId: string;
	arm: Arm;
	repeat: number;
	mode?: string;
	status: "answered" | "blocked" | "failed";
	error?: string;
	score?: Score;
	inputTokens: number;
	outputTokens: number;
	latencyMs: number;
}
const cells: Cell[] = [];
function summary() {
	return Object.fromEntries(
		design.arms.map((arm) => {
			const rows = cells.filter((c) => c.arm === arm);
			return [
				arm,
				{
					planned:
						scenarios.reduce((n, s) => n + s.questions.length, 0) *
						design.repeats,
					answered: rows.filter((c) => c.status === "answered").length,
					blocked: rows.filter((c) => c.status === "blocked").length,
					failed: rows.filter((c) => c.status === "failed").length,
					decisionCorrect: rows.filter((c) => c.score?.decisionCorrect).length,
					primaryCorrect: rows.filter(
						(c) =>
							c.score?.jointCorrect &&
							c.score?.assessmentsCorrect &&
							c.score?.grounding?.passed,
					).length,
					falseAllow: rows.filter((c) => c.score?.falseAllow).length,
					inputTokens: rows.reduce((n, c) => n + c.inputTokens, 0),
					outputTokens: rows.reduce((n, c) => n + c.outputTokens, 0),
					meanLatencyMs:
						rows
							.filter((c) => c.status === "answered")
							.reduce((n, c) => n + c.latencyMs, 0) /
						(rows.filter((c) => c.status === "answered").length || 1),
				},
			];
		}),
	);
}
const report = {
	version: VERSION,
	status: "prepared",
	protocolDigest: hash(Buffer.from(protocolText)),
	cells,
	summary: summary(),
	codeUnchanged: true,
};
function checkpoint() {
	cells.sort(
		(a, b) =>
			a.repeat - b.repeat ||
			a.questionId.localeCompare(b.questionId) ||
			a.arm.localeCompare(b.arm),
	);
	report.summary = summary();
	writeFileSync(
		resolve(output, "report.json"),
		JSON.stringify(report, null, 2),
	);
}
checkpoint();
if (!values["prepare-only"]) {
	const prepared: {
		scenario: string;
		arm: Arm;
		question: (typeof scenarios)[number]["questions"][number];
		context: AnswerContext;
		mode: string;
	}[] = [];
	const diagnostics: unknown[] = [];
	await withLuna(async (repairRun) => {
		for (const s of scenarios)
			for (const arm of design.arms) {
				try {
					const recovery =
						arm === "retry-v5"
							? {
									mode: "world" as const,
									...(await retryExtraction(s.packet, s.raw, (prompt, schema) =>
										call(`retry-${s.id}`, prompt, schema, repairRun),
									)),
								}
							: arm === "fallback-v5"
								? recover(s.packet, s.raw)
								: {
										mode: "world" as const,
										material: interpret(s.packet, s.raw),
									};
					diagnostics.push({
						scenario: s.id,
						arm,
						mode: recovery.mode,
						...("diagnostics" in recovery
							? { documents: recovery.diagnostics }
							: {}),
					});
					for (const question of s.questions) {
						let context: AnswerContext;
						if (recovery.mode === "source-only") context = recovery.context;
						else {
							const store = openTestStore();
							try {
								store.write((db) =>
									persist(db, recovery.material, question.asOf),
								);
								context = store.read(
									(db) => contexts(db, recovery.material, question).world,
								);
							} finally {
								store.close();
							}
						}
						prepared.push({
							scenario: s.id,
							arm,
							question,
							context,
							mode: recovery.mode,
						});
					}
				} catch (e) {
					for (const question of s.questions)
						for (let repeat = 0; repeat < design.repeats; repeat++)
							cells.push({
								scenario: s.id,
								arm,
								questionId: question.id,
								repeat,
								status:
									arm === "strict-v5" &&
									e instanceof Error &&
									e.message.startsWith("extraction_not_one_valid_candidate:")
										? "blocked"
										: "failed",
								error: String(e),
								inputTokens: 0,
								outputTokens: 0,
								latencyMs: 0,
							});
				}
			}
	}, retryInstructions);
	writeFileSync(
		resolve(output, "contexts.json"),
		JSON.stringify({ prepared, diagnostics }, null, 2),
	);
	const pairs = scenarios.flatMap((s) =>
		s.questions.map((question) => ({ scenario: s.id, question })),
	);
	const jobs = Array.from({ length: design.repeats }, (_, repeat) =>
		pairs.map((pair, index) => ({ ...pair, index, repeat })),
	).flat();
	await withLuna(async (run) => {
		let next = 0;
		async function worker() {
			while (next < jobs.length) {
				const job = jobs[next++]!;
				const order =
					(job.index + job.repeat) % 2
						? [...design.arms].reverse()
						: design.arms;
				for (const arm of order) {
					const item = prepared.find(
						(p) =>
							p.scenario === job.scenario &&
							p.question.id === job.question.id &&
							p.arm === arm,
					);
					if (!item) continue;
					let response: Awaited<ReturnType<typeof call>> | undefined;
					const base = {
						scenario: job.scenario,
						questionId: item.question.id,
						arm,
						repeat: job.repeat,
						mode: item.mode,
					};
					try {
						response = await call(
							`answer-${item.question.id}-${job.repeat}-${arm}`,
							answerPrompt(item.question, item.context),
							answerSchemaFor(
								item.context.sources.map((s) => s.id),
								item.context.derivedView?.slice.units.map(
									(u) => u.assertionId,
								) ?? null,
							),
							run,
						);
						cells.push({
							...base,
							status: "answered",
							score: assess(
								item.question,
								item.context,
								"linked",
								response.raw,
							),
							inputTokens: response.inputTokens,
							outputTokens: response.outputTokens,
							latencyMs: response.latencyMs,
						});
					} catch (e) {
						cells.push({
							...base,
							status: "failed",
							error: String(e),
							inputTokens: response?.inputTokens ?? 0,
							outputTokens: response?.outputTokens ?? 0,
							latencyMs: response?.latencyMs ?? 0,
						});
					}
					report.status = "running";
					checkpoint();
					console.log(
						`${cells.length}/${design.plannedCells} ${item.question.id}/${job.repeat}/${arm}`,
					);
				}
			}
		}
		await Promise.all([worker(), worker()]);
	}, answerInstructions);
	report.codeUnchanged = codePaths.every(
		(f) => hash(readFileSync(resolve(root, f))) === digests[f],
	);
	report.status = !report.codeUnchanged
		? "invalidated-source-change"
		: cells.length !== design.plannedCells
			? "incomplete"
			: cells.some((c) => c.status === "failed")
				? "completed-with-failures"
				: "completed";
	checkpoint();
	if (report.status !== "completed") process.exitCode = 1;
}
console.log(
	JSON.stringify({
		status: report.status,
		newCalls,
		reused,
		report: resolve(output, "report.json"),
	}),
);
