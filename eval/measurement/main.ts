import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareMeasurements, loadMeasurement, runMeasurement } from "./run.ts";
import type { Suite } from "./report.ts";

const usage = [
	"measure:world run --suite extraction|decision|performance|pipeline --out <new-directory> -- <existing runner flags>",
	"measure:world compare --baseline <directory> --candidate <directory> --out <new-file.json>",
	"measure:world replay --run <directory>",
].join("\n");

export async function main(
	argv: readonly string[],
	root: string,
): Promise<number> {
	const [mode, ...rest] = argv;
	const at = rest.indexOf("--");
	const head = at < 0 ? rest : rest.slice(0, at);
	const flags = new Map<string, string>();
	for (let i = 0; i < head.length; i += 2) {
		const key = head[i]!;
		const value = head[i + 1];
		if (
			!key.startsWith("--") ||
			value === undefined ||
			value.startsWith("--") ||
			flags.has(key)
		)
			throw new Error(usage);
		flags.set(key, value);
	}
	const take = (key: string) => {
		const value = flags.get(key);
		if (value === undefined) throw new Error(usage);
		flags.delete(key);
		return value;
	};
	const done = () => {
		if (flags.size > 0) throw new Error(usage);
	};
	if (mode === "run") {
		const suite = take("--suite");
		const output = resolve(take("--out"));
		done();
		if (!["extraction", "decision", "performance", "pipeline"].includes(suite))
			throw new Error(usage);
		const result = await runMeasurement({
			root,
			output,
			suite: suite as Suite,
			args: at < 0 ? [] : rest.slice(at + 1),
		});
		console.log(
			JSON.stringify({
				status: result.status,
				exitCode: result.exitCode,
				output,
				error: result.error,
			}),
		);
		return result.status === "completed" ? (result.exitCode ?? 1) : 2;
	}
	if (at >= 0) throw new Error(usage);
	if (mode === "compare") {
		const baseline = take("--baseline");
		const candidate = take("--candidate");
		const output = take("--out");
		done();
		const comparison = compareMeasurements(baseline, candidate);
		writeFileSync(output, `${JSON.stringify(comparison, null, "\t")}\n`, {
			flag: "wx",
		});
		console.log(
			JSON.stringify({
				status: comparison.status,
				reasons: comparison.reasons,
				output,
			}),
		);
		return comparison.status === "comparable" ? 0 : 2;
	}
	if (mode === "replay") {
		const directory = take("--run");
		done();
		console.log(JSON.stringify(loadMeasurement(directory).summary, null, "\t"));
		return 0;
	}
	throw new Error(usage);
}

if (import.meta.main) {
	try {
		process.exitCode = await main(
			process.argv.slice(2),
			fileURLToPath(new URL("../..", import.meta.url)),
		);
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : "measurement failed",
		);
		process.exitCode = 2;
	}
}
