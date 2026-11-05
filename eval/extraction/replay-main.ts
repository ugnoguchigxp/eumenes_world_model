import { readFileSync, writeFileSync } from "node:fs";
import { loadDataset } from "./dataset.ts";
import { createDevReplay } from "./dev-replay.ts";
import { runEvaluation } from "./runner.ts";

const [trace, output, ...extra] = process.argv.slice(2);
if (!trace || !output || extra.length)
	throw new Error(
		"usage: eval:replay-extraction <dev-trace.jsonl> <new-report.json>",
	);
const replay = createDevReplay(readFileSync(trace, "utf8"));
const report = await runEvaluation({
	dataset: loadDataset(),
	split: "dev",
	mode: "tuning",
	promptVersion: "recorded-dev-replay",
	provider: replay.provider,
});
replay.assertComplete();
writeFileSync(output, `${JSON.stringify(report, null, "\t")}\n`, {
	flag: "wx",
});
console.log(
	JSON.stringify({
		replayed: replay.consumed(),
		realModelCalls: 0,
		acceptance: report.acceptance,
	}),
);
