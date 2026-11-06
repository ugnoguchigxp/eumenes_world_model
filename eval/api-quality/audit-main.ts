/** Explicit offline entry point. Historical cells are read, never overwritten. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { loadQuality, fixtureDigests } from "./dataset.ts";
import {
	auditRepresentation,
	singleQuoteRepresentation,
} from "./contract-audit.ts";
import { summary } from "./main.ts";
import { sourceSnapshot } from "../measurement/run.ts";

export function auditHistoricalCells(bytes: string) {
	const cells = bytes
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	return summary(cells)
		.filter((s) => s.cases > 0)
		.map((s) => ({
			profile: s.profile,
			extractor: s.extractor,
			reader: s.reader,
			cases: s.cases,
			worldVsRaw: s.worldVsRaw,
			worldVsPlain: s.worldVsPlain,
			byArm: s.byArm,
		}));
}

if (import.meta.main) {
	const [directory, historicalFile, ...rest] = process.argv.slice(2);
	if (!directory || rest.length)
		throw new Error(
			"Usage: bun eval/api-quality/audit-main.ts <new-output> [historical-cells.jsonl]",
		);
	mkdirSync(directory, { recursive: false });
	const bytes = historicalFile
		? readFileSync(historicalFile, "utf8")
		: undefined;
	const report = {
		protocol: "evaluation-contract-audit/1",
		modelCalls: 0,
		fixtureDigests,
		source: sourceSnapshot(resolve(import.meta.dir, "../..")),
		representation: auditRepresentation(loadQuality("independent")),
		legacyRepresentation: auditRepresentation(
			loadQuality("independent"),
			singleQuoteRepresentation,
		),
		historical:
			bytes === undefined
				? null
				: {
						file: resolve(historicalFile!),
						sha256: createHash("sha256").update(bytes).digest("hex"),
						comparisons: auditHistoricalCells(bytes),
					},
		interpretation:
			"Audit evidence only; historical acceptance failures remain unchanged.",
	};
	writeFileSync(
		join(directory, "audit.json"),
		JSON.stringify(report, null, 2) + "\n",
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			modelCalls: 0,
			representation: report.representation.status,
			historicalComparisons: report.historical?.comparisons.length ?? 0,
		}),
	);
}
