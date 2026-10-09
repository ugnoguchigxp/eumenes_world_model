/**
 * `bun eval/extraction/main.ts` (package script `eval:extraction`).
 *
 * The only entry that can reach a real model, and only when the operator
 * names a provider module explicitly. World ships no model client and this
 * harness itself never calls cloud: the provider is a module supplied from
 * outside (`--provider-module` or EUMENES_EVAL_EXTRACTION_PROVIDER) that
 * exports `createProvider()` and declares `info.kind === "local"`. That
 * declaration is made by the operator/host who supplies the module; the
 * harness does not verify it (Local eligibility is the host's responsibility).
 * Without a provider the command exits non-zero with "not accepted: provider
 * unavailable" and prints no numbers.
 *
 * Holdout discipline: a holdout run never prints or writes per-case ids or
 * text (counts, numerators and denominators only); `--json` for the holdout
 * writes a new run-stamped file each time and never overwrites; and every
 * holdout run with a non-fixture provider appends its prompt version to an
 * audit log, so the number of times the holdout was looked at can be audited.
 *
 * Flags: --split dev|holdout (default holdout), --prompt-version <id>,
 * --provider-module <path>, --fixture <variant>, --timeout-ms <n>,
 * --json <file> (dev: overwritten; holdout: <stem>.<stamp>.json, append-only),
 * --show-failures (dev only).
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	DATASET_SHA256,
	EVALUATION_VERSION,
	loadDataset,
	splits,
	type Dataset,
	type Split,
} from "./dataset.ts";
import {
	createFixtureProvider,
	fixtureVariants,
	ManualClock,
	type FixtureVariant,
} from "./fixture-provider.ts";
import {
	defaultTimeoutMs,
	diagnosticCaseText,
	runEvaluation,
	type ExtractionProvider,
	type RunMode,
	type RunReport,
} from "./runner.ts";
import { thresholds, type RateMetric } from "./scoring.ts";

/** Default audit log of holdout runs (one JSON object per line). */
export const defaultHoldoutLogPath = fileURLToPath(
	new URL("./holdout-runs.jsonl", import.meta.url),
);

export interface MainIo {
	out(line: string): void;
	err(line: string): void;
	/** Loads the operator-supplied provider module. */
	importModule(specifier: string): Promise<unknown>;
	/** Epoch milliseconds. */
	now(): number;
	/** Overwrites a file (dev results only). */
	writeFile(path: string, content: string): void;
	/** Creates a file exclusively; false when it already exists. */
	writeNewFile(path: string, content: string): boolean;
	appendLine(path: string, line: string): void;
	/** Where holdout runs are logged. */
	readonly holdoutLogPath: string;
}

export const exitCodes = {
	ok: 0,
	notAccepted: 1,
	providerUnavailable: 2,
	/** The holdout audit log could not be written: the holdout is not run. */
	auditFailed: 3,
	usage: 64,
} as const;

interface Args {
	split: Split;
	promptVersion: string | undefined;
	providerModule: string | undefined;
	fixture: FixtureVariant | undefined;
	timeoutMs: number;
	jsonPath: string | undefined;
	showFailures: boolean;
}

function parseArgs(
	argv: readonly string[],
	env: Readonly<Record<string, string | undefined>>,
): Args | string {
	const args: Args = {
		split: "holdout",
		promptVersion: undefined,
		providerModule: env["EUMENES_EVAL_EXTRACTION_PROVIDER"] || undefined,
		fixture: undefined,
		timeoutMs: defaultTimeoutMs,
		jsonPath: undefined,
		showFailures: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i]!;
		const value = () => argv[++i];
		if (flag === "--show-failures") args.showFailures = true;
		else if (flag === "--split") {
			const v = value();
			if (!splits.includes(v as Split)) return `bad --split: ${v}`;
			args.split = v as Split;
		} else if (flag === "--prompt-version") args.promptVersion = value();
		else if (flag === "--provider-module") args.providerModule = value();
		else if (flag === "--json") args.jsonPath = value();
		else if (flag === "--fixture") {
			const v = value();
			if (!fixtureVariants.includes(v as FixtureVariant))
				return `bad --fixture: ${v}`;
			args.fixture = v as FixtureVariant;
		} else if (flag === "--timeout-ms") {
			const n = Number(value());
			if (!Number.isInteger(n) || n <= 0) return "bad --timeout-ms";
			args.timeoutMs = n;
		} else return `unknown argument: ${flag}`;
	}
	return args;
}

