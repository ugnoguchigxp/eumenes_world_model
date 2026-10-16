import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
	asRecord,
	checkId,
	type ScopeRef,
	type SourceRef,
	type SourceState,
} from "../../src/contracts/index.ts";
import { prepareExtraction } from "../../src/domains/extraction/index.ts";

export const hash = (bytes: Uint8Array): string =>
	createHash("sha256").update(bytes).digest("hex");
const digest = (text: string) => `sha256:${hash(Buffer.from(text))}`;

export const seedScope: ScopeRef = {
	principal: "world-seed-test",
	scopeKey: "local-noncommercial-research",
};

export interface SeedDocument {
	readonly recordId: string;
	readonly collection: string;
	/** Entire record, admission metadata and optional row review. */
	readonly content: string;
	/** Refers to this local collected document, NOT to an external web page. */
	readonly source: SourceRef;
}

export interface SeedCorpus {
	readonly seedId: string;
	readonly manifestDigest: string;
	readonly documents: readonly SeedDocument[];
}

function object(value: unknown): Record<string, unknown> {
	const result = asRecord(value);
	if (!result) throw new Error("seed_expected_object");
	return result;
}

function id(value: unknown): string {
	const result = checkId(value);
	if (!result.ok) throw new Error("seed_invalid_id");
	return result.value;
}

function count(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
		throw new Error("seed_invalid_count");
	return value;
}

function rows(text: string): Record<string, unknown>[] {
	return text
		.trimEnd()
		.split("\n")
		.map((line) => object(JSON.parse(line)));
}

/** Explicit pins only: never discovers new batches or includes pending.jsonl. */
export async function loadSeed(manifestPath: string): Promise<SeedCorpus> {
	const manifestText = await readFile(manifestPath, "utf8");
	const manifest = object(JSON.parse(manifestText));
	if (
		manifest["schemaVersion"] !== 1 ||
		manifest["scope"] !== seedScope.scopeKey ||
		!Array.isArray(manifest["collections"]) ||
		manifest["collections"].length === 0
	)
		throw new Error("seed_invalid_manifest");
	const seedId = id(manifest["seedId"]);
	const documents: SeedDocument[] = [];
	const ids = new Set<string>();
	const collections = new Set<string>();
	for (const entry of manifest["collections"]) {
		const pin = object(entry);
		const collection = id(pin["collection"]);
		if (
			basename(collection) !== collection ||
			collection === "." ||
			collection === ".." ||
			collections.has(collection)
		)
			throw new Error("seed_invalid_collection");
		collections.add(collection);
		const directory = resolve(
			dirname(manifestPath),
			"../collections",
			collection,
		);
		const files = object(pin["files"]);
		async function pinned(name: string): Promise<string> {
			const expected = object(files[name]);
			const bytes = await readFile(resolve(directory, name));
			if (
				bytes.length !== count(expected["bytes"]) ||
				hash(bytes) !== expected["sha256"]
			)
				throw new Error(`seed_integrity_mismatch:${collection}/${name}`);
			// Invalid UTF-8 must not silently become replacement characters.
			return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		}
		const accepted = rows(await pinned("accepted.jsonl"));
		const admissionManifest = object(JSON.parse(await pinned("manifest.json")));
		// File inventories stay in the pinned manifest; they are not model text.
		const admission = Object.fromEntries(
			Object.entries(admissionManifest).filter(([key]) => key !== "files"),
		);
		const reviews = new Map<string, Record<string, unknown>>();
		if (files["reviews.jsonl"] !== undefined) {
			for (const review of rows(await pinned("reviews.jsonl"))) {
				const recordId = id(review["record_id"]);
				if (reviews.has(recordId)) throw new Error("seed_duplicate_review");
				reviews.set(recordId, review);
			}
		}
		if (accepted.length !== count(pin["rows"]))
			throw new Error("seed_collection_count_mismatch");
		for (const record of accepted) {
			const recordId = id(record["record_id"]);
			if (ids.has(recordId)) throw new Error("seed_duplicate_record");
			ids.add(recordId);
			if (files["reviews.jsonl"] !== undefined && !reviews.has(recordId))
				throw new Error("seed_missing_review");
			const content = JSON.stringify({
				record,
				collection,
				admission,
				review: reviews.get(recordId) ?? null,
			});
			// Opaque bounded identity; the original record id remains in the document.
			const source: SourceRef = {
				namespace: "world-seed",
				kind: "collected-document",
				id: hash(Buffer.from(JSON.stringify([seedId, collection, recordId]))),
				revision: seedId,
				digest: digest(content),
			};
			documents.push({ recordId, collection, content, source });
		}
	}
	if (documents.length !== count(manifest["rows"]))
		throw new Error("seed_total_count_mismatch");
	return { seedId, manifestDigest: digest(manifestText), documents };
}

/** No semantic transformation: the existing LLM boundary receives all fields. */
export function prepareSeedDocument(document: SeedDocument) {
	const state: SourceState = {
		...document.source,
		...seedScope,
		status: "available",
		content: document.content,
	};
	return prepareExtraction(
		{
			contractVersion: 1,
			scope: seedScope,
			utterances: [
				{
					utteranceId: document.source.id,
					source: document.source,
					confirmed: true,
					origin: "document_claim",
					rootEvidenceId: document.source.id,
				},
			],
			sources: { states: [state] },
		},
		hash,
	);
}
