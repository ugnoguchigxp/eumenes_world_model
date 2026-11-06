import { expect, test } from "bun:test";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("both runner entries prepare and resume the frozen protocol without model calls, and reject source drift", async () => {
	const root = resolve(import.meta.dir, "../..");
	const dir = mkdtempSync(join(tmpdir(), "operative-runner-"));
	try {
		cpSync(join(root, "examples"), join(dir, "examples"), { recursive: true });
		for (const name of ["src", "eval", "test", "node_modules"])
			symlinkSync(join(root, name), join(dir, name), "dir");
		for (const name of ["package.json", "bun.lock"])
			cpSync(join(root, name), join(dir, name));
		for (const suite of [
			"operative-sources-comparison",
			"operative-sources-holdout",
		]) {
			const main = join(dir, "examples", suite, "main.ts");
			async function invoke(extra: string[] = []) {
				const p = Bun.spawn(
					[process.execPath, main, "--prepare-only", ...extra],
					{ cwd: dir, stdout: "pipe", stderr: "pipe" },
				);
				const [stdout, stderr, code] = await Promise.all([
					new Response(p.stdout).text(),
					new Response(p.stderr).text(),
					p.exited,
				]);
				return { stdout, stderr, code };
			}
			const prepared = await invoke();
			expect(prepared.code, prepared.stderr).toBe(0);
			const result = JSON.parse(prepared.stdout.trim().split("\n").at(-1)!);
			expect(result).toMatchObject({
				status: "prepared",
				newCalls: 0,
				reused: 0,
			});
			const runDir = resolve(result.report, "..");
			const protocol = readFileSync(join(runDir, "protocol.json"), "utf8");
			const parsed = JSON.parse(protocol);
			expect(
				typeof parsed.codeDigests[
					"examples/operative-sources-comparison/runner.ts"
				],
			).toBe("string");
			expect(parsed.design.plannedAnswers).toBe(parsed.questions.length * 4);
			const resumed = await invoke(["--resume", runDir]);
			expect(resumed.code, resumed.stderr).toBe(0);
			expect(readFileSync(join(runDir, "protocol.json"), "utf8")).toBe(
				protocol,
			);
			const entry = readFileSync(main, "utf8");
			writeFileSync(main, `${entry}\n// changed after the freeze\n`);
			const changed = await invoke(["--resume", runDir]);
			expect(changed.code).not.toBe(0);
			expect(changed.stderr).toContain("frozen_protocol_changed");
			writeFileSync(main, entry);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 30000);
