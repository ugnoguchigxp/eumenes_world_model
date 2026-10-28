import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import manifest from "../../fixtures/experiments/manifest.json";

test("compressed experiment evidence retains every original JSON byte and hash", () => {
	for (const entry of manifest) {
		const bytes = gunzipSync(
			readFileSync(
				new URL(`../../fixtures/experiments/${entry.path}`, import.meta.url),
			),
		);
		expect(bytes.length).toBe(entry.bytes);
		expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
		expect(() => JSON.parse(bytes.toString("utf8"))).not.toThrow();
	}
});