/** Text lists show the first ids; the JSON report carries all of them. */
const idList = (ids: readonly string[], limit = 10) =>
	ids.length <= limit
		? ids.join(", ")
		: `${ids.slice(0, limit).join(", ")} (+${ids.length - limit} more)`;

const pct = (m: RateMetric) =>
	m.rate === null ? "n/a" : `${(m.rate * 100).toFixed(1)}%`;
const line = (name: string, m: RateMetric) => {
	const t = m.threshold;
	const gate = t === null ? "info" : `>= ${t.numerator}/${t.denominator}`;
	const verdict = m.passed === null ? "-" : m.passed ? "PASS" : "FAIL";
	return `${name}: ${m.numerator}/${m.denominator} (${pct(m)}) [${gate}] ${verdict}`;
};

/**
 * Plain-text report. No source text. The dev split lists failing case ids;
 * the holdout split never does: counts, numerators and denominators only.
 */
export function renderReport(report: RunReport): string[] {
	const s = report.score;
	const p = report.performance;
	const holdout = report.split === "holdout";
	const lines = [
		`evaluation ${report.evaluationVersion} dataset ${report.datasetVersion} split=${report.split} mode=${report.mode} prompt=${report.promptVersion}`,
		`provider ${report.provider.kind} model=${report.provider.modelId} version=${report.provider.modelVersion} config=${JSON.stringify(report.provider.config)}`,
		`cases ${s.evaluatedCount}/${s.caseCount} ok=${s.statusCounts.ok} invalid_output=${s.statusCounts.invalid_output} timeout=${s.statusCounts.timeout} error=${s.statusCounts.error}`,
		line("adopted precision", s.adoptedPrecision),
		line("appropriate-hold recall", s.holdRecall),
		line("classification accuracy", s.classificationAccuracy),
		line("adopt recall", s.adoptRecall),
		...Object.entries(s.violations).map(
			([kind, ids]) =>
				`zero-tolerance ${kind}: ${ids.length}${ids.length > 0 && !holdout ? ` [${idList(ids)}]` : ""}`,
		),
		`latency p50=${p.latencyP50Ms ?? "n/a"}ms p95=${p.latencyP95Ms ?? "n/a"}ms timeout_rate=${p.timeoutRate === null ? "n/a" : `${p.timeoutCount}/${p.samples}`} input_bytes total=${p.inputBytesTotal} max=${p.inputBytesMax}`,
		report.usage
			? `usage tokens in=${report.usage.inputTokens} out=${report.usage.outputTokens} (${report.usage.samples} samples)`
			: "usage not reported",
	];
	if (!holdout) {
		for (const [name, m] of [
			["precision", s.adoptedPrecision],
			["hold recall", s.holdRecall],
			["classification", s.classificationAccuracy],
			["adopt recall", s.adoptRecall],
		] as const)
			if (m.failingCaseIds.length > 0)
				lines.push(`failing ${name}: ${idList(m.failingCaseIds)}`);
		if (s.missingCaseIds.length > 0)
			lines.push(`missing samples: ${idList(s.missingCaseIds)}`);
	}
	if (report.abandonedProviderCalls > 0)
		lines.push(
			`abandoned provider calls: ${report.abandonedProviderCalls} (the provider ignored the abort signal; the remaining cases were not run)`,
		);
	lines.push(
		`thresholds ${s.thresholdsMet ? "MET" : "NOT MET"} (${s.thresholdVersion})`,
	);
	for (const reason of s.reasons) lines.push(`  - ${reason}`);
	lines.push(report.acceptance.note);
	return lines;
}

const redactMetric = (m: RateMetric) => {
	const { failingCaseIds, ...rest } = m;
	return { ...rest, failingCount: failingCaseIds.length };
};

/**
 * The holdout result as written to a file: the report without any case id.
 * The samples are replaced by their count and every id list by a length.
 */
