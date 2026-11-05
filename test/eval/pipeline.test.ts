import { expect, test } from "bun:test";
import { pipelineCases } from "../../eval/pipeline/fixtures.ts";
import { replayCase } from "../../eval/pipeline/replay.ts";
import { runMeasurement, loadMeasurement } from "../../eval/measurement/run.ts";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("public SQLite path preserves candidates, explicit adoption and source parity", () => {
	const input = pipelineCases[0]!;
	const result = replayCase(input);
	expect(result.stages.validated.length).toBe(6);
	expect(result.stages.stored.length).toBe(6);
	expect(result.stages.adopted.length).toBe(6);
	expect(result.queries[0]!.arms.raw.bytes).toBeLessThanOrEqual(
		input.queries[0]!.maxBytes,
	);
	expect(result.queries[0]!.arms.subject.bytes).toBeLessThanOrEqual(
		input.queries[0]!.maxBytes,
	);
	expect(result.queries[0]!.arms.selected.plainEvidenceIds).toEqual(
		result.queries[0]!.arms.selected.evidenceIds,
	);
});

test("a valid quote never grants adoption and malformed output never becomes a fact", () => {
	const input = pipelineCases[0]!;
	const held = replayCase({ ...input, adoptIndexes: [] });
	expect(held.stages.stored.length).toBe(6);
	expect(held.stages.adopted).toEqual([]);
	const malformed = replayCase({ ...input, rawOutput: "broken JSON" });
	expect(malformed.validation.status).toBe("rejected");
	expect(malformed.stages.stored).toEqual([]);
});

test("condition and validTime survive validation, persistence and public Slice", () => {
	const result = replayCase(
		pipelineCases.find((c) => c.id === "dated-values")!,
	);
	const query = result.queries[0]!;
	const units = query.arms.subject.units;
	expect(units.length).toBe(2);
	expect(units.every((unit) => unit.validTime !== undefined)).toBe(true);
	expect(units.every((unit) => unit.condition.kind === "expression")).toBe(
		true,
	);
	expect(
		query.arms.subject.evaluations.map((entry) => entry.result.result).sort(),
	).toEqual(["satisfied", "violated"]);
	expect(query.arms.subject.plainEvidenceIds).toEqual(
		query.arms.subject.evidenceIds,
	);
	const wire = JSON.parse(query.arms.subject.text);
	expect(wire.format).toBe("indexed-sources/1");
	expect(
		wire.slice.units.map((unit: { sources: number[] }) => ({
			...unit,
			sources: unit.sources.map((index) => wire.slice.sourceVersions[index]),
		})),
	).toEqual(units);
});

test("host-selected chain evidence fits the unchanged complete-presentation budget", () => {
	for (const input of pipelineCases.slice(0, 3)) {
		const query = replayCase(input).queries[0]!;
		expect(query.arms.subject.status).toBe("overflow");
		expect(query.arms.selected.status).toBe("partial");
		expect(query.recall.selected).toEqual({ numerator: 2, denominator: 2 });
		expect(query.arms.selected.bytes).toBeLessThanOrEqual(
			input.queries[0]!.maxBytes,
		);
		expect(query.arms.selected.plainEvidenceIds).toEqual(
			query.arms.selected.evidenceIds,
		);
	}
});

test("out-of-range quotes stay rejected and do not fall back to source text", () => {
	const input = structuredClone(pipelineCases[0]!);
	const output = input.rawOutput as {
		candidates: { quote: { endByte: number } }[];
	};
	output.candidates[4]!.quote.endByte = 99999;
	const result = replayCase(input);
	expect(result.validation.verdicts[4]!.status).toBe("rejected");
	expect(result.stages.stored).not.toContain("s4");
	expect(result.stages.adopted).not.toContain("s4");
});

test("bounded retrieval coverage is preserved in both model-facing presentations", () => {
	const input = structuredClone(pipelineCases[0]!);
	const output = input.rawOutput as { candidates: { payload: unknown }[] };
	output.candidates[5]!.payload = {
		kind: "relation",
		relation: "related_to",
		object: { kind: "id", id: "person" },
	};
	const result = replayCase({
		...input,
		queries: input.queries.map((query) => ({ ...query, depth: 1 })),
	});
	const query = result.queries[0]!;
	expect(query.coverage.partial).toBe(true);
	expect(query.coverage.reasons).toContain("DEPTH_LIMIT");
	for (const text of [
		query.arms.selected.text,
		query.arms.selected.plainText,
	]) {
		const wire = JSON.parse(text);
		expect(wire.retrievalCoverage).toEqual(query.coverage);
		expect(wire.complete).toBe(false);
	}
});

test("the measured pipeline report replays its exact frozen inputs without a model", async () => {
	const root = resolve(import.meta.dir, "../..");
	const directory = mkdtempSync(join(tmpdir(), "world-pipeline-"));
	try {
		const output = join(directory, "run");
		const result = await runMeasurement({
			root,
			output,
			suite: "pipeline",
			args: [],
		});
		expect(result.status).toBe("completed");
		const saved = loadMeasurement(output);
		expect(saved.summary.metrics["modelCalls"]?.value).toBe(0);
		const original = join(output, saved.result.report!.path);
		const replayed = join(directory, "replayed.json");
		const child = Bun.spawnSync(
			[
				process.execPath,
				"eval/pipeline/main.ts",
				"--out",
				replayed,
				"--replay",
				original,
			],
			{ cwd: root },
		);
		expect(child.exitCode).toBe(0);
		const a = JSON.parse(readFileSync(original, "utf8"));
		const b = JSON.parse(readFileSync(replayed, "utf8"));
		expect(b).toEqual(a);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}, 30_000);
