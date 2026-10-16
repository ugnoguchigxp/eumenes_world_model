import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openTestStore } from "../../test/support/sqlite-store.ts";
import { loadSeed, prepareSeedDocument } from "./corpus.ts";
import { inspectSeed, receiveSeed } from "./intake.ts";

const root = resolve(import.meta.dir, "../..");
const corpus = await loadSeed(
	resolve(root, "data/worldmodel-corpus/seed/v1.json"),
);
// Validate every document before writing, without inventing model candidates.
const deferred: { recordId: string; reasonCode: string }[] = [];
let prepared = 0;
for (const document of corpus.documents) {
	const result = prepareSeedDocument(document);
	if (!result.ok) throw new Error(`seed_prepare_failed:${result.code}`);
	prepared += result.value.window.length;
	for (const item of result.value.deferred)
		deferred.push({ recordId: document.recordId, reasonCode: item.reasonCode });
}
if (prepared + deferred.length !== corpus.documents.length)
	throw new Error("seed_prepare_count_mismatch");

const store = openTestStore();
try {
	const first = store.write((db) => receiveSeed(db, corpus));
	const persisted = store.read((db) => inspectSeed(db, corpus));
	const replay = store.write((db) => receiveSeed(db, corpus));
	const afterReplay = store.read((db) => inspectSeed(db, corpus));
	if (
		first.applied !== corpus.documents.length ||
		first.noOp !== 0 ||
		replay.applied !== 0 ||
		replay.noOp !== corpus.documents.length ||
		JSON.stringify(persisted) !== JSON.stringify(afterReplay)
	)
		throw new Error("seed_replay_mismatch");
	const report = {
		seedId: corpus.seedId,
		manifestDigest: corpus.manifestDigest,
		recordedAt: new Date().toISOString(),
		stage: "source-intake-and-extraction-preparation",
		rows: corpus.documents.length,
		first,
		replay,
		persisted,
		preparation: { prepared, deferred },
		modelExtraction: "not_run",
		decisionEffect: "not_measured",
		database: "temporary-file-WAL-removed-on-completion",
	};
	const output = resolve(root, "artifacts/seed/grok-984-v1-report.json");
	await mkdir(resolve(root, "artifacts/seed"), { recursive: true });
	await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report, null, 2));
} finally {
	store.close();
}
