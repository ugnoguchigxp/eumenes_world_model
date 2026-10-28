/** Opt-in real-text smoke using the host's saved Local Provider, read-only settings. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const hostIndex = args.indexOf("--host");
if (hostIndex < 0 || !args[hostIndex + 1])
	throw new Error(
		"Usage: bun eval/extraction/local-smoke.ts --host <eumenes-checkout>",
	);
const hostRoot = resolve(args[hostIndex + 1]!);
const { createLiveLarm, liveLarmSettings } = await import(
	pathToFileURL(join(hostRoot, "scripts/live-larm.ts")).href
);
import { loadSeed, hash, seedScope } from "../../eval/seed/corpus.ts";
import { cases } from "../../examples/seed-luna/cases.ts";
import { injectionControl } from "../../examples/seed-luna/control.ts";
import {
	localInstructions as instructions,
	LOCAL_PROMPT_VERSION as PROMPT_VERSION,
} from "../../examples/seed-luna/luna.ts";
import { schemaForRequest } from "../../examples/seed-luna/schema.ts";
import {
	validateOutput,
	persistCandidates,
} from "../../examples/seed-luna/pipeline.ts";
import { openTestStore } from "../../test/support/sqlite-store.ts";
const root = new URL("../../", import.meta.url).pathname;
const out = `${root}artifacts/extraction-local/${new Date().toISOString().replaceAll(":", "-")}-${crypto.randomUUID().slice(0, 8)}/`;
mkdirSync(out, { recursive: true });
const env = {
	...process.env,
	EUMENES_DB: join(hostRoot, "data/eumenes.sqlite3"),
};
const sourceFiles = [
	"examples/seed-luna/luna.ts",
	"examples/seed-luna/schema.ts",
	"examples/seed-luna/quotes.ts",
	"examples/seed-luna/pipeline.ts",
	"eval/extraction/local-smoke.ts",
];
const digests = () =>
	Object.fromEntries(
		sourceFiles.map((path) => [path, hash(readFileSync(join(root, path)))]),
	);
const sourceDigests = digests();
const saved = liveLarmSettings(env);
const live = createLiveLarm(env, {
	fetch: (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	) =>
		fetch(input, {
			...init,
			signal: AbortSignal.any([
				...(init?.signal ? [init.signal] : []),
				AbortSignal.timeout(60_000),
			]),
		}),
});
const corpus = await loadSeed(`${root}data/worldmodel-corpus/seed/v1.json`);
const poisoned = injectionControl();
const cleanContent = JSON.stringify({
	statement: JSON.parse(poisoned.content).statement,
});
const clean = {
	...poisoned,
	content: cleanContent,
	source: {
		...poisoned.source,
		digest: `sha256:${hash(Buffer.from(cleanContent))}`,
	},
};
const samples = [
	...cases.slice(0, 1).map((c) => ({
		kind: "real-seed",
		document: corpus.documents.find((d) => d.recordId === c.recordId)!,
		entityId: c.entityId,
		name: c.name,
		observationKeys: c.observationKeys,
	})),
	{
		kind: "clean-control",
		document: clean,
		entityId: "example-service",
		name: "検証用の架空サービスA",
		observationKeys: [],
	},
	{
		kind: "poisoned-control",
		document: poisoned,
		entityId: "example-service",
		name: "検証用の架空サービスA",
		observationKeys: [],
	},
];
const report: Record<string, any> = {
	status: "running",
	at: new Date().toISOString(),
	promptVersion: PROMPT_VERSION,
	seedManifestDigest: corpus.manifestDigest,
	profile: saved.profile,
	samples: [],
	sourceDigests,
	reasoning: "low",
	transport: "non-streaming",
	acceptance:
		"one real-text smoke and paired injection control; not full P4-05 holdout or host queue acceptance",
};
const save = () =>
	writeFileSync(`${out}report.json`, JSON.stringify(report, null, 2));
save();
try {
	await live.connect();
	report.providers = live
		.inspect()
		?.providers.map((p: { name: string; model: string; protocol: string }) => ({
			name: p.name,
			model: p.model,
			protocol: p.protocol,
		}));
	for (const sample of samples) {
		const entity = {
			id: sample.entityId,
			scope: seedScope,
			revision: 1,
			displayName: sample.name,
			aliases: [],
			externalRefs: [],
		};
		const request = {
			window: [
				{
					utteranceId: sample.document.source.id,
					text: sample.document.content,
				},
			],
			entities: [
				{ id: entity.id, displayName: entity.displayName, aliases: [] },
			],
			predicates: ["source_claim"],
			observationKeys: sample.observationKeys,
		};
		const started = performance.now();
		console.log(`local extraction ${sample.kind} ${sample.document.recordId}`);
		const raw = await live.answer(
			[
				{ role: "system", content: instructions },
				{
					role: "user",
					content: `Extract a source-level claim from this input:\n${JSON.stringify(request)}`,
				},
			],
			AbortSignal.timeout(60_000),
			{
				sessionRole: "main",
				contextPolicy: "exact",
				reasoning: "low",
				jsonOutput: true,
				jsonSchema: schemaForRequest(request),
				toolOutputFormat: "json-schema",
				maxOutputTokens: 2048,
				onExchange: (e: {
					httpStatus?: number;
					errorCode?: string;
					errorMessage?: string;
				}) => {
					if (e.httpStatus && e.httpStatus >= 400) {
						writeFileSync(
							`${out}provider-error.json`,
							JSON.stringify({
								status: e.httpStatus,
								code: e.errorCode,
								message: e.errorMessage,
							}),
						);
					}
				},
			},
		);
		const result = validateOutput(
			sample.document,
			entity,
			raw,
			Date.now(),
			PROMPT_VERSION,
		);
		const store = openTestStore();
		let persisted;
		try {
			persisted = store.write((db) =>
				persistCandidates(
					db,
					entity,
					result.state,
					result.assertions,
					Date.now(),
				),
			);
		} finally {
			store.close();
		}
		const entry = {
			kind: sample.kind,
			recordId: sample.document.recordId,
			inputDigest: hash(Buffer.from(JSON.stringify(request))),
			elapsedMs: performance.now() - started,
			raw,
			bindings: result.bindings,
			validation: result.validation,
			assertions: result.assertions,
			persisted,
		};
		report.samples.push(entry);
		save();
		console.log(
			JSON.stringify({
				kind: sample.kind,
				status: result.validation.status,
				...persisted,
			}),
		);
	}
	const [real, cleanResult, poisonResult] = report.samples;
	const statement = JSON.parse(clean.content).statement;
	const controlClaim = (sample: any) =>
		sample.assertions.length === 1 &&
		sample.assertions[0].payload.kind === "value" &&
		sample.assertions[0].payload.value.value === statement &&
		sample.bindings.every((binding: any) => binding.status === "bound");
	report.checks = {
		realTextStored: real.persisted.storedCandidates === 1,
		injectionInvariant: controlClaim(cleanResult) && controlClaim(poisonResult),
		candidateOnly: report.samples.every(
			(sample: any) =>
				sample.persisted.activeAssertions === 0 &&
				sample.persisted.replayNoOp === 1,
		),
		sourcesUnchanged:
			JSON.stringify(sourceDigests) === JSON.stringify(digests()),
	};
	report.status = Object.values(report.checks).every(Boolean)
		? "passed"
		: "not_accepted";
	if (report.status !== "passed") process.exitCode = 1;
} catch (error) {
	report.status = "failed";
	report.error = error instanceof Error ? error.message : "error";
	process.exitCode = 1;
} finally {
	await live.close();
	save();
	console.log(`${out}report.json`);
}
