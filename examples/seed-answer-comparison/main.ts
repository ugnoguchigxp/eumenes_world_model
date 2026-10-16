import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { asRecord } from "../../src/index.ts";
import { hash, loadSeed } from "../../eval/seed/corpus.ts";
import { openTestStore } from "../../test/support/sqlite-store.ts";
import { MODEL, withLuna, type LunaResult } from "../seed-luna/luna.ts";
import { persistCandidates } from "../seed-luna/pipeline.ts";
import { answerPrompt, contexts, loadMaterials } from "./material.ts";
import {
	VERSION,
	answerInstructions,
	answerSchema,
	arms,
	judgeInstructions,
	judgeSchema,
	questions,
} from "./protocol.ts";
import {
	judgeMapping,
	order,
	parseAnswer,
	parseJudgement,
	summarize,
	type Cell,
	type Judgement,
} from "./results.ts";

const { values } = parseArgs({
	options: {
		"extraction-run": { type: "string" },
		resume: { type: "string" },
		repeats: { type: "string", default: "2" },
		"prepare-only": { type: "boolean", default: false },
	},
	strict: true,
});
if (!values["extraction-run"])
	throw new Error(
		"--extraction-run <completed seed-luna run directory> is required",
	);
const repeats = Number(values.repeats);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3)
	throw new Error("repeats must be 1..3");
