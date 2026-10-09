import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import { citedBytes } from "../../src/contracts/index.ts";
import type {
	AccessContext,
	SourceRef,
	SourceSnapshot,
} from "../../src/contracts/index.ts";
import { walk } from "../../scripts/files.ts";

const vendor = resolve(import.meta.dir, "../../vendor/eumenes-memory");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("A03 pinned Memory distribution", () => {
	test("public types are usable without hand-written copies", () => {
		const ref: SourceRef = {
			namespace: "conversation",
			kind: "message",
			id: "src-1",
			revision: "rev-1",
			digest: "sha256:x",
			range: { startByte: 0, endByte: 3 },
		};
		const access: AccessContext = {
			principal: "p-a",
			scopeKeys: ["scope-a"],
			purpose: "world",
			policyRevision: "1",
		};
		const snapshot: SourceSnapshot = {
			states: [
				{
					namespace: "conversation",
					kind: "message",
					id: "src-1",
					revision: "rev-1",
					digest: "sha256:x",
					principal: "p-a",
					scopeKey: "scope-a",
					status: "available",
				},
			],
		};
		expect([ref.id, access.principal, snapshot.states.length]).toEqual([
			"src-1",
			"p-a",
			1,
		]);
	});
	test("Japanese byte range cites the original bytes; char splits rejected", () => {
		const text = "音声サービス";
		const quoted = citedBytes(text, { startByte: 0, endByte: 6 });
		expect(quoted.ok && new TextDecoder().decode(quoted.value)).toBe("音声");
		for (const range of [
			{ startByte: 1, endByte: 6 },
			{ startByte: 0, endByte: 5 },
			{ startByte: 3, endByte: 3 },
			{ startByte: 0, endByte: 19 },
			{ startByte: -1, endByte: 3 },
		])
			expect(citedBytes(text, range).ok).toBe(false);
	});
	test("manifest hashes match the vendored files and provenance is recorded", () => {
		const manifest = JSON.parse(
			readFileSync(resolve(vendor, "manifest.json"), "utf8"),
		);
		expect(manifest.kind).toBe("local-generated-not-official-release");
		// Provenance is a git commit (own checkout) or the SHA-256 of the host's
		// pinned Memory tarball when generated from the host's dependency.
		const provenance =
			manifest.source.gitCommit !== "unknown"
				? manifest.source.gitCommit
				: manifest.source.sourceTarballSha256;
		expect(provenance).toMatch(/^([0-9a-f]{40}|[0-9a-f]{64})$/);
		expect(manifest.source.sourceTreeSha256).toMatch(/^[0-9a-f]{64}$/);
		expect(manifest.files.length).toBeGreaterThan(0);
		for (const file of manifest.files)
			expect(sha(readFileSync(resolve(vendor, file.path)))).toBe(file.sha256);
	});
	test("type declarations stay closed inside the vendor directory", () => {
		for (const file of walk(vendor).filter((f) => f.endsWith(".d.ts"))) {
			const code = readFileSync(file, "utf8");
			for (const match of code.matchAll(/from\s+"([^"]+)"/g)) {
				const spec = match[1]!;
				if (spec.startsWith("node:")) continue;
				expect(spec.startsWith(".")).toBe(true);
				expect(
					relative(vendor, resolve(file, "..", spec)).startsWith(".."),
				).toBe(false);
			}
		}
	});
});
