/**
 * Generates the local, hash-pinned Memory type distribution under
 * vendor/eumenes-memory from a read-only checkout of ../eumenes_memory.
 * This is a LOCAL generation, not an official Memory release. Memory files are
 * only read. Usage: bun scripts/vendor-memory.ts <checkout> --commit <full-sha> [--update-pin]
 */
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	renameSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { isTest, walk } from "./files.ts";

const root = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const sourcePath = args[0];
if (!sourcePath)
	throw new Error("MEMORY_SOURCE_REQUIRED: pass a clean checkout and --commit");
const flag = (name: string) => args[args.indexOf(name) + 1];
const expectedCommit = args.includes("--commit") ? flag("--commit") : undefined;
const updatePin = args.includes("--update-pin");
const memoryRoot = resolve(root, sourcePath);
const target = join(root, "vendor/eumenes-memory");
// Built beside the live directory and swapped in only after everything succeeded.
const next = `${target}.next`;
const previous = `${target}.prev`;
const sha = (data: string | Uint8Array) =>
	createHash("sha256").update(data).digest("hex");
const slash = (path: string) => path.replaceAll("\\", "/");

function hashTree(directory: string, skip: (file: string) => boolean) {
	return walk(directory)
		.filter((file) => !skip(file))
		.map((file) => ({
			path: slash(relative(directory, file)),
			sha256: sha(readFileSync(file)),
		}))
		.sort((a, b) => (a.path < b.path ? -1 : 1));
}
async function run(command: string[], cwd: string): Promise<string> {
	const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== 0) throw new Error(`${command.join(" ")} failed\n${out}${err}`);
	return out.trim();
}

const ownRepo = existsSync(join(memoryRoot, ".git"));
const commit = ownRepo
	? await run(["git", "rev-parse", "HEAD"], memoryRoot)
	: "unknown";
const dirty = ownRepo
	? await run(
			["git", "status", "--porcelain", "--", "src", "package.json"],
			memoryRoot,
		)
	: "unknown";
if (
	!ownRepo ||
	!expectedCommit ||
	!/^[0-9a-f]{40}$/.test(expectedCommit) ||
	expectedCommit !== commit ||
	dirty !== ""
)
	throw new Error(
		"MEMORY_COMMIT_MISMATCH_OR_DIRTY: clean checkout and exact --commit required",
	);
const existingManifest = JSON.parse(
	readFileSync(join(target, "manifest.json"), "utf8"),
);
const staging = mkdtempSync(join(tmpdir(), "world-vendor-memory-"));
try {
	if (!existsSync(join(memoryRoot, "src/index.ts")))
		throw new Error("G1_UNAVAILABLE: ../eumenes_memory/src/index.ts not found");
	const sources = hashTree(
		join(memoryRoot, "src"),
		(file) => isTest(file) || file.includes("/test/"),
	);
	cpSync(join(memoryRoot, "src"), join(staging, "src"), { recursive: true });
	writeFileSync(
		join(staging, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				module: "ESNext",
				moduleResolution: "Bundler",
				lib: ["ES2022"],
				typeRoots: [join(root, "node_modules/@types")],
				types: ["node"],
				strict: true,
				skipLibCheck: true,
				allowImportingTsExtensions: true,
				rewriteRelativeImportExtensions: true,
				noUncheckedIndexedAccess: true,
				exactOptionalPropertyTypes: true,
				verbatimModuleSyntax: true,
				isolatedModules: true,
				declaration: true,
				rootDir: "src",
				outDir: "out",
			},
			files: ["src/index.ts"],
		}),
	);
	await run([join(root, "node_modules/.bin/tsc"), "-p", staging], staging);
	rmSync(next, { recursive: true, force: true });
	mkdirSync(next, { recursive: true });
	cpSync(join(staging, "out"), join(next, "dist"), { recursive: true });
	const memoryPackage = JSON.parse(
		readFileSync(join(memoryRoot, "package.json"), "utf8"),
	) as { version: string };
	writeFileSync(
		join(next, "package.json"),
		`${JSON.stringify(
			{
				name: "eumenes-memory",
				version: `${memoryPackage.version}-local.0`,
				description:
					"Locally generated type/JS distribution of the public eumenes_memory exports. Not an official release.",
				private: true,
				type: "module",
				sideEffects: false,
				exports: {
					".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
					"./package.json": "./package.json",
				},
			},
			undefined,
			"\t",
		)}\n`,
	);
	const files = hashTree(next, (file) => file.endsWith("manifest.json"));
	writeFileSync(
		join(next, "manifest.json"),
		`${JSON.stringify(
			{
				kind: "local-generated-not-official-release",
				source: {
					repository: `${sourcePath} (read-only)`,
					packageVersion: memoryPackage.version,
					gitCommit: commit,
					sourceTarballSha256: null,
					srcDirtyFiles: 0,
					publicEntry: "src/index.ts",
					sourceFileCount: sources.length,
					sourceTreeSha256: sha(JSON.stringify(sources)),
				},
				generation: {
					command: "bun scripts/vendor-memory.ts",
					compiler: "tsc (declaration + JS, rewriteRelativeImportExtensions)",
					excluded: "test files",
				},
				files,
			},
			undefined,
			"\t",
		)}\n`,
	);
	const generatedManifest = JSON.parse(
		readFileSync(join(next, "manifest.json"), "utf8"),
	);
	if (
		!updatePin &&
		(generatedManifest.source.sourceTreeSha256 !==
			existingManifest.source.sourceTreeSha256 ||
			generatedManifest.source.packageVersion !==
				existingManifest.source.packageVersion ||
			JSON.stringify(generatedManifest.files) !==
				JSON.stringify(existingManifest.files))
	)
		throw new Error(
			"MEMORY_PIN_MISMATCH: review the contract change, then explicitly use --update-pin",
		);
	if (!updatePin)
		cpSync(join(target, "manifest.json"), join(next, "manifest.json"));
	// Swap: the old distribution stays intact until the new one is complete.
	rmSync(previous, { recursive: true, force: true });
	if (existsSync(target)) renameSync(target, previous);
	renameSync(next, target);
	if (updatePin)
		writeFileSync(
			join(root, "vendor/eumenes-memory.pin.json"),
			`${JSON.stringify({ manifestSha256: sha(readFileSync(join(target, "manifest.json"))) }, undefined, "\t")}\n`,
		);
	rmSync(previous, { recursive: true, force: true });
	console.log(`vendored ${files.length} files from ${sources.length} sources`);
} finally {
	rmSync(staging, { recursive: true, force: true });
	rmSync(next, { recursive: true, force: true });
}
