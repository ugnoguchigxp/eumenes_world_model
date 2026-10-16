import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { asRecord } from "../../src/index.ts";
import { hash } from "../../eval/seed/corpus.ts";
import { openTestStore } from "../../test/support/sqlite-store.ts";
import { MODEL, withLuna, type LunaResult } from "../seed-luna/luna.ts";
import { VERSION, arms, packets, questions } from "./fixtures.ts";
import {
	answerInstructions,
	answerSchema,
	answerSchemaFor,
	extractionInstructions,
	extractionSchema,
} from "./protocol.ts";
import {
	answerPrompt,
	contexts,
	extractionPrompt,
	interpret,
	persist,
} from "./world.ts";
import { order, score, summarize, type Cell } from "./results.ts";
import {
	auditGrounding,
	parseGroundedAnswer,
	type GroundingAudit,
} from "./grounding.ts";

const { values } = parseArgs({
	options: {
		resume: { type: "string" },
		"extraction-run": { type: "string" },
		repeats: { type: "string", default: "2" },
		"prepare-only": { type: "boolean", default: false },
	},
	strict: true,
});
const repeats = Number(values.repeats);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3)
	throw new Error("repeats must be 1..3");
const output = values.resume
	? resolve(values.resume)
	: resolve(
			import.meta.dir,
			"../../artifacts/multi-source-comparison",
			`${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
		);
await mkdir(resolve(output, "cache"), { recursive: true });
console.log(`Run: ${output}`);
const extractionDirectory = values["extraction-run"]
	? resolve(values["extraction-run"])
	: null;
let reusedExtraction: unknown = null;
if (extractionDirectory) {
	const bytes = await readFile(resolve(extractionDirectory, "protocol.json"));
	const prior = asRecord(JSON.parse(bytes.toString("utf8")));
	const priorReport = asRecord(
		JSON.parse(
			await readFile(resolve(extractionDirectory, "report.json"), "utf8"),
		),
	);
	if (
		!prior ||
		prior["model"] !== MODEL ||
		JSON.stringify(prior["packets"]) !== JSON.stringify(packets) ||
		prior["extractionInstructions"] !== extractionInstructions ||
		JSON.stringify(prior["extractionSchema"]) !==
			JSON.stringify(extractionSchema) ||
		priorReport?.["status"] !== "completed" ||
		priorReport["protocolDigest"] !== hash(bytes)
	)
		throw new Error("extraction_provenance_mismatch");
	reusedExtraction = {
		directory: extractionDirectory,
		protocolDigest: hash(bytes),
		responseDigests: Object.fromEntries(
			await Promise.all(
				packets.map(async (packet) => [
					packet.id,
					hash(
						await readFile(
							resolve(
								extractionDirectory,
								"cache",
								`extract-${packet.id}.json`,
							),
						),
					),
				]),
			),
		),
	};
}
const coreFiles: string[] = [];
for await (const file of new Bun.Glob("**/*.ts").scan({
	cwd: resolve(import.meta.dir, "../../src"),
}))
	coreFiles.push(`../../src/${file}`);
coreFiles.sort();
const codeDigests = Object.fromEntries(
	await Promise.all(
		[
			"fixtures.ts",
			"protocol.ts",
			"world.ts",
			"results.ts",
			"grounding.ts",
			"prior-inconsistencies.json",
			"prior-explanation-error.json",
			"main.ts",
			"../seed-luna/luna.ts",
			"../seed-luna/pipeline.ts",
			"../seed-luna/quotes.ts",
			"../seed-luna/schema.ts",
			"../../eval/seed/corpus.ts",
			"../../test/support/sqlite-store.ts",
			...coreFiles,
		].map(async (file) => [
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
	repeats,
	arms,
	packets,
	questions,
	extractionInstructions,
	extractionSchema,
	answerInstructions,
	answerSchema,
	reusedExtraction,
	runtime: { bun: Bun.version, sdk: "0.163.0" },
	codeDigests,
	design: {
		synthetic: true,
		seedCorpusModified: false,
		extractionQuestionBlind: true,
		manualWorldClaims: false,
		adoptedAssertions: 0,
		plannedExtractions: packets.length,
		plannedAnswers: questions.length * repeats * arms.length,
		maxObservationAgeMs: 3_600_000,
		inputParity:
			"same full sources, key definitions, observations, availability index, ISO and epoch clock; world adds derived view and existing-engine atomic comparison checks only",
		sourceIdContract:
			"output-schema enum contains exactly supplied document IDs; common runtime instruction has no source ID",
		groundingContract:
			"LLM selects applicable rules and emits evidence receipts and explanation before final decision. Host audits copied calculations and declared consistency; no answer rewriting or retry.",
		scoring:
			"pre-frozen decision plus exact governing-source set; explanation manually reviewed separately",
	},
};
const protocolText = JSON.stringify(protocol, null, 2);
const protocolPath = resolve(output, "protocol.json");
if (values.resume) {
	if ((await readFile(protocolPath, "utf8")) !== protocolText)
		throw new Error("frozen_protocol_changed");
} else await writeFile(protocolPath, protocolText, { flag: "wx" });
const cells: (Cell & { grounding: GroundingAudit })[] = [];
const extractionCosts: unknown[] = [];
const report: Record<string, unknown> = {
	status: "preparing",
	version: VERSION,
	model: MODEL,
	protocolDigest: hash(Buffer.from(protocolText)),
	cells,
	extractionCosts,
};
const checkpoint = () =>
	writeFile(
		resolve(output, "report.json"),
		JSON.stringify(
			{
				...report,
				summary: summarize(cells),
				groundingSummary: Object.fromEntries(
					arms.map((arm) => {
						const rows = cells.filter((cell) => cell.arm === arm);
						return [
							arm,
							{
								answers: rows.length,
								passed: rows.filter((cell) => cell.grounding.passed).length,
								comparedCalculations: rows.reduce(
									(n, cell) => n + cell.grounding.comparedCalculations,
									0,
								),
								calculationMismatches: rows.reduce(
									(n, cell) => n + cell.grounding.calculationMismatches,
									0,
								),
								decisionMismatches: rows.filter(
									(cell) => !cell.grounding.decisionConsistent,
								).length,
								overrides: rows.filter(
									(cell) => cell.grounding.overrides.length,
								).length,
							},
						];
					}),
				),
			},
			null,
			2,
		),
	);
type Run = (prompt: string, schema: unknown) => Promise<LunaResult>;
async function call(key: string, prompt: string, schema: unknown, run: Run) {
	const path = resolve(output, "cache", `${key}.json`);
	const requestDigest = hash(Buffer.from(JSON.stringify({ prompt, schema })));
	const ownCache = await Bun.file(path).exists();
	const inheritedPath =
		extractionDirectory && key.startsWith("extract-")
			? resolve(extractionDirectory, "cache", `${key}.json`)
			: null;
	if (ownCache || inheritedPath) {
		const bytes = await readFile(ownCache ? path : inheritedPath!);
		const value = asRecord(JSON.parse(bytes.toString("utf8")));
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
			throw new Error(`cache_mismatch:${key}`);
		if (!ownCache) {
			await writeFile(path, bytes, { flag: "wx" });
			await writeFile(
				resolve(output, "cache", `${key}-request.json`),
				JSON.stringify({ prompt, schema, requestDigest }, null, 2),
			);
			await appendFile(
				resolve(output, "events.jsonl"),
				`${JSON.stringify({ key, event: "reused-extraction", from: inheritedPath, digest: hash(bytes), at: new Date().toISOString() })}\n`,
			);
		}
		return {
			raw: response["raw"],
			latencyMs: value["latencyMs"],
			usage: {
				input_tokens: usage["input_tokens"],
				output_tokens: usage["output_tokens"],
			},
		};
	}
	await writeFile(
		resolve(output, "cache", `${key}-request.json`),
		JSON.stringify({ prompt, schema, requestDigest }, null, 2),
	);
	const event = (event: string, extra: object = {}) =>
		appendFile(
			resolve(output, "events.jsonl"),
			`${JSON.stringify({ key, event, at: new Date().toISOString(), ...extra })}\n`,
		);
	await event("started");
	const start = performance.now();
	try {
		const response = await run(prompt, schema);
		if (!response.usage) throw new Error("missing_usage");
		const latencyMs = performance.now() - start;
		await writeFile(
			path,
			JSON.stringify({ requestDigest, response, latencyMs }, null, 2),
			{ flag: "wx" },
		);
		await event("completed", { latencyMs });
		return { ...response, usage: response.usage, latencyMs };
	} catch (error) {
		await event("failed", {
			message: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}
try {
	if (values["prepare-only"]) {
		// Freezes sources, prompts and oracle; does not simulate model extraction.
		report["status"] = "prepared-model-not-run";
	} else
		await withLuna(async (extractRun) => {
			const materials = new Map<string, ReturnType<typeof interpret>>();
			for (const packet of packets) {
				console.log(`Extract ${packet.id}`);
				const response = await call(
					`extract-${packet.id}`,
					extractionPrompt(packet),
					extractionSchema,
					extractRun,
				);
				materials.set(packet.id, interpret(packet, response.raw));
				extractionCosts.push({
					packetId: packet.id,
					latencyMs: response.latencyMs,
					usage: response.usage,
					reused: extractionDirectory !== null,
				});
				await checkpoint();
			}
			const prepared = questions.map((question) => {
				const material = materials.get(question.packet)!;
				const store = openTestStore();
				try {
					const history = store.write((db) =>
						persist(db, material, question.asOf),
					);
					const context = store.read((db) => contexts(db, material, question));
					return { question, context, history };
				} finally {
					store.close();
				}
			});
			await writeFile(
				resolve(output, "contexts.json"),
				JSON.stringify(prepared, null, 2),
			);
			await withLuna(async (answerRun) => {
				report["status"] = "running";
				for (let repeat = 0; repeat < repeats; repeat++)
					for (const [index, item] of prepared.entries())
						for (const arm of order(index, repeat)) {
							const key = `answer-${item.question.id}-${repeat}-${arm}`;
							console.log(
								`${cells.length + 1}/${protocol.design.plannedAnswers} ${key}`,
							);
							const response = await call(
								key,
								answerPrompt(item.question, item.context[arm]),
								answerSchemaFor(
									item.context[arm].sources.map((source) => source.id),
									item.context[arm].derivedView?.slice.units.map(
										(unit) => unit.assertionId,
									) ?? null,
								),
								answerRun,
							);
							const answer = parseGroundedAnswer(response.raw);
							cells.push({
								questionId: item.question.id,
								repeat,
								arm,
								answer,
								grounding: auditGrounding(answer, item.context[arm]),
								...score(item.question, answer),
								latencyMs: response.latencyMs,
								inputTokens: response.usage.input_tokens,
								outputTokens: response.usage.output_tokens,
							});
							await checkpoint();
						}
			}, answerInstructions);
			if (cells.length !== protocol.design.plannedAnswers)
				throw new Error("incomplete_run");
			report["status"] = "completed";
		}, extractionInstructions);
} catch (error) {
	report["status"] = "failed";
	report["error"] = error instanceof Error ? error.message : String(error);
	process.exitCode = 1;
} finally {
	await checkpoint();
	console.log(`Result: ${resolve(output, "report.json")}`);
}
