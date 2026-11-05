/** Content-free projections of existing reports; no new scoring or acceptance. */
import { conditionIds } from "../decision/types.ts";
export type Suite = "extraction" | "decision" | "performance" | "pipeline";
export interface Metric {
	readonly value: number | null;
	readonly unit: "count" | "ratio" | "ms" | "bytes" | "tokens";
	readonly direction: "higher" | "lower" | "observe";
	readonly numerator?: number;
	readonly denominator?: number;
}
export interface MeasurementSummary {
	readonly evidence: string;
	readonly identity: unknown;
	/** Original harness verdict only; never inferred from a metric delta. */
	readonly acceptance: boolean | null;
	readonly metrics: Readonly<Record<string, Metric>>;
}

export function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error("expected report object");
	return value as Record<string, unknown>;
}
export function number(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
		throw new Error("expected nonnegative finite report number");
	return value;
}
function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error("expected report array");
	return value;
}
function string(value: unknown): string {
	if (typeof value !== "string" || value.length === 0)
		throw new Error("expected report string");
	return value;
}
function boolean(value: unknown): boolean {
	if (typeof value !== "boolean") throw new Error("expected report boolean");
	return value;
}

export function summarize(suite: Suite, input: unknown): MeasurementSummary {
	const report = object(input);
	const metrics: Record<string, Metric> = {};
	const add = (
		key: string,
		value: unknown,
		unit: Metric["unit"],
		direction: Metric["direction"] = "lower",
	) => {
		metrics[key] = {
			value: value === null ? null : number(value),
			unit,
			direction,
		};
	};
	if (suite === "pipeline") {
		if (
			report["schema"] !== "world-pipeline-eval/1" ||
			report["evidence"] !== "fixture-replay-sqlite" ||
			report["acceptance"] !== false
		)
			throw new Error("unsupported pipeline report");
		const cases = array(report["cases"]);
		if (cases.length === 0) throw new Error("empty pipeline workload");
		for (const arm of ["raw", "subject", "selected"]) {
			let numerator = 0;
			let denominator = 0;
			let totalBytes = 0;
			for (const entry of cases)
				for (const query of array(object(entry)["queries"])) {
					const q = object(query);
					const rate = object(object(q["recall"])[arm]);
					numerator += number(rate["numerator"]);
					denominator += number(rate["denominator"]);
					totalBytes += number(object(object(q["arms"])[arm])["bytes"]);
				}
			if (numerator > denominator || denominator === 0)
				throw new Error("invalid pipeline denominator");
			metrics[`${arm}.recall`] = {
				value: numerator / denominator,
				numerator,
				denominator,
				unit: "ratio",
				direction: "higher",
			};
			add(`${arm}.bytes`, totalBytes, "bytes", "observe");
		}
		add("modelCalls", report["modelCalls"], "count", "observe");
		return {
			evidence: "fixture-replay-sqlite",
			acceptance: false,
			identity: {
				schema: report["schema"],
				suiteDigest: string(report["suiteDigest"]),
				cases: cases.length,
			},
			metrics,
		};
	}
	if (suite === "extraction") {
		const score = object(report["score"]);
		const performance = object(report["performance"]);
		const provider = object(report["provider"]);
		if (number(score["caseCount"]) === 0)
			throw new Error("empty extraction workload");
		for (const key of [
			"adoptedPrecision",
			"adoptRecall",
			"holdRecall",
			"classificationAccuracy",
		]) {
			const rate = object(score[key]);
			const numerator = number(rate["numerator"]);
			const denominator = number(rate["denominator"]);
			if (numerator > denominator) throw new Error("invalid report ratio");
			metrics[key] = {
				value: denominator === 0 ? null : numerator / denominator,
				unit: "ratio",
				direction: "higher",
				numerator,
				denominator,
			};
		}
		add("planned", score["caseCount"], "count", "observe");
		add("evaluated", score["evaluatedCount"], "count", "observe");
		for (const [key, count] of Object.entries(object(score["statusCounts"])))
			add(`status.${key}`, count, "count", key === "ok" ? "higher" : "lower");
		const violations =
			report["split"] === "holdout"
				? Object.values(object(score["violationCounts"])).map(number)
				: Object.values(object(score["violations"])).map(
						(ids) => array(ids).length,
					);
		add(
			"violations",
			violations.reduce((a, b) => a + b, 0),
			"count",
		);
		add(
			"missing",
			report["split"] === "holdout"
				? score["missingCount"]
				: array(score["missingCaseIds"]).length,
			"count",
		);
		add("latencyP95", performance["latencyP95Ms"], "ms");
		add("failures", performance["failureCount"], "count");
		add("inputBytes", performance["inputBytesTotal"], "bytes");
		const usage = report["usage"] === null ? null : object(report["usage"]);
		add("inputTokens", usage === null ? null : usage["inputTokens"], "tokens");
		add(
			"outputTokens",
			usage === null ? null : usage["outputTokens"],
			"tokens",
		);
		add(
			"usageSamples",
			usage === null ? 0 : usage["samples"],
			"count",
			"observe",
		);
		return {
			evidence: string(provider["kind"]),
			identity: {
				evaluation: string(report["evaluationVersion"]),
				dataset: string(report["datasetVersion"]),
				split: string(report["split"]),
				prompt: string(report["promptVersion"]),
				threshold: string(score["thresholdVersion"]),
				cases: number(score["caseCount"]),
				provider,
			},
			acceptance: boolean(object(report["acceptance"])["modelAccepted"]),
			metrics,
		};
	}
	if (suite === "decision") {
		if (report["schema"] !== "world-decision-eval/2")
			throw new Error("unsupported decision report");
		const summary = object(report["summary"]);
		if (number(summary["tasksRun"]) === 0)
			throw new Error("empty decision workload");
		for (const key of ["improved", "worse", "incomplete"])
			add(key, summary[key], "count", key === "improved" ? "higher" : "lower");
		add("planned", summary["tasksRun"], "count", "observe");
		add("adjudications", array(summary["adjudications"]).length, "count");
		const conditions = object(summary["conditions"]);
		for (const condition of conditionIds) {
			const cell = object(conditions[condition]);
			for (const key of [
				"totalScore",
				"safetyFailures",
				"errors",
				"corrections",
				"inputTokens",
				"outputTokens",
				"latencyMsTotal",
			]) {
				const unit = key.endsWith("Tokens")
					? "tokens"
					: key === "latencyMsTotal"
						? "ms"
						: "count";
				add(
					`${condition}.${key}`,
					cell[key],
					unit,
					key === "totalScore" ? "higher" : "lower",
				);
			}
		}
		return {
			evidence: string(report["evidence"]),
			identity: {
				schema: report["schema"],
				mode: string(report["mode"]),
				provider: object(report["provider"]),
				settings: object(report["settings"]),
				frozen: object(report["frozen"]),
				tasks: number(summary["tasksRun"]),
			},
			acceptance: boolean(object(report["acceptance"])["p5Accepted"]),
			metrics,
		};
	}
	const workloads: unknown[] = [];
	const results = array(report["results"]);
	if (results.length === 0) throw new Error("empty performance workload");
	const seen = new Set<number>();
	for (const value of results) {
		const row = object(value);
		const claims = number(row["claims"]);
		if (claims < 1 || seen.has(claims))
			throw new Error("invalid workload size");
		seen.add(claims);
		const slice = object(row["slice"]);
		const writer = object(row["writer"]);
		workloads.push({
			claims,
			seed: number(row["seed"]),
			runs: number(slice["runs"]),
			warmup: number(slice["warmup"]),
			writerRuns: number(writer["runs"]),
			writerWarmup: number(writer["warmup"]),
		});
		for (const [name, part] of [
			["slice", slice],
			["writer", writer],
		] as const) {
			const raw = array(part["rawMs"])
				.map(number)
				.sort((a, b) => a - b);
			if (raw.length === 0 || raw.length !== number(part["runs"]))
				throw new Error("incomplete performance samples");
			add(`${claims}.${name}.p95`, raw[Math.ceil(raw.length * 0.95) - 1], "ms");
		}
		add(`${claims}.fetchedRows`, slice["maxFetchedRows"], "count");
		add(`${claims}.expandedRows`, slice["maxExpandedRows"], "count");
		add(`${claims}.outputBytes`, slice["maxOutputBytes"], "bytes", "observe");
		add(`${claims}.partialRuns`, slice["partialRuns"], "count", "observe");
		add(
			`${claims}.unindexedQueries`,
			array(row["unindexedQueries"]).length,
			"count",
		);
		add(`${claims}.rebuild`, row["fullRebuildMs"], "ms");
	}
	return {
		evidence: "synthetic-sqlite",
		identity: { workloads, thresholds: object(report["thresholds"]) },
		acceptance: null,
		metrics,
	};
}
