import { expect, test } from "bun:test";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkMemoryVendor } from "../../scripts/check-memory-vendor.ts";
const repo = resolve(import.meta.dir, "../..");

test("Memory pin rejects missing files, changed bytes and manifest replacement", () => {
	const root = mkdtempSync(join(tmpdir(), "world-memory-pin-"));
	try {
		cpSync(join(repo, "vendor"), join(root, "vendor"), { recursive: true });
		expect(() => checkMemoryVendor(root)).not.toThrow();
		const file = join(root, "vendor/eumenes-memory/dist/index.d.ts");
		const original = readFileSync(file);
		writeFileSync(file, "export type Unexpected = string;");
		expect(() => checkMemoryVendor(root)).toThrow("MEMORY_FILE_PIN_MISMATCH");
		rmSync(file);
		expect(() => checkMemoryVendor(root)).toThrow("MEMORY_FILE_SET_MISMATCH");
		writeFileSync(file, original);
		const manifest = join(root, "vendor/eumenes-memory/manifest.json");
		writeFileSync(
			manifest,
			readFileSync(manifest, "utf8").replace('"0.3.6"', '"9.0.0"'),
		);
		expect(() => checkMemoryVendor(root)).toThrow(
			"MEMORY_MANIFEST_PIN_MISMATCH",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
