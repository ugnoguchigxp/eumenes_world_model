/** Explicit paid continuation. Gold is never sent to generation/selection. */
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { ApiBudget, type ApiService } from "../api/client.ts";
import { ApiSession } from "../api/session.ts";
import { sourceSnapshot } from "../measurement/run.ts";
import { runJobs, runIndependent, holdout } from "./main.ts";
import { judgeOne, judgeExtraction, RELIABLE_VERSION } from "./reliable.ts";
import { replay, describeValidation } from "./pipeline.ts";
import { semanticPass } from "./scoring.ts";
import { loadQuality, type Job, type QualityCase } from "./dataset.ts";
const save = (file: string, v: unknown) =>
	writeFileSync(file, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
async function calibration(session: ApiSession, out: string) {
	const bytes = readFileSync(
		new URL(
			"../../fixtures/api-quality/judge-calibration.v6.json",
			import.meta.url,
		),
	);
	const data = JSON.parse(bytes.toString()) as {
		cases: {
			id: string;
			job: Job;
			answer: import("./protocol.ts").Answer | null;
			context: string;
			visibleIds: string[];
			expectedAccepted: boolean;
			expectedSafety?: boolean;
		}[];
	};
	const records: {
		service: ApiService;
		matched: boolean;
		critical: boolean;
		error: string | null;
	}[] = [];
	await Promise.all(
		(["openai", "claude"] as const).map(async (service) => {
			for (const c of data.cases) {
				let verdict: import("./protocol.ts").JudgeVerdict | null = null,
					error: string | null = null;
				try {
					verdict = await judgeOne(session, service, c.job, c.answer, {
						text: c.context,
						evidenceIds: c.visibleIds,
					});
				} catch (e) {
					error = e instanceof Error ? e.message : "JUDGE_ERROR";
				}
				const accepted = semanticPass(verdict ?? undefined);
				const matched =
					!error &&
					accepted === c.expectedAccepted &&
					(c.expectedSafety === undefined ||
						verdict?.safetyViolation === c.expectedSafety);
				const r = {
					service,
					matched,
					critical: c.expectedSafety !== undefined,
					error,
				};
				records.push(r);
				appendFileSync(
					join(out, "calibration.jsonl"),
					JSON.stringify({
						...r,
						id: c.id,
						verdict,
						expectedAccepted: c.expectedAccepted,
						expectedSafety: c.expectedSafety,
					}) + "\n",
				);
			}
		}),
	);
	const summary = (["openai", "claude"] as const).map((service) => {
		const rows = records.filter((r) => r.service === service);
		return {
			service,
			correct: rows.filter((r) => r.matched).length,
			total: rows.length,
			passed:
				rows.length === data.cases.length &&
				rows.filter((r) => r.matched).length / rows.length >= 0.95 &&
				rows.filter((r) => r.critical).every((r) => r.matched) &&
				rows.every((r) => !r.error),
		};
	});
	const extraction = await extractionCalibration(session, out);
	save(join(out, "calibration-summary.json"), {
		version: RELIABLE_VERSION,
		fixtureSha256: createHash("sha256").update(bytes).digest("hex"),
		summary,
		extraction,
	});
	return (
		summary.every((r) => r.passed) && extraction.summary.every((r) => r.passed)
	);
}
async function extractionCalibration(session: ApiSession, out: string) {
	const bytes = readFileSync(
		new URL(
			"../../fixtures/api-quality/extraction-judge-calibration.v1.json",
			import.meta.url,
		),
	);
	const data = JSON.parse(bytes.toString()) as {
		cases: {
			id: string;
			case: QualityCase;
			output: unknown;
			expectedAccepted: boolean;
			expectedSafety?: boolean;
		}[];
	};
	const rows: {
		service: ApiService;
		matched: boolean;
		critical: boolean;
		error: string | null;
	}[] = [];
	await Promise.all(
		(["openai", "claude"] as const).map(async (service) => {
			for (const c of data.cases) {
				let verdict: import("./protocol.ts").JudgeVerdict | null = null,
					error: string | null = null;
				try {
					const validation =
						c.output === null
							? null
							: describeValidation(replay(c.case, c.output));
					verdict = await judgeExtraction(
						session,
						service,
						c.case,
						c.output,
						validation,
						true,
					);
				} catch (e) {
					error = e instanceof Error ? e.message : "JUDGE_ERROR";
				}
				const matched =
					!error &&
					semanticPass(verdict ?? undefined) === c.expectedAccepted &&
					(c.expectedSafety === undefined ||
						verdict?.safetyViolation === c.expectedSafety);
				const r = {
					service,
					matched,
					critical: c.expectedSafety !== undefined,
					error,
				};
				rows.push(r);
				appendFileSync(
					join(out, "extraction-calibration.jsonl"),
					JSON.stringify({
						...r,
						id: c.id,
						verdict,
						expectedAccepted: c.expectedAccepted,
						expectedSafety: c.expectedSafety,
					}) + "\n",
				);
			}
		}),
	);
	return {
		fixtureSha256: createHash("sha256").update(bytes).digest("hex"),
		summary: (["openai", "claude"] as const).map((service) => {
			const r = rows.filter((r) => r.service === service);
			return {
				service,
				correct: r.filter((r) => r.matched).length,
				total: r.length,
				passed:
					r.length === data.cases.length &&
					r.filter((r) => r.matched).length / r.length >= 0.95 &&
					r.filter((r) => r.critical).every((r) => r.matched) &&
					r.every((r) => !r.error),
			};
		}),
	};
}
async function main() {
	const [mode, out, ledger, ...rest] = process.argv.slice(2);
	if (
		!mode ||
		!out ||
		!ledger ||
		rest.length ||
		![
			"calibration",
			"dev",
			"regression",
			"independent",
			"fresh",
			"jobs",
		].includes(mode)
	)
		throw Error(
			"Usage: confirmation <calibration|dev|regression|independent|fresh|jobs> <new out> <shared ledger>",
		);
	if (existsSync(out)) throw Error("OUTPUT_EXISTS");
	mkdirSync(out, { recursive: true });
	const effort = process.env["EUMENES_EVAL_API_EFFORT"] ?? "medium";
	if (effort !== "medium" && effort !== "high")
		throw Error("INVALID_API_EFFORT");
	const root = resolve(import.meta.dir, "../.."),
		before = sourceSnapshot(root);
	save(join(out, "manifest.json"), {
		mode,
		source: before,
		version: RELIABLE_VERSION,
		effort,
		startedAt: new Date().toISOString(),
		budgetLimitUSD: 10,
		includesAllPrevious: true,
	});
	const budget = new ApiBudget(ledger),
		session = new ApiSession(budget, join(out, "../request-cache"), { effort });
	let complete = false,
		passed: boolean | null = null;
	try {
		if (mode === "calibration") passed = await calibration(session, out);
		if (mode === "dev")
			await runJobs(session, out, true, undefined, ["grounded"]);
		if (mode === "jobs") await runJobs(session, out, false);
		if (mode === "regression") await holdout(session, out);
		if (mode === "regression" || mode === "independent") {
			await runIndependent(
				session,
				out,
				loadQuality<QualityCase>("independent"),
				["grounded"],
			);
		}
		if (mode === "fresh") {
			const bytes = readFileSync(
				new URL(
					"../../fixtures/api-quality/independent.v2.json",
					import.meta.url,
				),
			);
			const data = JSON.parse(bytes.toString()) as { cases: QualityCase[] };
			if (data.cases.length !== 60) throw Error("FRESH_COUNT");
			save(join(out, "dataset.json"), {
				sha256: createHash("sha256").update(bytes).digest("hex"),
				count: 60,
			});
			await runIndependent(session, out, data.cases);
		}
		complete = true;
	} finally {
		const after = sourceSnapshot(root);
		save(join(out, "result.json"), {
			status: !complete
				? "failed"
				: before.digest !== after.digest
					? "invalidated"
					: "completed",
			sourceStable: before.digest === after.digest,
			passed,
			budget: budget.summary,
			requests: session.counts,
			finishedAt: new Date().toISOString(),
		});
		budget.close();
		if (!complete || before.digest !== after.digest || passed === false)
			process.exitCode = 1;
	}
}
if (import.meta.main)
	try {
		await main();
	} catch (e) {
		console.error(e instanceof Error ? e.message : "CONFIRMATION_ERROR");
		process.exitCode = 1;
	}
