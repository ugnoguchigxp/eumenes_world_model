/**
 * Entry point for `bun run eval:decision`.
 *
 * Never part of `bun run verify`. A real-model run needs explicit flags
 * (--provider ollama --endpoint <loopback url> --model <name>); otherwise it
 * exits non-zero with "not accepted: provider unavailable" and writes no
 * numbers. --fixture <behavior> runs a simulated provider and labels the
 * report as fixture evidence (G5 is not satisfied by it).
 *
 * Results are append-only: every run writes new run-stamped files
 * (decision-<mode>-<evidence>-<stamp>.json/.md, created exclusively, never
 * overwritten) and appends one line to <out>/runs.jsonl, including runs that
 * stop because the provider is unavailable. The results directory holds
 * local evidence and should be gitignored by the repository.
 *
 * Exit codes: 0 completed (evaluation: accepted), 1 evaluation not accepted,
 * 2 provider unavailable or invalid arguments.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	createFixtureProvider,
	fixtureBehaviors,
	type FixtureBehavior,
} from "./fixtures.ts";
import {
	createOllamaProvider,
	isLoopbackEndpoint,
	isProviderAvailable,
	looksLikeCloudModel,
	type FetchLike,
} from "./real-provider.ts";
import { renderMarkdown, serializeReport } from "./report.ts";
import { runDecisionEval } from "./runner.ts";
import { loadTasks } from "./tasks.ts";
import type { Mode, Provider } from "./types.ts";

export interface MainIo {
	readonly stdout: (text: string) => void;
	readonly stderr: (text: string) => void;
	/** Must create the file exclusively and throw if it already exists. */
	readonly writeFile: (path: string, content: string) => void;
	readonly exists: (path: string) => boolean;
	readonly appendFile: (path: string, content: string) => void;
	readonly mkdir: (path: string) => void;
	readonly fetch: FetchLike;
	readonly now: () => Date;
}

export const UNAVAILABLE = "not accepted: provider unavailable";
export const RUN_LOG_SCHEMA = "world-decision-run/1";
export const RUN_LOG_FILE = "runs.jsonl";

/** Filesystem-safe, sortable stamp from the injected clock. */
export function runStamp(at: Date): string {
	return at.toISOString().replaceAll(/[-:]/g, "").replace(".", "");
}

function freshBase(io: MainIo, out: string, name: string): string {
	for (let n = 1; n <= 1000; n += 1) {
		const base = join(out, n === 1 ? name : `${name}-${n}`);
		if (!io.exists(`${base}.json`) && !io.exists(`${base}.md`)) return base;
	}
	throw new Error(`no free result name for ${name}`);
}

interface Args {
	readonly mode: Mode;
	readonly fixture: FixtureBehavior | null;
	readonly provider: string | null;
	readonly endpoint: string | null;
	readonly model: string | null;
	readonly seed: number;
	readonly budget: number;
	readonly out: string;
}

const known = new Set([
	"--mode",
	"--fixture",
	"--provider",
	"--endpoint",
	"--model",
	"--seed",
	"--budget",
	"--out",
]);

function parseArgs(argv: readonly string[]): Args | string {
	const values = new Map<string, string>();
	for (let i = 0; i < argv.length; i += 2) {
		const flag = argv[i] ?? "";
		const value = argv[i + 1];
		if (!known.has(flag) || value === undefined || value.startsWith("--")) {
			return `invalid argument: ${flag}`;
		}
		values.set(flag, value);
	}
	const mode = values.get("--mode") ?? "tuning";
	if (mode !== "tuning" && mode !== "evaluation") {
		return `invalid --mode: ${mode}`;
	}
	const fixture = values.get("--fixture") ?? null;
	if (
		fixture !== null &&
		!(fixtureBehaviors as readonly string[]).includes(fixture)
	) {
		return `invalid --fixture: ${fixture}`;
	}
	const seed = Number(values.get("--seed") ?? "0");
	const budget = Number(values.get("--budget") ?? "2000");
	if (!Number.isInteger(seed) || !Number.isInteger(budget) || budget <= 0) {
		return "invalid --seed or --budget";
	}
	return {
		mode,
		fixture: fixture as FixtureBehavior | null,
		provider: values.get("--provider") ?? null,
		endpoint: values.get("--endpoint") ?? null,
		model: values.get("--model") ?? null,
		seed,
		budget,
		out: values.get("--out") ?? "eval/decision/results",
	};
}

