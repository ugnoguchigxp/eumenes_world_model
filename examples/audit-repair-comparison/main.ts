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
	extractionInstructions,
	extractionSchema,
} from "../multi-source-comparison/protocol.ts";
import {
	extractionPrompt,
	interpret,
	persist,
	contexts,
	type AnswerContext,
} from "../multi-source-comparison/world.ts";
import {
	packets,
	questions,
	VERSION,
	type SourceQuestion,
	regressions,
} from "./fixtures.ts";
import {
	arms,
	instructions,
	design,
	presentation,
	schemaFor,
	order,
} from "./protocol.ts";
import { assess, summarize, type Cell } from "./results.ts";
import { review } from "./review.ts";

const { values } = parseArgs({
	options: {
		resume: { type: "string" },
		"prepare-only": { type: "boolean", default: false },
	},
	strict: true,
});
const root = resolve(import.meta.dir, "../..");
const output = values.resume
	? resolve(values.resume)
	: resolve(
			root,
			"artifacts/audit-repair-comparison",
			`${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
		);
mkdirSync(resolve(output, "cache"), { recursive: true });
console.log(`Run: ${output}`);
const codePaths: string[] = [];
for (const folder of [
	"src",
	"examples/linked-answer-holdout",
	"examples/operative-sources-comparison",
	"examples/operative-sources-holdout",
	"examples/applicability-order-comparison",
	"examples/instruction-order-factorial",
	"examples/audit-repair-comparison",
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
	"test/eval/audit-repair.test.ts",
	"package.json",
	"bun.lock",
);
codePaths.sort();
const digests = Object.fromEntries(
	codePaths.map((f) => [f, hash(readFileSync(resolve(root, f)))]),
);
const protocol = {
	version: VERSION,
	model: MODEL,
	reasoningEffort: "medium",
	samplingSeed: null,
	temperature: null,
	runtime: { bun: Bun.version, sdk: "0.163.0" },
	packets,
	questions,
	regressions,
	arms,
	instructions,
	extractionInstructions,
	extractionSchema,
	design,
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
const cells: Cell[] = [];
const extractionCosts: {
	packetId: string;
	status: string;
	inputTokens?: number;
	outputTokens?: number;
	latencyMs?: number;
	error?: string;
}[] = [];
const report = {
	version: VERSION,
	status: "prepared",
	protocolDigest: hash(Buffer.from(protocolText)),
	cells,
	extractionCosts,
	summary: summarize(cells, questions),
	codeUnchanged: true,
};
function checkpoint() {
	cells.sort(
		(a, b) =>
			a.repeat - b.repeat ||
			a.questionId.localeCompare(b.questionId) ||
			a.arm.localeCompare(b.arm),
	);
	report.summary = summarize(cells, questions);
	writeFileSync(
		resolve(output, "report.json"),
		JSON.stringify(report, null, 2),
	);
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
interface Prepared {
	question: SourceQuestion;
	context: AnswerContext;
	history: ReturnType<typeof persist>;
}
const prepared: Prepared[] = regressions.map((c) => ({ ...c, history: [] }));
function failQuestion(question: SourceQuestion, error: string) {
	for (let repeat = 0; repeat < design.repeats; repeat++)
		for (const arm of arms)
			cells.push({
				questionId: question.id,
				packet: question.packet,
				suite: question.suite,
				repeat,
				arm,
				status: "failed",
				error,

				inputTokens: 0,
				outputTokens: 0,
				latencyMs: 0,
			});
}
checkpoint();
if (!values["prepare-only"]) {
	await withLuna(async (run) => {
		for (const packet of packets) {
			console.log(`Extract ${packet.id}`);
			let response: Awaited<ReturnType<typeof call>> | undefined;
			try {
				response = await call(
					`extract-${packet.id}`,
					extractionPrompt(packet),
					extractionSchema,
					run,
				);
				const material = interpret(packet, response.raw);
				const group: Prepared[] = [];
				for (const question of questions.filter(
					(q) => q.packet === packet.id,
				)) {
					const store = openTestStore();
					try {
						const history = store.write((db) =>
							persist(db, material, question.asOf),
						);
						const context = store.read((db) =>
							contexts(db, material, question),
						);
						group.push({ question, context: context.world, history });
					} finally {
						store.close();
					}
				}
				prepared.push(...group);
				extractionCosts.push({
					packetId: packet.id,
					status: "prepared",
					inputTokens: response.inputTokens,
					outputTokens: response.outputTokens,
					latencyMs: response.latencyMs,
				});
			} catch (e) {
				const error = String(e);
				extractionCosts.push({
					packetId: packet.id,
					status: "failed",
					error,
					...(response
						? {
								inputTokens: response.inputTokens,
								outputTokens: response.outputTokens,
								latencyMs: response.latencyMs,
							}
						: {}),
				});
				for (const q of questions.filter((q) => q.packet === packet.id))
					failQuestion(q, error);
			}
			checkpoint();
		}
	}, extractionInstructions);
	writeFileSync(
		resolve(output, "contexts.json"),
		JSON.stringify(prepared, null, 2),
	);
	const jobs = Array.from({ length: design.repeats }, (_, repeat) =>
		prepared.map((item, index) => ({ item, index, repeat })),
	).flat();
	await withLuna(
		(initialRun) =>
			withLuna(async (revisionRun) => {
				let next = 0;
				async function worker() {
					while (next < jobs.length) {
						const { item, index, repeat } = jobs[next++]!;
						const base = {
							questionId: item.question.id,
							packet: item.question.packet,
							suite: item.question.suite,
							repeat,
						};
						let initial: Awaited<ReturnType<typeof call>>;
						try {
							const seed = regressions.find(
								(c) => c.question.id === item.question.id,
							);
							initial = seed
								? {
										raw: seed.seedRaw,
										inputTokens: 0,
										outputTokens: 0,
										latencyMs: 0,
									}
								: await call(
										`initial-${item.question.id}-${repeat}`,
										presentation(item.question, item.context),
										schemaFor(item.context),
										initialRun,
									);
						} catch (e) {
							for (const arm of arms)
								cells.push({
									...base,
									arm,
									status: "failed",
									error: String(e),
									inputTokens: 0,
									outputTokens: 0,
									latencyMs: 0,
								});
							checkpoint();
							continue;
						}
						for (const arm of ["baseline", ...order(index, repeat)] as const) {
							let response: Awaited<ReturnType<typeof review>> | undefined;
							try {
								response = await review(
									item.question,
									item.context,
									initial,
									arm,
									(prompt, schema) =>
										call(
											`repair-${item.question.id}-${repeat}-${arm}`,
											prompt,
											schema,
											revisionRun,
										),
								);
								const {
									raw,
									inputTokens,
									outputTokens,
									latencyMs,
									...details
								} = response;
								cells.push({
									...base,
									arm,
									status: "answered",
									raw,
									review: details,
									score: assess(item.question, item.context, arm, raw),
									inputTokens,
									outputTokens,
									latencyMs,
								});
							} catch (e) {
								cells.push({
									...base,
									arm,
									status: "failed",
									error: String(e),
									...(response ? { raw: response.raw } : {}),
									inputTokens: response?.inputTokens ?? initial.inputTokens,
									outputTokens: response?.outputTokens ?? initial.outputTokens,
									latencyMs: response?.latencyMs ?? initial.latencyMs,
								});
							}
							report.status = "running";
							checkpoint();
							console.log(
								`${cells.length}/${design.plannedEndpoints} ${item.question.id}/${repeat}/${arm}`,
							);
						}
					}
				}
				await Promise.all([worker(), worker()]);
			}, instructions.revision),
		instructions.initial,
	);
	report.codeUnchanged = codePaths.every(
		(f) => hash(readFileSync(resolve(root, f))) === digests[f],
	);
	report.status = !report.codeUnchanged
		? "invalidated-source-change"
		: cells.length !== design.plannedEndpoints
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
