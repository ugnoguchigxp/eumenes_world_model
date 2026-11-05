import { expect, test } from "bun:test";
import { mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const helper = resolve(import.meta.dir, "../support/process-world.ts");
async function child(path: string, mode: string, kind: string, stage = 0) {
	const p = Bun.spawn(
		[process.execPath, helper, path, mode, kind, String(stage)],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr, code] = await Promise.all([
		new Response(p.stdout).text(),
		new Response(p.stderr).text(),
		p.exited,
	]);
	return { stdout, stderr, code };
}
for (const kind of ["register", "forget"])
	test(`real process exit at every ${kind} DML rolls back; lost commit response replays once`, async () => {
		const dir = mkdtempSync(join(tmpdir(), "world-process-"));
		try {
			const base = join(dir, "base.sqlite");
			const initial = await child(base, "init", kind);
			expect(initial.code, initial.stderr).toBe(0);
			const before = JSON.parse(initial.stdout);
			const count = await child(base, "count", kind);
			expect(count.code, count.stderr).toBe(0);
			const stages = JSON.parse(count.stdout).dml as number;
			expect(stages).toBeGreaterThan(1);
			for (let i = 1; i <= stages; i++) {
				const path = join(dir, `dml-${i}.sqlite`);
				copyFileSync(base, path);
				const crashed = await child(path, "kill", kind, i);
				expect(crashed.code, crashed.stderr).toBe(97);
				const reopened = await child(path, "dump", kind);
				expect(reopened.code, reopened.stderr).toBe(0);
				expect(JSON.parse(reopened.stdout)).toEqual(before);
			}
			for (const mode of ["before-commit", "after-commit"]) {
				const path = join(dir, `${mode}.sqlite`);
				copyFileSync(base, path);
				const exited = await child(path, mode, kind);
				expect(exited.code, exited.stderr).toBe(
					mode === "before-commit" ? 97 : 98,
				);
				const retry = await child(path, "replay", kind);
				expect(retry.code, retry.stderr).toBe(0);
				expect(JSON.parse(retry.stdout).status).toBe(
					mode === "before-commit" ? "applied" : "no_op",
				);
				const snapshot = await child(path, "dump", kind);
				const repeated = await child(path, "replay", kind);
				expect(JSON.parse(repeated.stdout).status).toBe("no_op");
				expect(JSON.parse((await child(path, "dump", kind)).stdout)).toEqual(
					JSON.parse(snapshot.stdout),
				);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 30000);