export function redactHoldoutReport(report: RunReport) {
	const { samples, score, ...rest } = report;
	return {
		...rest,
		score: {
			thresholdVersion: score.thresholdVersion,
			caseCount: score.caseCount,
			evaluatedCount: score.evaluatedCount,
			missingCount: score.missingCaseIds.length,
			duplicateCount: score.duplicateCaseIds.length,
			unexpectedCount: score.unexpectedCaseIds.length,
			statusCounts: score.statusCounts,
			adoptedPrecision: redactMetric(score.adoptedPrecision),
			holdRecall: redactMetric(score.holdRecall),
			classificationAccuracy: redactMetric(score.classificationAccuracy),
			adoptRecall: redactMetric(score.adoptRecall),
			violationCounts: Object.fromEntries(
				Object.entries(score.violations).map(([kind, ids]) => [
					kind,
					ids.length,
				]),
			),
			perGroup: score.perGroup,
			thresholdsMet: score.thresholdsMet,
			reasons: score.reasons,
		},
		sampleCount: samples.length,
	};
}

/** `<stem>.<UTC stamp>[-n].json`: a new name for every holdout run. */
export function stampedResultPath(
	base: string,
	at: number,
	attempt: number,
): string {
	const stem = base.replace(/\.json$/i, "");
	const stamp = new Date(at).toISOString().replace(/[-:.]/g, "");
	return `${stem}.${stamp}${attempt === 0 ? "" : `-${attempt}`}.json`;
}

async function resolveProvider(
	args: Args,
	dataset: Dataset,
	io: MainIo,
): Promise<{ provider: ExtractionProvider; clock?: ManualClock } | number> {
	if (args.fixture) {
		const clock = new ManualClock();
		return {
			provider: createFixtureProvider(dataset, args.fixture, { clock }),
			clock,
		};
	}
	if (!args.providerModule) {
		io.err(
			"not accepted: provider unavailable (no provider configured; pass --provider-module or set EUMENES_EVAL_EXTRACTION_PROVIDER)",
		);
		return exitCodes.providerUnavailable;
	}
	try {
		const mod = (await io.importModule(args.providerModule)) as {
			createProvider?: () => ExtractionProvider | Promise<ExtractionProvider>;
		};
		if (typeof mod.createProvider !== "function") {
			io.err(
				"not accepted: provider unavailable (module has no createProvider)",
			);
			return exitCodes.providerUnavailable;
		}
		const provider = await mod.createProvider();
		// "local" is the module's own declaration; it is not verified here.
		if (
			provider.info?.kind !== "local" ||
			typeof provider.extract !== "function"
		) {
			io.err(
				"not accepted: provider unavailable (provider does not declare itself local)",
			);
			return exitCodes.providerUnavailable;
		}
		return { provider };
	} catch {
		io.err(
			"not accepted: provider unavailable (provider module failed to load)",
		);
		return exitCodes.providerUnavailable;
	}
}

