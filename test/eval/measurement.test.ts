import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	compareMeasurements,
	loadMeasurement,
	runMeasurement,
	sourceSnapshot,
} from "../../eval/measurement/run.ts";
import { summarize } from "../../eval/measurement/report.ts";

function performanceReport(rawMs: number[] = [1, 2, 3]) {
	return {
		thresholds: { slice10kP95Ms: 50, writerP95Ms: 20 },
		results: [
			{
				claims: 1000,
				seed: 42,
				fullRebuildMs: 5,
				slice: {
					runs: 3,
					warmup: 1,
					rawMs,
					maxFetchedRows: 50,
					maxExpandedRows: 20,
					maxOutputBytes: 100,
					partialRuns: 3,
				},
				writer: { runs: 3, warmup: 1, rawMs: [0.1, 0.2, 0.3] },
				unindexedQueries: [],
			},
		],
	};
}

const root = resolve(import.meta.dir, "../..");

test("module JavaScript participates in source identity and invalidates runs even after a revert", async () => {
	const directory = mkdtempSync(join(tmpdir(), "world-measure-modules-"));
	try {
		const workspace = join(directory, "workspace");
		mkdirSync(join(workspace, "test/support"), { recursive: true });
		for (const ext of ["mjs", "cjs"]) {
			const path = `test/support/probe.${ext}`;
			const source = join(workspace, path);
			writeFileSync(source, "const version = 1;");
			const before = sourceSnapshot(workspace);
			expect(before.files.map((f) => f.path)).toContain(path);
			writeFileSync(source, "const version = 2;");
			expect(sourceSnapshot(workspace).protocolDigest).not.toBe(
				before.protocolDigest,
			);
			const run = await runMeasurement(
				{
					root: workspace,
					output: join(directory, ext),
					suite: "performance",
					args: [],
				},
				async (command) => {
					writeFileSync(source, "const version = 3;");
					await new Promise((resolve) => setTimeout(resolve, 20));
					writeFileSync(source, "const version = 2;");
					writeFileSync(command.at(-1)!, JSON.stringify(performanceReport()));
					return 0;
				},
			);
			expect(run.status).toBe("invalidated");
			expect(run.changesDuringRun).toContain(path);
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("measurement wraps the real extraction CLI, retains reports and refuses overwrite", async () => {
	const directory = mkdtempSync(join(tmpdir(), "world-measure-"));
	try {
		const output = join(directory, "baseline");
		const result = await runMeasurement({
			root,
			output,
			suite: "extraction",
			args: ["--fixture", "oracle", "--split", "dev"],
		});
		expect(result.status).toBe("completed");
		const saved = loadMeasurement(output);
		expect(saved.summary.evidence).toBe("fixture");
		expect(saved.summary.metrics["adoptRecall"]?.value).toBe(1);
		expect(saved.summary.metrics["adoptRecall"]?.denominator).toBe(66);
		expect(saved.summary.metrics["usageSamples"]?.value).toBe(100);
		expect(saved.summary.acceptance).toBe(false);
		expect(compareMeasurements(output, output).status).toBe("comparable");
		const replay = Bun.spawnSync(
			[process.execPath, "eval/measurement/main.ts", "replay", "--run", output],
			{ cwd: root },
		);
		expect(replay.exitCode).toBe(0);
		expect(
			JSON.parse(replay.stdout.toString()).metrics.adoptRecall.denominator,
		).toBe(66);
		const comparison = join(directory, "comparison.json");
		const command = [
			process.execPath,
			"eval/measurement/main.ts",
			"compare",
			"--baseline",
			output,
			"--candidate",
			output,
			"--out",
			comparison,
		];
		expect(Bun.spawnSync(command, { cwd: root }).exitCode).toBe(0);
		expect(Bun.spawnSync(command, { cwd: root }).exitCode).toBe(2);
		// Construct intact bundles from other environments/models, rather than
		// relying only on an argument-label mismatch to protect comparison.
		for (const variant of ["environment", "model", "dataset"]) {
			const other = join(directory, variant);
			cpSync(output, other, { recursive: true });
			const relative =
				variant === "environment" ? "manifest.json" : saved.result.report!.path;
			const file = join(other, relative);
			const data = JSON.parse(readFileSync(file, "utf8"));
			if (variant === "environment") data.environment.cpu = "other CPU";
			if (variant === "model") data.provider.modelId = "other-model";
			if (variant === "dataset") data.datasetVersion = "other-dataset";
			writeFileSync(file, JSON.stringify(data));
			const resultPath = join(other, "result.json");
			const metadata = JSON.parse(readFileSync(resultPath, "utf8"));
			const hash = createHash("sha256")
				.update(readFileSync(file))
				.digest("hex");
			metadata.artifacts.find(
				(artifact: { path: string }) => artifact.path === relative,
			).sha256 = hash;
			if (variant !== "environment") metadata.report.sha256 = hash;
			writeFileSync(resultPath, JSON.stringify(metadata));
			expect(compareMeasurements(output, other).status).toBe("incomparable");
		}
		const interrupted = join(directory, "interrupted");
		cpSync(output, interrupted, { recursive: true });
		rmSync(join(interrupted, "result.json"));
		expect(compareMeasurements(output, interrupted).status).toBe(
			"incomparable",
		);
		const cachedPath = join(output, "result.json");
		const cached = JSON.parse(readFileSync(cachedPath, "utf8"));
		cached.summary.metrics.adoptRecall.value = 0;
		writeFileSync(cachedPath, JSON.stringify(cached));
		expect(loadMeasurement(output).summary.metrics["adoptRecall"]?.value).toBe(
			1,
		);
		await expect(
			runMeasurement({ root, output, suite: "extraction", args: [] }),
		).rejects.toThrow();
		const report = join(output, saved.result.report!.path);
		writeFileSync(report, `${readFileSync(report, "utf8")} `);
		expect(() => loadMeasurement(output)).toThrow("artifact digest");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}, 30_000);

test("code changes can be compared; protocol/settings changes and mid-run edits cannot", async () => {
	const directory = mkdtempSync(join(tmpdir(), "world-measure-"));
	try {
		const workspace = join(directory, "workspace");
		mkdirSync(join(workspace, "src"), { recursive: true });
		mkdirSync(join(workspace, "eval"));
		const source = join(workspace, "src/probe.ts");
		writeFileSync(source, "export const version = 1;");
		const capture = (
			name: string,
			rawMs = [1, 2, 3],
			edit = false,
			args: string[] = [],
		) =>
			runMeasurement(
				{
					root: workspace,
					output: join(directory, name),
					suite: "performance",
					args,
				},
				async (command) => {
					writeFileSync(
						command.at(-1)!,
						JSON.stringify(performanceReport(rawMs)),
					);
					if (edit) writeFileSync(source, "export const version = 3;");
					return 0;
				},
			);
		await capture("a");
		writeFileSync(source, "export const version = 2;");
		await capture("b", [1, 2, 4]);
		const compared = compareMeasurements(
			join(directory, "a"),
			join(directory, "b"),
		);
		expect(compared.status).toBe("comparable");
		expect(compared.deltas.find((m) => m.key === "1000.slice.p95")?.delta).toBe(
			1,
		);
		await capture("settings", [1, 2, 3], false, ["--seed", "7"]);
		expect(
			compareMeasurements(join(directory, "a"), join(directory, "settings"))
				.reasons,
		).toContain("args differs");
		writeFileSync(
			join(workspace, "eval/protocol.ts"),
			"export const threshold = 0;",
		);
		await capture("protocol");
		expect(
			compareMeasurements(join(directory, "a"), join(directory, "protocol"))
				.reasons,
		).toContain("evaluation protocol or inputs differ");
		const invalidated = await capture("edited", [1, 2, 3], true);
		expect(invalidated.status).toBe("invalidated");
		expect(() => loadMeasurement(join(directory, "edited"))).toThrow(
			"invalidated",
		);
		const original = readFileSync(source, "utf8");
		const reverted = await runMeasurement(
			{
				root: workspace,
				output: join(directory, "reverted"),
				suite: "performance",
				args: [],
			},
			async (command) => {
				writeFileSync(source, "temporary edit during measurement");
				await new Promise((resolve) => setTimeout(resolve, 20));
				writeFileSync(source, original);
				writeFileSync(command.at(-1)!, JSON.stringify(performanceReport()));
				return 0;
			},
		);
		expect(reverted.status).toBe("invalidated");
		expect(reverted.changesDuringRun).toContain("src/probe.ts");
		const malformed = await capture("incomplete", [1, 2]);
		expect(malformed.status).toBe("failed");
		expect(malformed.error).toContain("incomplete performance samples");
		const thrown = await runMeasurement(
			{
				root: workspace,
				output: join(directory, "thrown"),
				suite: "performance",
				args: [],
			},
			async () => {
				throw new Error("transport failure");
			},
		);
		expect(thrown.status).toBe("failed");
		expect(thrown.exitCode).toBeNull();
		expect(
			readFileSync(join(directory, "thrown/result.json"), "utf8"),
		).toContain("transport failure");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("unknown usage is not zero and invalid report numbers never become metrics", () => {
	expect(() =>
		summarize("performance", performanceReport([1, Number.NaN, 3])),
	).toThrow("finite");
	expect(() => summarize("performance", { results: [] })).toThrow("empty");
	const data = {
		evaluationVersion: "e",
		datasetVersion: "d",
		split: "holdout",
		promptVersion: "p",
		provider: { kind: "fixture" },
		acceptance: { modelAccepted: false },
		usage: null,
		score: {
			thresholdVersion: "t",
			caseCount: 1,
			evaluatedCount: 1,
			statusCounts: { error: 1 },
			violationCounts: { scope_leak: 0 },
			missingCount: 0,
			adoptedPrecision: { numerator: 0, denominator: 0 },
			adoptRecall: { numerator: 0, denominator: 1 },
			holdRecall: { numerator: 0, denominator: 0 },
			classificationAccuracy: { numerator: 0, denominator: 1 },
		},
		performance: { latencyP95Ms: 10, failureCount: 1, inputBytesTotal: 1 },
	};
	const summary = summarize("extraction", data);
	expect(summary.metrics["inputTokens"]?.value).toBeNull();
	expect(summary.metrics["adoptedPrecision"]?.value).toBeNull();
	expect(summary.metrics["adoptRecall"]?.value).toBe(0);
	expect(summary.metrics["failures"]?.value).toBe(1);
	expect(() =>
		summarize("extraction", {
			...data,
			score: { ...data.score, caseCount: 0 },
		}),
	).toThrow("empty");
});

test("extraction instruction version changes stay visible; split changes are not comparable", async () => {
	const directory = mkdtempSync(join(tmpdir(), "world-measure-"));
	try {
		for (const [name, split, prompt] of [
			["a", "dev", "instruction-1"],
			["b", "dev", "instruction-2"],
			["c", "holdout", "instruction-2"],
		]) {
			await runMeasurement({
				root,
				output: join(directory, name!),
				suite: "extraction",
				args: [
					"--fixture",
					"oracle",
					"--split",
					split!,
					"--prompt-version",
					prompt!,
				],
			});
		}
		const compared = compareMeasurements(
			join(directory, "a"),
			join(directory, "b"),
		);
		expect(compared.status).toBe("comparable");
		expect(compared.baselineIdentity).toHaveProperty("prompt", "instruction-1");
		expect(compared.candidateIdentity).toHaveProperty(
			"prompt",
			"instruction-2",
		);
		expect(
			compareMeasurements(join(directory, "a"), join(directory, "c")).status,
		).toBe("incomparable");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}, 30_000);

test("holdout uses the existing redaction; degradation and failures remain measured", async () => {
	const directory = mkdtempSync(join(tmpdir(), "world-measure-"));
	try {
		const output = join(directory, "holdout");
		const result = await runMeasurement({
			root,
			output,
			suite: "extraction",
			args: ["--fixture", "overconfident", "--split", "holdout"],
		});
		expect(result.status).toBe("completed");
		expect(result.exitCode).toBe(1);
		const saved = loadMeasurement(output);
		const report = JSON.parse(
			readFileSync(join(output, result.report!.path), "utf8"),
		);
		expect(report.samples).toBeUndefined();
		expect(report.score.adoptRecall.failingCaseIds).toBeUndefined();
		expect(saved.summary.metrics["adoptRecall"]?.denominator).toBe(66);
		expect(saved.summary.metrics["violations"]!.value).toBeGreaterThan(0);
		const failed = await runMeasurement({
			root,
			output: join(directory, "failed"),
			suite: "extraction",
			args: [],
		});
		expect(failed.status).toBe("failed");
		expect(failed.report).toBeNull();
		expect(compareMeasurements(output, join(directory, "failed")).status).toBe(
			"incomparable",
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}, 30_000);

test("the decision CLI retains evidence, cost and per-condition failures", async () => {
	const directory = mkdtempSync(join(tmpdir(), "world-measure-"));
	try {
		const output = join(directory, "decision");
		await runMeasurement({
			root,
			output,
			suite: "decision",
			args: ["--fixture", "leaky", "--mode", "evaluation"],
		});
		const saved = loadMeasurement(output);
		expect(saved.summary.evidence).toBe("fixture");
		expect(saved.summary.acceptance).toBe(false);
		expect(
			saved.summary.metrics["memory-world.safetyFailures"]!.value,
		).toBeGreaterThan(0);
		expect(
			saved.summary.metrics["memory-world.inputTokens"]!.value,
		).toBeGreaterThan(0);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}, 30_000);