const root = resolve(import.meta.dir, "../..");
const output = values.resume
	? resolve(values.resume)
	: resolve(
			root,
			"artifacts/seed-answer-comparison",
			`${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
		);
await mkdir(resolve(output, "cache"), { recursive: true });
const protocolPath = resolve(output, "protocol.json");
const prior = values.resume
	? asRecord(JSON.parse(await readFile(protocolPath, "utf8")))
	: undefined;
const asOf = prior?.["asOf"] ?? Date.now();
if (typeof asOf !== "number" || !Number.isSafeInteger(asOf))
	throw new Error("comparison_invalid_clock");
const cells: Cell[] = [];
const judgements: Judgement[] = [];
const report: Record<string, unknown> = {
	version: VERSION,
	model: MODEL,
	status: "preparing",
	cells,
	judgements,
};
const checkpoint = async () => {
	report["summary"] = summarize(cells, judgements);
	await writeFile(
		resolve(output, "report.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
};

type Run = (prompt: string, schema: unknown) => Promise<LunaResult>;
async function cachedCall(
	key: string,
	prompt: string,
	schema: unknown,
	run: Run,
) {
	const path = resolve(output, "cache", `${key}.json`);
	const requestDigest = hash(Buffer.from(JSON.stringify({ prompt, schema })));
	if (await Bun.file(path).exists()) {
		const value = asRecord(JSON.parse(await readFile(path, "utf8")));
		const response = asRecord(value?.["response"]);
		const usage = asRecord(response?.["usage"]);
		if (
			!value ||
			value["requestDigest"] !== requestDigest ||
			!response ||
			typeof response["raw"] !== "string" ||
			typeof value["latencyMs"] !== "number" ||
			!usage ||
			typeof usage["input_tokens"] !== "number" ||
			typeof usage["output_tokens"] !== "number"
		)
			throw new Error(`comparison_cache_mismatch:${key}`);
		return {
			raw: response["raw"],
			usage: {
				input_tokens: usage["input_tokens"],
				output_tokens: usage["output_tokens"],
			},
			latencyMs: value["latencyMs"],
		};
	}
	await writeFile(
		resolve(output, "cache", `${key}-request.json`),
		JSON.stringify({ prompt, schema, requestDigest }, null, 2),
	);
	await appendFile(
		resolve(output, "events.jsonl"),
		`${JSON.stringify({ key, event: "started", at: new Date().toISOString() })}\n`,
	);
	const start = performance.now();
	try {
		const response = await run(prompt, schema);
		const latencyMs = performance.now() - start;
		if (!response.usage) throw new Error("comparison_missing_usage");
		await writeFile(
			path,
			JSON.stringify({ requestDigest, response, latencyMs }, null, 2),
			{ flag: "wx" },
		);
		await appendFile(
			resolve(output, "events.jsonl"),
			`${JSON.stringify({ key, event: "completed", latencyMs, at: new Date().toISOString() })}\n`,
		);
		return { ...response, usage: response.usage, latencyMs };
	} catch (error) {
		await appendFile(
			resolve(output, "events.jsonl"),
			`${JSON.stringify({ key, event: "failed", at: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) })}\n`,
		);
		throw error;
	}
}

try {
	const corpus = await loadSeed(
		resolve(root, "data/worldmodel-corpus/seed/v1.json"),
	);
	const loaded = await loadMaterials(
		corpus,
		resolve(values["extraction-run"]),
		asOf,
	);
	const codeFiles = [
		"../seed-luna/luna.ts",
		"../seed-luna/pipeline.ts",
		"../seed-luna/quotes.ts",
		"protocol.ts",
		"material.ts",
		"results.ts",
		"main.ts",
	];
	const codeDigests = Object.fromEntries(
		await Promise.all(
			codeFiles.map(async (file) => [
				file,
				hash(await readFile(resolve(import.meta.dir, file))),
			]),
		),
	);
	const protocol = {
		version: VERSION,
		model: MODEL,
		reasoningEffort: "medium",
		temperature: null,
		samplingSeed: null,
		asOf,
		repeats,
		arms,
		questions,
		answerInstructions,
		answerSchema,
		judgeInstructions,
		judgeSchema,
		seedId: corpus.seedId,
		manifestDigest: corpus.manifestDigest,
		extractionReportDigest: loaded.extractionReportDigest,
		responseDigests: loaded.responseDigests,
		codeDigests,
		design: {
			oracleSources: true,
			sourceGroups: 5,
			answerCalls: questions.length * repeats * arms.length,
			judgeCalls: questions.length * repeats,
			adoptedAssertions: 0,
		},
	};
	const protocolText = JSON.stringify(protocol, null, 2);
	if (prior && JSON.stringify(prior) !== JSON.stringify(protocol))
		throw new Error("comparison_frozen_protocol_changed");
	if (!prior) await writeFile(protocolPath, protocolText, { flag: "wx" });
	report["protocolDigest"] = hash(Buffer.from(protocolText));
	report["plannedAnswerCalls"] = protocol.design.answerCalls;
	report["plannedJudgeCalls"] = protocol.design.judgeCalls;
	const store = openTestStore();
	try {
		for (const material of loaded.materials.values())
			store.write((db) =>
				persistCandidates(
					db,
					material.entity,
					material.checked.state,
					material.checked.assertions,
					asOf,
				),
			);
		const prepared = questions.map((question) => {
			const material = loaded.materials.get(question.recordId);
			if (!material) throw new Error("comparison_missing_material");
			const context = store.read((db) =>
				contexts(db, question, material, asOf),
			);
			return { question, context };
		});
		await writeFile(
			resolve(output, "contexts.json"),
			JSON.stringify(prepared, null, 2),
		);
		await checkpoint();
		if (values["prepare-only"]) report["status"] = "prepared-model-not-run";
		else
			await withLuna(
				async (answerRun) =>
					withLuna(async (judgeRun) => {
						report["status"] = "running";
						for (let repeat = 0; repeat < repeats; repeat++)
							for (const [index, item] of prepared.entries()) {
								const { question, context } = item;
								const group: Cell[] = [];
								for (const arm of order(index, repeat)) {
									const key = `answer-${question.id}-${repeat}-${arm}`;
									console.log(
										`${cells.length + 1}/${protocol.design.answerCalls} ${key}`,
									);
									const response = await cachedCall(
										key,
										answerPrompt(question, context[arm]),
										answerSchema,
										answerRun,
									);
									const answer = parseAnswer(response.raw);
									const allowed = arm === "no-seed" ? [] : [question.recordId];
									const cell: Cell = {
										questionId: question.id,
										repeat,
										arm,
										answer,
										latencyMs: response.latencyMs,
										inputTokens: response.usage.input_tokens,
										outputTokens: response.usage.output_tokens,
										citationsValid: answer.citations.every((id) =>
											allowed.includes(id),
										),
									};
									cells.push(cell);
									group.push(cell);
									await checkpoint();
								}
								const mapping = judgeMapping(index, repeat);
								const blindAnswers = Object.entries(mapping).map(
									([label, arm]) => ({
										label,
										...group.find((cell) => cell.arm === arm)!.answer,
									}),
								);
								const prompt = JSON.stringify({
									question: question.question,
									expected: question.expected,
									sources: context["raw-seed"],
									answers: blindAnswers,
								});
								const response = await cachedCall(
									`judge-${question.id}-${repeat}`,
									prompt,
									judgeSchema,
									judgeRun,
								);
								judgements.push({
									questionId: question.id,
									repeat,
									mapping,
									grades: parseJudgement(response.raw, mapping),
								});
								await checkpoint();
							}
						if (
							cells.length !== protocol.design.answerCalls ||
							judgements.length !== protocol.design.judgeCalls
						)
							throw new Error("comparison_incomplete_run");
						report["status"] = "completed";
					}, judgeInstructions),
				answerInstructions,
			);
	} finally {
		store.close();
	}
} catch (error) {
	report["status"] = "failed";
	report["error"] = error instanceof Error ? error.message : String(error);
	process.exitCode = 1;
} finally {
	await checkpoint();
	console.log(`Result: ${resolve(output, "report.json")}`);
}
