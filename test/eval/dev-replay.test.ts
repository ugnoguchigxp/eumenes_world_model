import { expect, test } from "bun:test";
import { DATASET_SHA256, loadDataset } from "../../eval/extraction/dataset.ts";
import { createDevReplay } from "../../eval/extraction/dev-replay.ts";
import {
	createFixtureProvider,
	ManualClock,
} from "../../eval/extraction/fixture-provider.ts";
import { runEvaluation, type DevSample } from "../../eval/extraction/runner.ts";

test("first dev responses replay the original score with no real provider authority", async () => {
	const dataset = loadDataset();
	const clock = new ManualClock();
	const provider = createFixtureProvider(dataset, "oracle", { clock });
	const samples: DevSample[] = [];
	const original = await runEvaluation({
		dataset,
		provider,
		clock,
		split: "dev",
		mode: "tuning",
		promptVersion: "frozen",
		onDevSample: (sample) => samples.push(sample),
	});
	const trace = [
		{
			schema: "world-extraction-dev/1",
			datasetSha256: DATASET_SHA256,
			promptVersion: "frozen",
			provider: provider.info,
		},
		...samples,
	]
		.map((line) => JSON.stringify(line))
		.join("\n");
	const replay = createDevReplay(trace);
	const report = await runEvaluation({
		dataset,
		provider: replay.provider,
		split: "dev",
		mode: "tuning",
		promptVersion: "replay",
	});
	expect(samples.length).toBe(100);
	expect(replay.consumed()).toBe(100);
	expect(() => replay.assertComplete()).not.toThrow();
	expect(report.score).toEqual(original.score);
	expect(report.acceptance.eligible).toBe(false);
	expect(report.provider.kind).toBe("fixture");
	expect(() =>
		createDevReplay(trace.split("\n").slice(0, 3).join("\n")),
	).toThrow("incomplete");
});

test("holdout capture is refused before any provider call; failed capture stops calls", async () => {
	const dataset = loadDataset();
	let calls = 0;
	const provider = {
		info: {
			kind: "fixture" as const,
			modelId: "probe",
			modelVersion: "1",
			config: {},
		},
		async extract() {
			calls++;
			return { output: { candidates: [] } };
		},
	};
	await expect(
		runEvaluation({
			dataset,
			provider,
			split: "holdout",
			mode: "acceptance",
			promptVersion: "frozen",
			onDevSample: () => {},
		}),
	).rejects.toThrow("dev-only");
	expect(calls).toBe(0);
	await expect(
		runEvaluation({
			dataset,
			provider,
			split: "dev",
			mode: "tuning",
			promptVersion: "frozen",
			onDevSample: () => {
				throw new Error("capture storage failed");
			},
		}),
	).rejects.toThrow("capture storage failed");
	expect(calls).toBe(1);
});

test("oversized first output stays a failure and is not stored as replayable raw data", async () => {
	const dataset = loadDataset();
	let captured: DevSample | undefined;
	const provider = {
		info: {
			kind: "fixture" as const,
			modelId: "oversize",
			modelVersion: "1",
			config: {},
		},
		async extract() {
			return { output: "x".repeat(65537) };
		},
	};
	await expect(
		runEvaluation({
			dataset,
			provider,
			split: "dev",
			mode: "tuning",
			promptVersion: "frozen",
			onDevSample: (sample) => {
				captured = sample;
				throw new Error("stop after first");
			},
		}),
	).rejects.toThrow("stop after first");
	expect(captured?.outputOmitted).toBe(true);
	expect(captured?.output).toBeNull();
	expect(captured?.status).toBe("invalid_output");
});
