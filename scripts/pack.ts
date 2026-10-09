/**
 * Builds the local distribution tarball of the World package.
 * Usage: bun scripts/pack.ts   (package script: pack:local)
 *
 * Output (gitignored, under artifacts/pack): the World tgz, the pinned
 * Memory type-distribution tgz, SHA-256 files and distribution-manifest.json.
 * Nothing is sent to a registry. The manifest is derived from the build output
 * and public types only; no sibling checkout is read.
 */
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import { isTest, walk } from "./files.ts";

const root = resolve(import.meta.dir, "..");
const out = resolve(root, "artifacts/pack");
const stage = resolve(out, "stage");
const sha = (data: string | Uint8Array) =>
	createHash("sha256").update(data).digest("hex");
const slash = (path: string) => path.replaceAll("\\", "/");

async function run(command: string[], cwd: string): Promise<string> {
	const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
	const [text, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) throw new Error(`${command.join(" ")} failed\n${text}${err}`);
	return text.trim();
}

const rootPackage = JSON.parse(
	readFileSync(resolve(root, "package.json"), "utf8"),
) as { name: string; version: string };
const memoryPackage = JSON.parse(
	readFileSync(resolve(root, "vendor/eumenes-memory/package.json"), "utf8"),
) as { name: string; version: string };
const memoryManifest = JSON.parse(
	readFileSync(resolve(root, "vendor/eumenes-memory/manifest.json"), "utf8"),
) as { kind: string; source: { sourceTreeSha256: string } };

rmSync(out, { recursive: true, force: true });
rmSync(resolve(root, "dist"), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
await run(
	[resolve(root, "node_modules/.bin/tsc"), "-p", "tsconfig.build.json"],
	root,
);

// Traceable source: every shipped source file (no tests) with its hash.
const sourceFiles = walk(resolve(root, "src"))
	.filter((file) => !isTest(file) && !file.includes("/test/"))
	.map((file) => ({
		path: slash(relative(root, file)),
		sha256: sha(readFileSync(file)),
	}))
	.sort((a, b) => (a.path < b.path ? -1 : 1));
const sourceDigest = sha(JSON.stringify(sourceFiles));
const commit = await run(["git", "rev-parse", "HEAD"], root).catch(
	() => undefined,
);
const dirty = commit
	? (await run(["git", "status", "--porcelain", "--", "src"], root))
			.split("\n")
			.filter(Boolean).length
	: undefined;

cpSync(resolve(root, "dist"), resolve(stage, "dist"), { recursive: true });
const leaked = walk(resolve(stage, "dist")).filter(
	(file) =>
		isTest(file.replace(/\.d\.ts$/, ".ts")) ||
		/\/(test|scripts|spec)\//.test(file),
);
if (leaked.length > 0)
	throw new Error(`test/script files in build output: ${leaked.join(", ")}`);

// Public surface and schema facts come from the built JS, not from src.
const rootModule = (await import(resolve(stage, "dist/index.js"))) as Record<
	string,
	unknown
>;
const sqliteModule = (await import(resolve(stage, "dist/sqlite.js"))) as {
	migrations: readonly string[];
	[key: string]: unknown;
};
const manifestModule = (await import(
	resolve(stage, "dist/infrastructure/sqlite/migrations/manifest.js")
)) as { migrationManifest: readonly { id: string; sha256: string }[] };
const versionsModule = (await import(
	resolve(stage, "dist/contracts/versions.js")
)) as { WORLD_CONTRACT_VERSION: number; CANONICAL_VERSION: number };
if (sqliteModule.migrations.length !== manifestModule.migrationManifest.length)
	throw new Error("migration list and pinned manifest differ");

if (dirty !== undefined && dirty > 0)
	console.warn(
		`warning: ${dirty} uncommitted src files; gitCommit does not identify this build, use sourceDigest`,
	);
const manifest = {
	kind: "world-local-distribution-not-published",
	package: { name: rootPackage.name, version: rootPackage.version },
	contract: {
		worldContractVersion: versionsModule.WORLD_CONTRACT_VERSION,
		canonicalVersion: versionsModule.CANONICAL_VERSION,
	},
	schema: {
		migrationCount: manifestModule.migrationManifest.length,
		migrations: manifestModule.migrationManifest,
	},
	exports: {
		".": { values: Object.keys(rootModule).sort() },
		"./sqlite": { values: Object.keys(sqliteModule).sort() },
	},
	source: {
		gitCommit: commit ?? null,
		srcDirtyFiles: dirty ?? null,
		sourceDigest,
		world_source_files: sourceFiles,
	},
	memoryTypeDependency: {
		name: memoryPackage.name,
		version: memoryPackage.version,
		distributionKind: memoryManifest.kind,
		sourceTreeSha256: memoryManifest.source.sourceTreeSha256,
	},
};
writeFileSync(
	resolve(stage, "distribution-manifest.json"),
	`${JSON.stringify(manifest, undefined, "\t")}\n`,
);

// The published package.json points at JS and declarations only.
writeFileSync(
	resolve(stage, "package.json"),
	`${JSON.stringify(
		{
			name: rootPackage.name,
			version: rootPackage.version,
			description: "Eumenes WorldModel (local distribution, unpublished).",
			type: "module",
			sideEffects: false,
			exports: {
				".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
				"./sqlite": {
					types: "./dist/sqlite.d.ts",
					default: "./dist/sqlite.js",
				},
				"./distribution-manifest.json": "./distribution-manifest.json",
				"./package.json": "./package.json",
			},
			files: ["dist", "distribution-manifest.json"],
			// eumenes-memory is a types-only requirement recorded in the manifest;
			// a peerDependency would make bun resolve it from the registry.
		},
		undefined,
		"\t",
	)}\n`,
);

async function pack(directory: string, destination: string) {
	await run(
		[process.execPath, "pm", "pack", "--destination", destination, "--quiet"],
		directory,
	);
}
await pack(stage, out);
await pack(resolve(root, "vendor/eumenes-memory"), out);
const tarballs = readdirSync(out).filter((name) => name.endsWith(".tgz"));
const checksums: Record<string, string> = {};
for (const name of tarballs) {
	checksums[name] = sha(readFileSync(resolve(out, name)));
	writeFileSync(
		resolve(out, `${name}.sha256`),
		`${checksums[name]}  ${name}\n`,
	);
}
writeFileSync(
	resolve(out, "pack-result.json"),
	`${JSON.stringify({ tarballs: checksums, sourceDigest }, undefined, "\t")}\n`,
);
rmSync(stage, { recursive: true, force: true });
console.log(
	JSON.stringify({ tarballs: checksums, sourceDigest }, undefined, 2),
);
