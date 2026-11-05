/** Explicit paid lane; ordinary verify never calls this entry point. */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ApiBudget, EvaluationApi, apiModels } from "./client.ts";
import { extractionProvider } from "./extraction-provider.ts";
import {
	loadDataset,
	DATASET_SHA256,
	EVALUATION_VERSION,
} from "../extraction/dataset.ts";
import { runEvaluation } from "../extraction/runner.ts";
import { redactHoldoutReport } from "../extraction/main.ts";
import { EXTRACTION_INSTRUCTION_VERSION } from "../extraction/providers.ts";
import { API_EXTRACTION_VERSION } from "./extraction-schema.ts";
import {
	GROUNDED_VERSION,
	groundedExtractionProvider,
} from "./grounded-extraction.ts";
import { loadTasks } from "../decision/tasks.ts";
import { runDecisionEval } from "../decision/runner.ts";
import { buildPrompt } from "../decision/real-provider.ts";
import { sourceSnapshot } from "../measurement/run.ts";
const answerSchema = {
	type: "object",
	properties: {
		answer: { type: "string" },
		citations: { type: "array", items: { type: "string" } },
		hold: { type: "boolean" },
	},
	required: ["answer", "citations", "hold"],
	additionalProperties: false,
};
async function main() {
	const args = process.argv.slice(2);
	const suite = args.shift();
	const output = args.shift();
	const budgetPath = args.shift();
	if (
		![
			"smoke",
			"contract",
			"extraction",
			"extraction-dev",
			"extraction-holdout",
			"decision",
			"grounded-dev",
			"grounded-holdout",
		].includes(suite ?? "") ||
		!output ||
		!budgetPath ||
		args.length
	)
		throw new Error(
			"Usage: bun eval/api/main.ts <smoke|contract|extraction|extraction-dev|extraction-holdout|decision> <new-output-dir> <shared-budget.jsonl>",
		);
	if (existsSync(output)) throw new Error("output already exists");
	mkdirSync(output, { recursive: true });
	const snapshot = sourceSnapshot(resolve(import.meta.dir, "../.."));
	writeFileSync(
		join(output, "manifest.json"),
		JSON.stringify(
			{
				schema: "world-api-eval/1",
				suite,
				models: apiModels,
				budgetUsd: 10,
				inputRatesUpperBoundPerMillion: 0.25,
				outputRatesPerMillion: 0.5,
				source: snapshot,
				generatedAt: new Date().toISOString(),
			},
			null,
			2,
		),
	);
	const budget = new ApiBudget(budgetPath, 10);
	const grounded = suite === "grounded-dev" || suite === "grounded-holdout";
	const promptVersion = grounded
		? GROUNDED_VERSION
		: `${EXTRACTION_INSTRUCTION_VERSION}/${API_EXTRACTION_VERSION}`;
	let thresholdsMet = true;
	let completed = false;
	const extraction =
		suite === "extraction" ||
		suite === "extraction-dev" ||
		suite === "extraction-holdout" ||
		grounded;
	try {
		const results = await Promise.allSettled(
			(["openai", "claude"] as const).map(async (service) => {
				const api = new EvaluationApi(service, budget);
				if (suite === "smoke") {
					const result = await api.complete(
						"Return a JSON answer based only on the source. No tools.",
						"資料ID S1: 本日、検証を開始した。質問: 検証は開始したか。",
						AbortSignal.timeout(120000),
						512,
						answerSchema,
					);
					writeFileSync(
						join(output, `${service}.json`),
						JSON.stringify(result, null, 2),
					);
				} else if (suite === "contract") {
					const provider = extractionProvider(api);
					const result = await provider.extract(
						{
							requestKey: "contract-smoke",
							timeoutMs: 120000,
							window: [{ utteranceId: "s1", text: "閲覧室は利用できる。" }],
							entities: [{ id: "room", displayName: "閲覧室", aliases: [] }],
							predicates: ["available"],
						},
						AbortSignal.timeout(120000),
					);
					writeFileSync(
						join(output, `${service}.json`),
						JSON.stringify(result, null, 2),
					);
				} else if (extraction) {
					const dataset = loadDataset();
					const splits =
						suite === "extraction-dev" || suite === "grounded-dev"
							? (["dev"] as const)
							: suite === "extraction-holdout" || suite === "grounded-holdout"
								? (["holdout"] as const)
								: (["dev", "holdout"] as const);
					for (const split of splits) {
						const provider = grounded
							? groundedExtractionProvider(
									api,
									split === "dev"
										? {
												onWire: (r) =>
													appendFileSync(
														join(output, `${service}-wire.jsonl`),
														JSON.stringify(r) + "\n",
													),
											}
										: {},
								)
							: extractionProvider(api);
						const audit = {
							evaluationVersion: EVALUATION_VERSION,
							datasetVersion: dataset.version,
							datasetSha256: DATASET_SHA256,
							split,
							promptVersion,
							modelId: apiModels[service],
							modelVersion: apiModels[service],
						};
						if (split === "holdout")
							appendFileSync(
								"eval/extraction/holdout-runs.jsonl",
								JSON.stringify({
									...audit,
									at: new Date().toISOString(),
									event: "start",
								}) + "\n",
							);
						if (split === "dev")
							writeFileSync(
								join(output, `${service}-dev.jsonl`),
								JSON.stringify({
									schema: "world-extraction-dev/1",
									datasetSha256: DATASET_SHA256,
									promptVersion,
									provider: provider.info,
								}) + "\n",
								{ flag: "wx" },
							);
						const report = await runEvaluation({
							dataset,
							provider,
							split,
							mode: split === "dev" ? "tuning" : "acceptance",
							promptVersion,
							timeoutMs: 120000,
							...(split === "dev"
								? {
										onDevSample: (sample: unknown) =>
											appendFileSync(
												join(output, `${service}-dev.jsonl`),
												JSON.stringify(sample) + "\n",
											),
									}
								: {}),
						});
						thresholdsMet &&= report.score.thresholdsMet;
						if (split === "holdout")
							appendFileSync(
								"eval/extraction/holdout-runs.jsonl",
								JSON.stringify({
									...audit,
									at: new Date().toISOString(),
									event: "finish",
									thresholdsMet: report.score.thresholdsMet,
									adoptedPrecision: report.score.adoptedPrecision,
									adoptRecall: report.score.adoptRecall,
									holdRecall: report.score.holdRecall,
									classificationAccuracy: report.score.classificationAccuracy,
								}) + "\n",
							);
						writeFileSync(
							join(output, `${service}-${split}.json`),
							JSON.stringify(
								split === "holdout" ? redactHoldoutReport(report) : report,
								null,
								2,
							),
						);
						console.log(
							JSON.stringify({
								service,
								split,
								score:
									split === "holdout"
										? redactHoldoutReport(report).score
										: report.score,
								budget: budget.summary,
							}),
						);
					}
				} else {
					const loaded = await loadTasks("evaluation");
					const report = await runDecisionEval({
						mode: "evaluation",
						tasks: loaded.tasks,
						provider: {
							id: `api-${service}`,
							kind: "remote",
							model: apiModels[service],
							async complete(request) {
								const reply = await api.complete(
									"Answer from the supplied sources only. Return the requested JSON.",
									buildPrompt(request),
									AbortSignal.timeout(120000),
									2048,
									answerSchema,
								);
								const answer = JSON.parse(reply.text) as {
									answer: string;
									citations: string[];
									hold: boolean;
								};
								return {
									text: answer.answer,
									citations: answer.citations,
									hold: answer.hold,
									corrections: 0,
									inputTokens: reply.inputTokens,
									outputTokens: reply.outputTokens,
								};
							},
						},
						seed: 42,
						inputBudgetTokens: 2000,
						frozen: loaded.digests,
						generatedAt: new Date().toISOString(),
					});
					writeFileSync(
						join(output, `${service}.json`),
						JSON.stringify(
							{
								...report,
								apiProvenance: {
									transport: "direct-http",
									service,
									model: apiModels[service],
								},
								acceptance: {
									...report.acceptance,
									note: "Direct external API comparison. The legacy remote category is retained; this never satisfies Local model or P5 acceptance.",
								},
							},
							null,
							2,
						),
					);
					console.log(
						JSON.stringify({
							service,
							summary: report.summary,
							budget: budget.summary,
						}),
					);
				}
			}),
		);
		for (const result of results)
			if (result.status === "rejected") throw result.reason;
		completed = true;
	} finally {
		const after = sourceSnapshot(resolve(import.meta.dir, "../.."));
		const stable = snapshot.digest === after.digest;
		writeFileSync(
			join(output, "result.json"),
			JSON.stringify(
				{
					status: !stable ? "invalidated" : completed ? "completed" : "failed",
					thresholdsMet:
						extraction && completed && stable ? thresholdsMet : null,
					budget: budget.summary,
				},
				null,
				2,
			),
		);
		if (!stable || !completed || (extraction && !thresholdsMet))
			process.exitCode = 1;
		writeFileSync(
			join(output, "budget.json"),
			JSON.stringify(budget.summary, null, 2),
		);
		writeFileSync(
			join(output, "source-after.json"),
			JSON.stringify(after, null, 2),
		);
		budget.close();
	}
}
if (import.meta.main)
	try {
		await main();
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : "API evaluation failed",
		);
		process.exitCode = 1;
	}