export async function runMain(
	argv: readonly string[],
	io: MainIo,
): Promise<number> {
	const args = parseArgs(argv);
	if (typeof args === "string") {
		io.stderr(`${args}\n`);
		return 2;
	}
	const loaded = await loadTasks(args.mode);
	const startedAt = io.now();
	const stamp = runStamp(startedAt);
	const log = (entry: Record<string, unknown>): void => {
		io.mkdir(args.out);
		io.appendFile(
			join(args.out, RUN_LOG_FILE),
			`${JSON.stringify({
				schema: RUN_LOG_SCHEMA,
				stamp,
				at: startedAt.toISOString(),
				mode: args.mode,
				provider:
					args.fixture !== null ? `fixture-${args.fixture}` : args.provider,
				model: args.fixture !== null ? `fixture-${args.fixture}` : args.model,
				seed: args.seed,
				budget: args.budget,
				frozen: Object.fromEntries(
					Object.entries(loaded.digests).map(([k, v]) => [k, v.ok]),
				),
				...entry,
			})}\n`,
		);
	};
	let provider: Provider;
	if (args.fixture !== null) {
		provider = createFixtureProvider(args.fixture, loaded.tasks);
	} else {
		if (
			args.provider !== "ollama" ||
			args.endpoint === null ||
			args.model === null
		) {
			io.stderr(`${UNAVAILABLE} (no provider configured)\n`);
			log({
				outcome: "provider-unavailable",
				reason: "no provider configured",
			});
			return 2;
		}
		if (!isLoopbackEndpoint(args.endpoint)) {
			io.stderr(`${UNAVAILABLE} (non-local endpoint rejected)\n`);
			log({ outcome: "provider-unavailable", reason: "non-loopback endpoint" });
			return 2;
		}
		if (looksLikeCloudModel(args.model)) {
			io.stderr(`${UNAVAILABLE} (cloud model name rejected)\n`);
			log({ outcome: "provider-unavailable", reason: "cloud model name" });
			return 2;
		}
		const options = {
			endpoint: args.endpoint,
			model: args.model,
			fetch: io.fetch,
		};
		if (!(await isProviderAvailable(options))) {
			io.stderr(`${UNAVAILABLE}\n`);
			log({
				outcome: "provider-unavailable",
				reason: "server or model missing",
			});
			return 2;
		}
		provider = createOllamaProvider(options);
	}
	const report = await runDecisionEval({
		mode: args.mode,
		tasks: loaded.tasks,
		provider,
		seed: args.seed,
		inputBudgetTokens: args.budget,
		frozen: loaded.digests,
		generatedAt: io.now().toISOString(),
	});
	io.mkdir(args.out);
	const base = freshBase(
		io,
		args.out,
		`decision-${report.mode}-${report.evidence}-${stamp}`,
	);
	io.writeFile(`${base}.json`, serializeReport(report));
	io.writeFile(`${base}.md`, renderMarkdown(report));
	log({
		outcome: "completed",
		evidence: report.evidence,
		status: report.acceptance.status,
		p5Accepted: report.acceptance.p5Accepted,
		framing: report.acceptance.framingEvidence.status,
		improved: report.summary.improved,
		worse: report.summary.worse,
		worldSafetyFailures: report.summary.worldSafetyFailures.length,
		needsAdjudication: report.summary.adjudications.length,
		files: [`${base}.json`, `${base}.md`],
	});
	io.stdout(
		`wrote ${base}.json and ${base}.md (evidence: ${report.evidence}, status: ${report.acceptance.status})\n`,
	);
	if (report.evidence === "fixture") {
		io.stdout("fixture result only: G5 not satisfied, P5 not accepted\n");
	}
	if (report.acceptance.status === "tuning-only") {
		io.stdout("tuning run: no acceptance verdict\n");
		return 0;
	}
	if (report.acceptance.status === "not-accepted") {
		const reasons = report.acceptance.result?.reasons.join("; ") ?? "";
		io.stderr(`not accepted: ${reasons}\n`);
		return 1;
	}
	return 0;
}

if (import.meta.main) {
	const code = await runMain(process.argv.slice(2), {
		stdout: (text) => void process.stdout.write(text),
		stderr: (text) => void process.stderr.write(text),
		writeFile: (path, content) => writeFileSync(path, content, { flag: "wx" }),
		exists: (path) => existsSync(path),
		appendFile: (path, content) => appendFileSync(path, content),
		mkdir: (path) => void mkdirSync(path, { recursive: true }),
		fetch: (url, init) => fetch(url, init),
		now: () => new Date(),
	});
	process.exit(code);
}
