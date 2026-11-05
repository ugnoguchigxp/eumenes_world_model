import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pipelineCases } from "./fixtures.ts";
import { replayCase } from "./replay.ts";
import type { PipelineCase } from "./types.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
	const index = args.indexOf(name);
	return index < 0 ? undefined : args[index + 1];
};
if (
	args.some((arg, i) => i % 2 === 0 && arg !== "--out" && arg !== "--replay") ||
	args.length % 2 !== 0
)
	throw new Error(
		"usage: eval:pipeline --out <new.json> [--replay <saved-report.json>]",
	);
const output = flag("--out");
if (!output) throw new Error("--out is required");
const replay = flag("--replay");
const inputs: readonly PipelineCase[] = replay
	? (
			JSON.parse(readFileSync(replay, "utf8")) as {
				cases: { input: PipelineCase }[];
			}
		).cases.map((c) => c.input)
	: pipelineCases;
if (inputs.length === 0 || inputs.length > 100)
	throw new Error("invalid pipeline case count");
const cases = inputs.map(replayCase);
const suiteDigest = createHash("sha256")
	.update(JSON.stringify(inputs))
	.digest("hex");
writeFileSync(
	output,
	`${JSON.stringify({ schema: "world-pipeline-eval/1", evidence: "fixture-replay-sqlite", suiteDigest, modelCalls: 0, acceptance: false, cases }, null, "\t")}\n`,
	{ flag: "wx" },
);
console.log(
	JSON.stringify({
		output,
		cases: cases.length,
		modelCalls: 0,
		acceptance: false,
	}),
);
