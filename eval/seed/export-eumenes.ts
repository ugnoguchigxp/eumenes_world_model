import { writeFile } from "node:fs/promises";
import { loadSeed } from "./corpus.ts";

/** Export only the pinned accepted corpus. Raw content remains local and is never a user utterance. */
const [manifest, destination] = process.argv.slice(2);
if (!manifest || !destination)
	throw new Error(
		"usage: bun eval/seed/export-eumenes.ts <manifest> <output.jsonl>",
	);
const corpus = await loadSeed(manifest);
const rows = corpus.documents.map((document) => {
	const record = JSON.parse(document.content).record;
	const description = record.claim?.normalized_ja;
	return {
		id: `${document.source.namespace}:${document.source.kind}:${document.source.id}`,
		revision: document.source.revision,
		title: [
			...(typeof description === "string" && description.trim()
				? description.trim()
				: document.recordId),
		]
			.slice(0, 200)
			.join(""),
		collection: document.collection,
		manifestDigest: corpus.manifestDigest.replace(/^sha256:/, ""),
		content: document.content,
		digest: document.source.digest,
	};
});
await writeFile(
	destination,
	rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
	{ mode: 0o600 },
);
console.log(
	JSON.stringify({
		seedId: corpus.seedId,
		manifestDigest: corpus.manifestDigest,
		documents: rows.length,
	}),
);
