import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { walk } from "./files.ts";
const sha = (data: Uint8Array) =>
	createHash("sha256").update(data).digest("hex");

/** The independent pin detects manifest changes as well as changed/missing files. */
export function checkMemoryVendor(root: string): void {
	const vendor = resolve(root, "vendor/eumenes-memory");
	const pin = JSON.parse(
		readFileSync(resolve(root, "vendor/eumenes-memory.pin.json"), "utf8"),
	);
	const bytes = readFileSync(resolve(vendor, "manifest.json"));
	if (sha(bytes) !== pin.manifestSha256)
		throw new Error("MEMORY_MANIFEST_PIN_MISMATCH");
	const manifest = JSON.parse(bytes.toString());
	const source = manifest.source;
	if (
		!(/^[0-9a-f]{40}$/.test(source.gitCommit) && source.srcDirtyFiles === 0) &&
		!/^[0-9a-f]{64}$/.test(source.sourceTarballSha256 ?? "")
	)
		throw new Error("MEMORY_PROVENANCE_REQUIRED");
	const actual = walk(vendor)
		.map((f) => relative(vendor, f))
		.filter((f) => f !== "manifest.json")
		.sort();
	const expected = manifest.files.map((f: { path: string }) => f.path).sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected))
		throw new Error("MEMORY_FILE_SET_MISMATCH");
	for (const file of manifest.files) {
		if (
			file.path.startsWith("/") ||
			file.path.split("/").includes("..") ||
			sha(readFileSync(resolve(vendor, file.path))) !== file.sha256
		)
			throw new Error("MEMORY_FILE_PIN_MISMATCH");
	}
}
if (import.meta.main) {
	checkMemoryVendor(resolve(import.meta.dir, ".."));
	console.log("Memory: pinned provenance, manifest and distribution verified");
}
