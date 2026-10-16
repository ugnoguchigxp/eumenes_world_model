import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateConditions, type Entity } from "../../src/index.ts";
import { loadSeed, seedScope } from "../../eval/seed/corpus.ts";
import { openTestStore } from "../../test/support/sqlite-store.ts";
import { cases } from "./cases.ts";
import { injectionControl } from "./control.ts";
import { MODEL, PROMPT_VERSION, withLuna } from "./luna.ts";
import { persistCandidates, validateOutput } from "./pipeline.ts";
import { outputSchema } from "./schema.ts";

const root = resolve(import.meta.dir, "../..");
const runId = `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`;
const output = resolve(root, "artifacts/seed-luna", runId);
await mkdir(output, { recursive: true });
const report: {
	runId: string;
	model: string;
	promptVersion: string;
	inference: string;
	status: string;
	seedId?: string;
	manifestDigest?: string;
	samples: unknown[];
	error?: string;
} = {
	runId,
	model: MODEL,
	promptVersion: PROMPT_VERSION,
	inference: "Codex SDK / signed-in account / remote model",
	status: "running",
	samples: [],
};
const saveReport = () =>
	writeFile(
		resolve(output, "report.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
await saveReport();

try {
	const corpus = await loadSeed(
		resolve(root, "data/worldmodel-corpus/seed/v1.json"),
	);
	report.seedId = corpus.seedId;
	report.manifestDigest = corpus.manifestDigest;
	const store = openTestStore();
	try {
		await withLuna(async (run) => {
			const samples = [
				...cases.map((entry) => ({
					...entry,
					kind: "collected-seed",
					document: corpus.documents.find((d) => d.recordId === entry.recordId),
				})),
				{
					recordId: "injection-control",
					entityId: "example-service",
					name: "検証用の架空サービスA",
					observationKeys: [],
					kind: "synthetic-adversarial-control",
					document: injectionControl(),
				},
			];
			for (const entry of samples) {
				const document = entry.document;
				if (!document)
					throw new Error(`example_missing_record:${entry.recordId}`);
				const entity: Entity = {
					id: entry.entityId,
					scope: seedScope,
					revision: 1,
					displayName: entry.name,
					aliases: [],
					externalRefs: [],
				};
				const request = {
					window: [{ utteranceId: document.source.id, text: document.content }],
					entities: [
						{ id: entity.id, displayName: entity.displayName, aliases: [] },
					],
					predicates: ["source_claim"],
					observationKeys: entry.observationKeys,
				};
				await writeFile(
					resolve(output, `${entry.recordId}-request.json`),
					JSON.stringify(request, null, 2),
				);
				console.log(`Extracting ${entry.recordId} with ${MODEL}`);
				const response = await run(
					`Extract a source-level claim from this input:\n${JSON.stringify(request)}`,
					outputSchema,
				);
				await writeFile(
					resolve(output, `${entry.recordId}-response.json`),
					JSON.stringify(response, null, 2),
				);
				const recordedAt = Date.now();
				const result = validateOutput(
					document,
					entity,
					JSON.parse(response.raw),
					recordedAt,
				);
				const persistence = store.write((db) =>
					persistCandidates(
						db,
						entity,
						result.state,
						result.assertions,
						recordedAt,
					),
				);
				const conditionProbes =
					entry.observationKeys.length === 0
						? []
						: [
								{ years: 8, age: 65 },
								{ years: 12, age: 65 },
								{ years: 12, age: 60 },
							].map(({ years, age }) => ({
								eligibilityYears: years,
								age,
								verdicts: result.assertions.map((assertion) =>
									evaluateConditions({
										contractVersion: 1,
										asOf: recordedAt,
										authorized: true,
										maxAgeMs: 86_400_000,
										condition: assertion.condition,
										observations: [
											{
												observationId: "years",
												key: "eligibility_years",
												value: { kind: "number", value: years, unit: "year" },
												observedAt: recordedAt,
												version: "v1",
												priority: 1,
											},
											{
												observationId: "age",
												key: "age_years",
												value: { kind: "number", value: age, unit: "year" },
												observedAt: recordedAt,
												version: "v1",
												priority: 1,
											},
										],
									}),
								),
							}));
				const sample = {
					kind: entry.kind,
					recordId: entry.recordId,
					source: document.source,
					bindings: result.bindings,
					validation: result.validation,
					persistence,
					conditionProbes,
					usage: response.usage,
				};
				report.samples.push(sample);
				await saveReport();
				console.log(
					JSON.stringify({
						recordId: entry.recordId,
						...persistence,
						verdicts: result.validation.verdicts.map((v) => v.status),
					}),
				);
			}
		});
	} finally {
		store.close();
	}
	report.status = "completed";
} catch (error) {
	report.status = "failed";
	report.error = error instanceof Error ? error.message : String(error);
	process.exitCode = 1;
} finally {
	await saveReport();
	console.log(`Result: ${resolve(output, "report.json")}`);
}
