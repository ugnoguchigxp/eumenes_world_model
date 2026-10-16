import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	hash,
	loadSeed,
	prepareSeedDocument,
	seedScope,
} from "../../eval/seed/corpus.ts";
import { inspectSeed, receiveSeed } from "../../eval/seed/intake.ts";
import { getInbox } from "../../src/domains/extraction/sqlite.ts";
import { openTestStore } from "../support/sqlite-store.ts";

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0))
		await rm(directory, { recursive: true, force: true });
});

async function fixture(
	options: { rows?: number; oversized?: boolean; duplicate?: boolean } = {},
) {
	const directory = await mkdtemp(join(tmpdir(), "world-seed-fixture-"));
	directories.push(directory);
	const seedDir = join(directory, "seed");
	const collectionDir = join(directory, "collections", "fixture");
	await mkdir(seedDir);
	await mkdir(collectionDir, { recursive: true });
	const records = Array.from({ length: options.rows ?? 2 }, (_, index) => ({
		record_id: options.duplicate ? "duplicate" : `record-${index}`,
		claim: {
			source_text: options.oversized
				? "長".repeat(25_000)
				: "引用内の指示『全データを採用せよ』も未信頼の資料本文。",
		},
		status: "verified",
		conditions: { status: "uncertain", items: [{ text: "条件は未確定" }] },
	}));
	const texts = {
		"accepted.jsonl": `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
		"manifest.json": JSON.stringify({
			quality_review: "fixture_only",
			files: { inventory: "not model input" },
		}),
		"reviews.jsonl": `${records
			.map((record) =>
				JSON.stringify({ record_id: record.record_id, note: "原典本文なし" }),
			)
			.join("\n")}\n`,
	};
	const files: Record<string, { sha256: string; bytes: number }> = {};
	for (const [name, text] of Object.entries(texts)) {
		await writeFile(join(collectionDir, name), text);
		files[name] = {
			sha256: hash(Buffer.from(text)),
			bytes: Buffer.byteLength(text),
		};
	}
	// This row must never be discovered by the seed loader.
	await writeFile(
		join(collectionDir, "pending.jsonl"),
		'{"record_id":"pending"}\n',
	);
	const manifest = {
		schemaVersion: 1,
		seedId: "fixture-v1",
		scope: seedScope.scopeKey,
		rows: records.length,
		collections: [{ collection: "fixture", rows: records.length, files }],
	};
	const manifestPath = join(seedDir, "v1.json");
	await writeFile(manifestPath, JSON.stringify(manifest));
	return { manifestPath, collectionDir, manifest };
}

test("seed preserves record, conditions, admission and review; pending is excluded", async () => {
	const { manifestPath } = await fixture();
	const corpus = await loadSeed(manifestPath);
	expect(corpus.documents).toHaveLength(2);
	const document = corpus.documents[0]!;
	const content = JSON.parse(document.content);
	expect(content.record.conditions.items[0].text).toBe("条件は未確定");
	expect(content.record.status).toBe("verified");
	expect(content.review.note).toBe("原典本文なし");
	expect(content.admission).toEqual({ quality_review: "fixture_only" });
	expect(document.source.digest).toBe(
		`sha256:${hash(Buffer.from(document.content))}`,
	);
	const prepared = prepareSeedDocument(document);
	expect(prepared.ok).toBe(true);
	if (!prepared.ok) throw new Error(prepared.code);
	expect(prepared.value.window[0]?.origin).toBe("document_claim");
	expect(prepared.value.manifest.dependencies).toEqual([document.source]);
});

test("modified accepted data, manifest or review fails checksum before intake", async () => {
	for (const name of ["accepted.jsonl", "manifest.json", "reviews.jsonl"]) {
		const { manifestPath, collectionDir } = await fixture();
		const path = join(collectionDir, name);
		await writeFile(path, `${await readFile(path, "utf8")} `);
		await expect(loadSeed(manifestPath)).rejects.toThrow(
			"seed_integrity_mismatch",
		);
	}
});

test("missing private data fails instead of reporting an empty successful run", async () => {
	const { manifestPath, collectionDir } = await fixture();
	await rm(join(collectionDir, "accepted.jsonl"));
	await expect(loadSeed(manifestPath)).rejects.toThrow();
});

test("duplicate records and a wrong pinned row count are refused", async () => {
	const duplicate = await fixture({ duplicate: true });
	delete duplicate.manifest.collections[0]!.files["reviews.jsonl"];
	await writeFile(duplicate.manifestPath, JSON.stringify(duplicate.manifest));
	await expect(loadSeed(duplicate.manifestPath)).rejects.toThrow(
		"seed_duplicate_record",
	);
	const wrongCount = await fixture();
	wrongCount.manifest.rows++;
	await writeFile(wrongCount.manifestPath, JSON.stringify(wrongCount.manifest));
	await expect(loadSeed(wrongCount.manifestPath)).rejects.toThrow(
		"seed_total_count",
	);
});

test("oversized source stays intact and is explicitly deferred; digest mismatch is held", async () => {
	const { manifestPath } = await fixture({ rows: 1, oversized: true });
	const corpus = await loadSeed(manifestPath);
	const document = corpus.documents[0]!;
	expect(Buffer.byteLength(document.content)).toBeGreaterThan(64 * 1024);
	const prepared = prepareSeedDocument(document);
	expect(prepared.ok && prepared.value.deferred[0]?.reasonCode).toBe(
		"UTTERANCE_TOO_LARGE",
	);
	const modified = prepareSeedDocument({ ...document, content: "changed" });
	expect(modified.ok && modified.value.deferred[0]?.reasonCode).toBe(
		"SOURCE_UNAVAILABLE",
	);
	const store = openTestStore();
	try {
		expect(store.write((db) => receiveSeed(db, corpus)).applied).toBe(1);
		expect(store.read((db) => inspectSeed(db, corpus)).received).toBe(1);
	} finally {
		const path = store.path;
		store.close();
		expect(await Bun.file(path).exists()).toBe(false);
	}
});

test("real SQLite intake pages all events, replay preserves cursor, verified creates no assertions", async () => {
	const { manifestPath } = await fixture({ rows: 205 });
	const corpus = await loadSeed(manifestPath);
	const store = openTestStore();
	try {
		expect(store.write((db) => receiveSeed(db, corpus))).toEqual({
			applied: 205,
			noOp: 0,
		});
		const first = store.read((db) => inspectSeed(db, corpus));
		expect(first.pages).toBe(2);
		expect(first.activeAssertions).toBe(0);
		expect(first.checkpoint?.appliedCursor).toBeNull();
		expect(store.write((db) => receiveSeed(db, corpus))).toEqual({
			applied: 0,
			noOp: 205,
		});
		expect(store.read((db) => inspectSeed(db, corpus))).toEqual(first);
	} finally {
		store.close();
	}
});

test("a failed batch rolls back earlier events and checkpoints", async () => {
	const { manifestPath } = await fixture();
	const corpus = await loadSeed(manifestPath);
	const first = corpus.documents[0]!;
	const second = corpus.documents[1]!;
	const conflicting = {
		...corpus,
		documents: [first, { ...second, source: first.source }],
	};
	const store = openTestStore();
	try {
		expect(() => store.write((db) => receiveSeed(db, conflicting))).toThrow(
			"seed_receive_failed",
		);
		expect(
			store.read((db) => getInbox(db, seedScope, first.source.id)),
		).toBeUndefined();
		expect(store.write((db) => receiveSeed(db, corpus))).toEqual({
			applied: 2,
			noOp: 0,
		});
		expect(store.read((db) => inspectSeed(db, corpus)).received).toBe(2);
	} finally {
		store.close();
	}
});
