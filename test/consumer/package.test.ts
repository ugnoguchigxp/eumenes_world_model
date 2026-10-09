import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../..");
const pack = join(repo, "artifacts/pack");
let consumer = "";
let worldTgz = "";
let memoryTgz = "";

const forbidden =
	/(?<!\.d)\.ts$|\.test\.|\/test\/|\/scripts\/|\/spec\/|\/vendor\/|\.sqlite/;

async function run(command: string[], cwd: string) {
	const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, code };
}

beforeAll(async () => {
	const packed = await run([process.execPath, "scripts/pack.ts"], repo);
	expect(packed.code, packed.stdout + packed.stderr).toBe(0);
	const names = readdirSync(pack);
	worldTgz = join(
		pack,
		names.find((n) => /^eumenes-world-model-.*\.tgz$/.test(n))!,
	);
	memoryTgz = join(
		pack,
		names.find((n) => /^eumenes-memory-.*\.tgz$/.test(n))!,
	);
	consumer = mkdtempSync(join(tmpdir(), "world-consumer-"));
	writeFileSync(
		join(consumer, "package.json"),
		JSON.stringify({
			name: "world-consumer",
			private: true,
			type: "module",
			overrides: { "eumenes-memory": `file:${memoryTgz}` },
			dependencies: {
				"eumenes-world-model": `file:${worldTgz}`,
				"eumenes-memory": `file:${memoryTgz}`,
			},
		}),
	);
	const installed = await run([process.execPath, "install"], consumer);
	expect(installed.code, installed.stdout + installed.stderr).toBe(0);
}, 120_000);

afterAll(() => {
	if (consumer) rmSync(consumer, { recursive: true, force: true });
});

test("A34 tarball holds JS/d.ts and the manifest only: no tests, scripts, specs or sibling sources", async () => {
	const listing = await run(["tar", "-tzf", worldTgz], repo);
	expect(listing.code).toBe(0);
	const files = listing.stdout.split("\n").filter(Boolean);
	expect(files.some((f) => f.endsWith("dist/index.js"))).toBe(true);
	expect(files.some((f) => f.endsWith("dist/index.d.ts"))).toBe(true);
	expect(files.some((f) => f.endsWith("dist/sqlite.d.ts"))).toBe(true);
	expect(files.some((f) => f.endsWith("distribution-manifest.json"))).toBe(
		true,
	);
	for (const file of files) {
		expect(file).not.toMatch(forbidden);
	}
});

test("A34 checksum files match the tarballs and the manifest ties them to the source digest", () => {
	for (const tgz of [worldTgz, memoryTgz]) {
		const recorded = readFileSync(`${tgz}.sha256`, "utf8").split(/\s+/)[0];
		expect(recorded).toBe(
			createHash("sha256").update(readFileSync(tgz)).digest("hex"),
		);
	}
	const manifest = JSON.parse(
		readFileSync(
			join(
				consumer,
				"node_modules/eumenes-world-model/distribution-manifest.json",
			),
			"utf8",
		),
	);
	expect(manifest.contract.worldContractVersion).toBe(1);
	expect(manifest.schema.migrationCount).toBe(
		manifest.schema.migrations.length,
	);
	expect(manifest.schema.migrationCount).toBeGreaterThan(0);
	expect(manifest.memoryTypeDependency.name).toBe("eumenes-memory");
	expect(manifest.source.world_source_files.length).toBeGreaterThan(0);
	for (const file of manifest.source.world_source_files)
		expect(file.path).not.toMatch(/\.test\.ts$|\/test\//);
	expect(manifest.source.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
});

test("A34 the installed package has no resolvable sibling checkout", () => {
	expect(
		existsSync(join(consumer, "node_modules/eumenes-world-model/src")),
	).toBe(false);
	expect(
		existsSync(join(consumer, "node_modules/eumenes-memory/dist/index.js")),
	).toBe(true);
});

test("A34 ESM import exposes the same API as the manifest, and one real SQLite operation succeeds", async () => {
	writeFileSync(
		join(consumer, "run.mjs"),
		`
import { Database } from "bun:sqlite";
import * as root from "eumenes-world-model";
import * as sqlite from "eumenes-world-model/sqlite";
import manifest from "eumenes-world-model/distribution-manifest.json" with { type: "json" };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
if (!same(Object.keys(root).sort(), manifest.exports["."].values)) throw new Error("root exports differ");
if (!same(Object.keys(sqlite).sort(), manifest.exports["./sqlite"].values)) throw new Error("sqlite exports differ");
const db = new Database(":memory:");
for (const sql of sqlite.migrations) db.transaction(() => db.exec(sql))();
const result = db.transaction(() => sqlite.readAssertionHistory(db, { assertionId: "none" }))();
console.log(JSON.stringify(result));
`,
	);
	const ran = await run([process.execPath, "run.mjs"], consumer);
	expect(ran.code, ran.stdout + ran.stderr).toBe(0);
	const result = JSON.parse(ran.stdout.trim().split("\n").pop()!);
	expect(typeof result.status).toBe("string");
	expect(result.reasonCode).not.toBe("SCHEMA_INCOMPATIBLE");
}, 60_000);

test("A34 types: a type-only consumer compiles against the d.ts without the World sources", async () => {
	writeFileSync(
		join(consumer, "use.ts"),
		`
import { Database } from "bun:sqlite";
import { WORLD_CONTRACT_VERSION, type Assertion } from "eumenes-world-model";
import {
	migrations,
	readAssertionHistory,
	type WorldDb,
} from "eumenes-world-model/sqlite";
const db: Database & WorldDb = new Database(":memory:");
const v: 1 = WORLD_CONTRACT_VERSION;
const count: number = migrations.length;
const history = readAssertionHistory(db, { assertionId: "x" });
export type Unused = Assertion;
export { v, count, history };
`,
	);
	// Every JS value export in the manifest must also exist in the d.ts.
	const manifest = JSON.parse(
		readFileSync(
			join(
				consumer,
				"node_modules/eumenes-world-model/distribution-manifest.json",
			),
			"utf8",
		),
	) as { exports: Record<string, { values: string[] }> };
	const parity = Object.entries(manifest.exports)
		.map(([entry, { values }], index) => {
			const specifier =
				entry === "."
					? "eumenes-world-model"
					: `eumenes-world-model${entry.slice(1)}`;
			return `import * as ns${index} from "${specifier}";\n${values
				.map(
					(name) =>
						`export const p${index}_${name}: typeof ns${index}.${name} = ns${index}.${name};`,
				)
				.join("\n")}`;
		})
		.join("\n");
	writeFileSync(join(consumer, "parity.ts"), `${parity}\n`);
	writeFileSync(
		join(consumer, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				module: "ESNext",
				moduleResolution: "Bundler",
				lib: ["ES2022"],
				typeRoots: [join(repo, "node_modules/@types")],
				types: ["bun"],
				strict: true,
				noEmit: true,
				skipLibCheck: false,
				verbatimModuleSyntax: true,
				isolatedModules: true,
			},
			files: ["use.ts", "parity.ts"],
		}),
	);
	const checked = await run(
		[
			join(repo, "node_modules/.bin/tsc"),
			"-p",
			join(consumer, "tsconfig.json"),
		],
		consumer,
	);
	expect(checked.code, checked.stdout + checked.stderr).toBe(0);
}, 120_000);
