/** Wrap existing commands. All IO stays in eval; product contracts are unchanged. */
import { createHash } from "node:crypto";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
	watch,
} from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { walk } from "../../scripts/files.ts";
import {
	object,
	summarize,
	type Suite,
	type MeasurementSummary,
} from "./report.ts";

const SCHEMA = "world-measurement/1";
const roots = [
	"src",
	"eval",
	"scripts",
	"fixtures/performance",
	"fixtures/api-quality",
	"test/support",
	"vendor",
];
const config = [
	"package.json",
	"bun.lock",
	"tsconfig.json",
	"tsconfig.build.json",
];
const sha = (data: string | Uint8Array) =>
	createHash("sha256").update(data).digest("hex");
const json = (value: unknown) => JSON.stringify(value);
const save = (path: string, value: unknown) =>
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`, { flag: "wx" });
const isCapturedSource = (path: string) =>
	/\.(ts|[cm]?js|json|gz)$/.test(path) || path.endsWith("bun.lock");

export function sourceSnapshot(root: string) {
	const files = [
		...roots.flatMap((path) =>
			existsSync(join(root, path)) ? walk(join(root, path)) : [],
		),
		...config.map((path) => join(root, path)).filter(existsSync),
	]
		.filter((path) => !relative(root, path).split("/").includes("results"))
		.filter(isCapturedSource)
		.map((path) => ({
			path: relative(root, path),
			sha256: sha(readFileSync(path)),
		}))
		.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	// The shared extraction instruction/provider is a treatment, not a scoring rule.
	const treatment = (path: string) =>
		path.startsWith("src/") || path === "eval/extraction/providers.ts";
	return {
		files,
		digest: sha(json(files)),
		protocolDigest: sha(json(files.filter((file) => !treatment(file.path)))),
	};
}

// Hashes remain portable identities. Per-run file stamps additionally catch
// write→revert when the OS coalesces watch notifications; never compare these
// timestamps between machines/runs or include them in protocol digests.
function sourceStamps(root: string, files: readonly { path: string }[]) {
	return new Map(
		files.map(({ path }) => {
			const s = statSync(join(root, path), { bigint: true });
			return [path, `${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`] as const;
		}),
	);
}

function comparisonArgs(value: unknown, suite: unknown) {
	if (!Array.isArray(value) || !value.every((arg) => typeof arg === "string"))
		throw new Error("invalid recorded arguments");
	// Version labels may change with the shared extraction instruction. All
	// other flags (model, split, budgets, fixture behavior) must stay identical.
	return suite === "extraction"
		? value.filter(
				(_arg, i) =>
					value[i] !== "--prompt-version" &&
					value[i - 1] !== "--prompt-version",
			)
		: value;
}

function comparisonIdentity(summary: MeasurementSummary, suite: unknown) {
	const identity = object(JSON.parse(json(summary.identity)));
	if (suite === "extraction") {
		delete identity["prompt"];
		const provider = object(identity["provider"]);
		if (provider["config"] !== undefined)
			delete object(provider["config"])["instructionVersion"];
	}
	return identity;
}
const environment = () => ({
	bun: Bun.version,
	platform: platform(),
	os: release(),
	arch: arch(),
	cpu: cpus()[0]?.model ?? "unknown",
	cores: cpus().length,
	memory: totalmem(),
});

function monitorSources(root: string) {
	const changed = new Set<string>();
	const watchers: ReturnType<typeof watch>[] = [];
	try {
		for (const path of [...roots, ...config]) {
			const absolute = join(root, path);
			if (!existsSync(absolute)) continue;
			const directory = roots.includes(path);
			const watcher = watch(
				absolute,
				{ recursive: directory },
				(_event, name) => {
					const file = directory ? `${path}/${name ?? ""}` : path;
					if (file.split("/").includes("results")) return;
					if (
						!directory ||
						name === null ||
						isCapturedSource(file) ||
						!file.includes(".")
					)
						changed.add(file);
				},
			);
			watcher.on("error", () => changed.add("source-monitor-error"));
			watchers.push(watcher);
		}
	} catch (error) {
		for (const watcher of watchers) watcher.close();
		throw error;
	}
	return {
		changed,
		close: () => {
			for (const watcher of watchers) watcher.close();
		},
	};
}

export interface MeasurementOptions {
	readonly root: string;
	readonly output: string;
	readonly suite: Suite;
	readonly args: readonly string[];
}
interface Artifact {
	readonly path: string;
	readonly sha256: string;
}
export interface MeasurementResult {
	readonly schema: typeof SCHEMA;
	readonly status: "completed" | "failed" | "invalidated";
	readonly exitCode: number | null;
	readonly elapsedMs: number;
	readonly error: string | null;
	readonly artifacts: readonly Artifact[];
	readonly report: Artifact | null;
	readonly summary: MeasurementSummary | null;
	readonly changesDuringRun: readonly string[];
}
export type Execute = (
	command: readonly string[],
	cwd: string,
	output: string,
) => Promise<number>;
const execute: Execute = async (command, cwd, output) => {
	const stdout = openSync(join(output, "stdout.log"), "wx");
	const stderr = openSync(join(output, "stderr.log"), "wx");
	try {
		const child = Bun.spawn([...command], {
			cwd,
			stdout,
			stderr,
			env: { ...process.env, EUMENES_EVAL_EXTRACTION_PROVIDER: "" },
		});
		return await child.exited;
	} finally {
		closeSync(stdout);
		closeSync(stderr);
	}
};

export async function runMeasurement(
	options: MeasurementOptions,
	run: Execute = execute,
): Promise<MeasurementResult> {
	const { suite } = options;
	const root = resolve(options.root);
	const output = resolve(options.output);
	const args = [...options.args];
	if (
		args.includes("--json") ||
		args.includes("--out") ||
		args.includes("--record-dev")
	)
		throw new Error("measurement owns --json/--out/--record-dev");
	if (
		roots.some(
			(path) =>
				output === join(root, path) ||
				output.startsWith(`${join(root, path)}/`),
		)
	)
		throw new Error(
			"output overlaps measured sources; use artifacts/measurement",
		);
	// Provider modules must be covered by the source fingerprint, including edits.
	const moduleAt = args.indexOf("--provider-module");
	if (moduleAt >= 0) {
		const module = resolve(root, args[moduleAt + 1] ?? "");
		if (
			!sourceSnapshot(root).files.some(
				(file) => join(root, file.path) === module,
			)
		)
			throw new Error("provider module is outside the captured sources");
	}
	mkdirSync(dirname(output), { recursive: true });
	mkdirSync(output); // Exclusive run directory: never reuse or overwrite evidence.
	const reports = join(output, "reports");
	mkdirSync(reports);
	const before = sourceSnapshot(root);
	const beforeStamps = sourceStamps(root, before.files);
	const commit = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root });
	const command =
		suite === "performance"
			? [
					process.execPath,
					"scripts/bench-world.ts",
					...args,
					"--out",
					join(reports, "performance.json"),
				]
			: suite === "extraction"
				? [
						process.execPath,
						"eval/extraction/main.ts",
						...args,
						...(args[args.lastIndexOf("--split") + 1] === "dev"
							? ["--record-dev", join(reports, "dev-trace.jsonl")]
							: []),
						"--json",
						join(reports, "extraction.json"),
					]
				: suite === "pipeline"
					? [
							process.execPath,
							"eval/pipeline/main.ts",
							...args,
							"--out",
							join(reports, "pipeline.json"),
						]
					: [
							process.execPath,
							"eval/decision/main.ts",
							...args,
							"--out",
							reports,
						];
	save(join(output, "manifest.json"), {
		schema: SCHEMA,
		suite,
		args,
		command,
		startedAt: new Date().toISOString(),
		commit: commit.exitCode === 0 ? commit.stdout.toString().trim() : null,
		source: before,
		environment: environment(),
		note: "Harness evidence; dev first responses are recorded only in dev-trace.jsonl. Holdout stays redacted. Missing usage is unknown; no new model acceptance is inferred.",
	});
	const started = performance.now();
	let exitCode: number | null = null;
	let error: string | null = null;
	let summary: MeasurementSummary | null = null;
	let report: Artifact | null = null;
	let monitor: ReturnType<typeof monitorSources> | undefined;
	try {
		monitor = monitorSources(root);
		exitCode = await run(command, root, output);
		const names = readdirSync(reports).filter((name) => name.endsWith(".json"));
		if ((exitCode !== 0 && exitCode !== 1) || names.length !== 1)
			throw new Error("runner failed or did not produce exactly one report");
		const path = join("reports", names[0]!);
		const bytes = readFileSync(join(output, path));
		summary = summarize(suite, JSON.parse(bytes.toString()));
		report = { path, sha256: sha(bytes) };
	} catch (cause) {
		error = cause instanceof Error ? cause.message : "measurement failed";
	} finally {
		// Let filesystem events from the final workload turn reach the monitor.
		await new Promise<void>((resolve) => setImmediate(resolve));
		monitor?.close();
	}
	const elapsedMs = performance.now() - started;
	const after = sourceSnapshot(root);
	const afterStamps = sourceStamps(root, after.files);
	const changed = monitor?.changed ?? new Set<string>();
	for (const path of new Set([...beforeStamps.keys(), ...afterStamps.keys()]))
		if (beforeStamps.get(path) !== afterStamps.get(path)) changed.add(path);
	save(join(output, "source-after.json"), after);
	const artifacts = walk(output)
		.map((path) => ({
			path: relative(output, path),
			sha256: sha(readFileSync(path)),
		}))
		.sort((a, b) => (a.path < b.path ? -1 : 1));
	const result: MeasurementResult = {
		schema: SCHEMA,
		status:
			before.digest !== after.digest || changed.size > 0
				? "invalidated"
				: error === null
					? "completed"
					: "failed",
		exitCode,
		elapsedMs,
		error,
		artifacts,
		report,
		summary,
		changesDuringRun: [...changed].sort(),
	};
	save(join(output, "result.json"), result);
	return result;
}

function artifactPath(directory: string, path: string) {
	if (isAbsolute(path) || path.split(/[\\/]/).includes(".."))
		throw new Error("invalid artifact path");
	return join(directory, path);
}

/** Verify retained bytes, then rebuild metrics from the original report. */
export function loadMeasurement(directory: string) {
	const result = JSON.parse(
		readFileSync(join(directory, "result.json"), "utf8"),
	) as MeasurementResult;
	if (
		result.schema !== SCHEMA ||
		!["completed", "failed", "invalidated"].includes(result.status) ||
		!Array.isArray(result.artifacts)
	)
		throw new Error("unsupported measurement result");
	for (const file of result.artifacts) {
		if (sha(readFileSync(artifactPath(directory, file.path))) !== file.sha256)
			throw new Error(`artifact digest mismatch: ${file.path}`);
	}
	for (const required of [
		"manifest.json",
		"source-after.json",
		...(result.report ? [result.report.path] : []),
	])
		if (!result.artifacts.some((file) => file.path === required))
			throw new Error("missing artifact digest");
	const manifest = object(
		JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")),
	);
	if (
		manifest["schema"] !== SCHEMA ||
		!["extraction", "decision", "performance", "pipeline"].includes(
			String(manifest["suite"]),
		)
	)
		throw new Error("unsupported measurement manifest");
	if (result.status !== "completed" || result.report === null)
		throw new Error(`measurement is ${result.status}`);
	if (
		(result.exitCode !== 0 && result.exitCode !== 1) ||
		result.changesDuringRun.length > 0
	)
		throw new Error("measurement did not finish under stable sources");
	const after = object(
		JSON.parse(readFileSync(join(directory, "source-after.json"), "utf8")),
	);
	if (object(manifest["source"])["digest"] !== after["digest"])
		throw new Error("measurement sources changed");
	const bytes = readFileSync(artifactPath(directory, result.report.path));
	if (sha(bytes) !== result.report.sha256)
		throw new Error("report digest mismatch");
	const summary = summarize(
		manifest["suite"] as Suite,
		JSON.parse(bytes.toString()),
	);
	return { manifest, result, summary };
}

/** Deltas are descriptive; they do not establish causality or model acceptance. */
export function compareMeasurements(baseline: string, candidate: string) {
	try {
		const a = loadMeasurement(baseline);
		const b = loadMeasurement(candidate);
		const reasons: string[] = [];
		for (const key of ["suite", "environment"])
			if (json(a.manifest[key]) !== json(b.manifest[key]))
				reasons.push(`${key} differs`);
		if (
			json(comparisonArgs(a.manifest["args"], a.manifest["suite"])) !==
			json(comparisonArgs(b.manifest["args"], b.manifest["suite"]))
		)
			reasons.push("args differs");
		if (
			object(a.manifest["source"])["protocolDigest"] !==
			object(b.manifest["source"])["protocolDigest"]
		)
			reasons.push("evaluation protocol or inputs differ");
		if (
			json(comparisonIdentity(a.summary, a.manifest["suite"])) !==
			json(comparisonIdentity(b.summary, b.manifest["suite"]))
		)
			reasons.push("report settings/provider/dataset differ");
		if (
			json(Object.keys(a.summary.metrics).sort()) !==
			json(Object.keys(b.summary.metrics).sort())
		)
			reasons.push("metric coverage differs");
		if (reasons.length > 0)
			return { status: "incomparable" as const, reasons, deltas: [] };
		const deltas = Object.entries(a.summary.metrics).map(([key, metric]) => {
			const other = b.summary.metrics[key]!;
			if (metric.unit !== other.unit || metric.direction !== other.direction)
				throw new Error("metric contract differs");
			const delta =
				metric.value === null || other.value === null
					? null
					: other.value - metric.value;
			return {
				key,
				baseline: metric,
				candidate: other,
				delta,
				relativeDelta:
					delta === null || metric.value === 0 || metric.value === null
						? null
						: delta / metric.value,
			};
		});
		const files = (manifest: Record<string, unknown>) => {
			const source = object(manifest["source"]);
			if (!Array.isArray(source["files"]))
				throw new Error("missing source file hashes");
			return new Map(
				source["files"].map((entry) => {
					const file = object(entry);
					return [String(file["path"]), String(file["sha256"])];
				}),
			);
		};
		const before = files(a.manifest);
		const after = files(b.manifest);
		const changedFiles = [...new Set([...before.keys(), ...after.keys()])]
			.filter((path) => before.get(path) !== after.get(path))
			.sort();
		return {
			status: "comparable" as const,
			reasons,
			deltas,
			changedFiles,
			baselineIdentity: a.summary.identity,
			candidateIdentity: b.summary.identity,
			note: "Descriptive paired-run deltas only. Multiple implementation/instruction changes are not an isolated causal experiment; acceptance stays with the original harness.",
		};
	} catch (cause) {
		return {
			status: "incomparable" as const,
			reasons: [cause instanceof Error ? cause.message : "invalid measurement"],
			deltas: [],
		};
	}
}