export async function main(
	argv: readonly string[],
	env: Readonly<Record<string, string | undefined>>,
	io: MainIo,
): Promise<number> {
	const args = parseArgs(argv, env);
	if (typeof args === "string") {
		io.err(args);
		return exitCodes.usage;
	}
	if (args.showFailures && args.split !== "dev") {
		io.err("--show-failures is refused for the holdout");
		return exitCodes.usage;
	}
	const dataset = loadDataset();
	const resolved = await resolveProvider(args, dataset, io);
	if (typeof resolved === "number") return resolved;
	const { provider, clock } = resolved;
	if (provider.info.kind === "local" && !args.promptVersion) {
		io.err("--prompt-version is required for a provider declared local");
		return exitCodes.usage;
	}
	// dev is the prompt-tuning path and can never see the holdout.
	const mode: RunMode = args.split === "dev" ? "tuning" : "acceptance";
	const promptVersion = args.promptVersion ?? `fixture-${args.fixture}`;
	// Every holdout look by a non-fixture provider is logged before it happens;
	// when the log cannot be written the holdout is not run.
	const audited = args.split === "holdout" && provider.info.kind !== "fixture";
	const auditBase = {
		evaluationVersion: EVALUATION_VERSION,
		datasetVersion: dataset.version,
		datasetSha256: DATASET_SHA256,
		split: args.split,
		promptVersion,
		modelId: provider.info.modelId,
		modelVersion: provider.info.modelVersion,
	};
	const audit = (entry: Record<string, unknown>) =>
		io.appendLine(
			io.holdoutLogPath,
			JSON.stringify({
				at: new Date(io.now()).toISOString(),
				...auditBase,
				...entry,
			}),
		);
	if (audited)
		try {
			audit({ event: "start" });
		} catch {
			io.err("holdout not run: the audit log could not be written");
			return exitCodes.auditFailed;
		}
	let report: RunReport;
	try {
		report = await runEvaluation({
			dataset,
			provider,
			split: args.split,
			mode,
			promptVersion,
			timeoutMs: args.timeoutMs,
			...(clock ? { clock } : {}),
		});
	} catch (error) {
		const name = error instanceof Error ? error.name : "error";
		try {
			if (audited) audit({ event: "abort", reason: name });
		} catch {
			// The start entry already counts this look.
		}
		io.err(`not accepted: provider unavailable (${name})`);
		return exitCodes.providerUnavailable;
	}
	if (audited)
		try {
			audit({
				event: "finish",
				thresholdsMet: report.score.thresholdsMet,
				adoptedPrecision: `${report.score.adoptedPrecision.numerator}/${report.score.adoptedPrecision.denominator}`,
				holdRecall: `${report.score.holdRecall.numerator}/${report.score.holdRecall.denominator}`,
				classificationAccuracy: `${report.score.classificationAccuracy.numerator}/${report.score.classificationAccuracy.denominator}`,
				adoptRecall: `${report.score.adoptRecall.numerator}/${report.score.adoptRecall.denominator}`,
			});
		} catch {
			io.err("warning: the holdout audit log finish entry was not written");
		}
	if (provider.info.kind === "fixture")
		io.out(
			"FIXTURE RUN: deterministic harness check only. Not a model result; G5 is not satisfied by this output.",
		);
	io.out(`dataset sha256 ${DATASET_SHA256}`);
	for (const text of renderReport(report)) io.out(text);
	io.out(`thresholds ${JSON.stringify(thresholds)}`);
	if (args.showFailures) {
		for (const sample of report.samples)
			if (
				sample.evaluation.wrongAdopted > 0 ||
				(!sample.evaluation.heldCorrectly && sample.evaluation.holdExpected) ||
				(sample.evaluation.adoptExpected && !sample.evaluation.adoptedCorrectly)
			)
				io.out(
					`${sample.caseId}: ${diagnosticCaseText(dataset, sample.caseId)}`,
				);
	}
	if (args.jsonPath) {
		if (report.split === "dev")
			io.writeFile(args.jsonPath, `${JSON.stringify(report, null, "\t")}\n`);
		else {
			// Append-only: a holdout result is never overwritten.
			const content = `${JSON.stringify(redactHoldoutReport(report), null, "\t")}\n`;
			const at = io.now();
			let written: string | undefined;
			for (let attempt = 0; attempt < 100 && written === undefined; attempt++) {
				const path = stampedResultPath(args.jsonPath, at, attempt);
				if (io.writeNewFile(path, content)) written = path;
			}
			if (written === undefined) {
				io.err("holdout result file could not be created");
				return exitCodes.auditFailed;
			}
			io.out(`holdout result written ${written}`);
		}
	}
	if (report.split === "dev") return exitCodes.ok;
	return report.score.thresholdsMet ? exitCodes.ok : exitCodes.notAccepted;
}

if (import.meta.main) {
	const code = await main(process.argv.slice(2), process.env, {
		out: (text) => console.log(text),
		err: (text) => console.error(text),
		importModule: (specifier) => import(pathToFileURL(resolve(specifier)).href),
		now: () => Date.now(),
		writeFile: (path, content) => writeFileSync(path, content),
		writeNewFile: (path, content) => {
			try {
				writeFileSync(path, content, { flag: "wx" });
				return true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
				throw error;
			}
		},
		appendLine: (path, text) => appendFileSync(path, `${text}\n`),
		holdoutLogPath: defaultHoldoutLogPath,
	});
	process.exit(code);
}
