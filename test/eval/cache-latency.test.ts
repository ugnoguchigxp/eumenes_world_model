/**
 * P5-03 / A45 / A49 (World side): the cache-latency scenario. Fixture and
 * pure-rule evidence only. No Tool, host ledger or real model is involved.
 */
import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { IncomparableReason } from "../../src/index.ts";
import {
	EXPECTED,
	GOAL,
	LLM_COMPLETED_CLAIM,
	PLAN,
	SAMPLES_IMPROVED,
	SAMPLES_SHORT_INPUT,
	SAMPLES_WORSE,
	SERIES,
	ledgerRecord,
	type IngestRecord,
	type LedgerRecord,
	type RunSettings,
} from "../../eval/scenarios/cache-latency/fixture.ts";
import {
	createReplayExecutor,
	runCacheLatency,
	type CacheLatencyReport,
} from "../../eval/scenarios/cache-latency/runner.ts";
import {
	p95NearestRank,
	referenceVerdict,
	scoreSeries,
} from "../../eval/scenarios/cache-latency/scorer.ts";

const granted = { granted: true, grantRef: "fixture-permission-1" };
const run = (
	records: readonly LedgerRecord[],
	extra: Partial<Parameters<typeof runCacheLatency>[0]> = {},
): CacheLatencyReport =>
	runCacheLatency({
		toolPermission: granted,
		executor: createReplayExecutor(records),
		...extra,
	});
const seriesOf = (id: string) => SERIES.find((s) => s.seriesId === id)!;
const expectedOf = (id: string) => EXPECTED.find((e) => e.seriesId === id)!;
function freeze<T>(value: T): T {
	if (typeof value === "object" && value !== null) {
		for (const v of Object.values(value)) freeze(v);
		Object.freeze(value);
	}
	return value;
}

describe("A49 three pre-fixed series (supported / refuted / incomparable)", () => {
	test.each([
		["series-a-improved", "supported", [], 640, -180, "keep_candidate"],
		["series-b-worse", "refuted", [], 905, 85, "drop_candidate"],
		[
			"series-c-other-input",
			"incomparable",
			["INPUT_PROFILE_MISMATCH"],
			410,
			undefined,
			"undetermined",
		],
	] as const)(
		"%s -> %s",
		(seriesId, verdict, reasons, p95, delta, adoption) => {
			const series = seriesOf(seriesId);
			const report = run([series.record]);
			expect(report.hypothesis.verdict).toBe(verdict);
			expect(report.hypothesis.incomparableReasons).toEqual([...reasons]);
			expect(report.observations).toHaveLength(1);
			expect(report.observations[0]!.p95).toBe(p95);
			expect(report.observations[0]!.delta).toBe(delta);
			expect(report.adoption.judgment).toBe(adoption);
			expect(report.hypothesis.causalProof).toBe(false);
			const score = scoreSeries(
				PLAN,
				series.record,
				expectedOf(seriesId),
				report,
			);
			expect(score.pass).toBe(true);
			expect(score.referenceAgrees).toBe(true);
		},
	);

	test("expected p95 values are the hand-fixed numbers, not World output", () => {
		expect(p95NearestRank(SAMPLES_IMPROVED)).toBe(640);
		expect(p95NearestRank(SAMPLES_WORSE)).toBe(905);
		expect(p95NearestRank(SAMPLES_SHORT_INPUT)).toBe(410);
		expect(EXPECTED.map((e) => e.p95)).toEqual([640, 905, 410]);
	});

	test("the World prediction is not the ground truth", () => {
		// The prediction says latency decreases; series B shows it increased.
		const b = run([seriesOf("series-b-worse").record]);
		expect(b.hypothesis.verdict).toBe("refuted");
		// An expectation copied from the prediction would be caught.
		const wrong = {
			...expectedOf("series-b-worse"),
			verdict: "supported",
		} as const;
		const score = scoreSeries(
			PLAN,
			seriesOf("series-b-worse").record,
			wrong,
			b,
		);
		expect(score.pass).toBe(false);
		expect(score.referenceAgrees).toBe(false);
	});

	test("a much faster series under another input length is never an improvement", () => {
		const c = seriesOf("series-c-other-input");
		expect(p95NearestRank(c.record.samples)!).toBeLessThan(PLAN.baselineValue);
		const report = run([c.record]);
		expect(report.hypothesis.counts).toEqual({
			supported: 0,
			refuted: 0,
			incomparable: 1,
		});
		expect(report.adoption.judgment).toBe("undetermined");
	});

	test("the three series together are mixed, not an average improvement", () => {
		const report = run(SERIES.map((s) => s.record));
		expect(report.hypothesis.verdict).toBe("mixed");
		expect(report.hypothesis.counts).toEqual({
			supported: 1,
			refuted: 1,
			incomparable: 1,
		});
		expect(report.adoption.judgment).toBe("undetermined");
	});
});

describe("comparison conditions: any difference is incomparable", () => {
	const flat = (value: number) => Array.from({ length: 20 }, () => value);
	test.each<[string, Partial<RunSettings>, readonly IncomparableReason[]]>([
		["cold start", { warmState: "cold" }, ["CONFIGURATION_MISMATCH"]],
		["other model", { model: "voice-llm-other" }, ["CONFIGURATION_MISMATCH"]],
		["other prefix", { prefix: "pfx-v4-800tok" }, ["CONFIGURATION_MISMATCH"]],
		[
			"input length",
			{ inputLength: "input-1024tok" },
			["INPUT_PROFILE_MISMATCH"],
		],
		["unit", { unit: "s" }, ["UNIT_MISMATCH"]],
		["metric", { metric: "first_token_latency" }, ["METRIC_MISMATCH"]],
		["statistic", { statistic: "avg" }, ["STATISTIC_MISMATCH"]],
		["baseline", { baselineRef: "baseline-other" }, ["BASELINE_MISMATCH"]],
		[
			"period",
			{
				period: { startMs: PLAN.period.startMs + 1, endMs: PLAN.period.endMs },
			},
			["WINDOW_MISMATCH"],
		],
		[
			"two differences at once",
			{ warmState: "cold", inputLength: "input-1024tok" },
			["CONFIGURATION_MISMATCH", "INPUT_PROFILE_MISMATCH"],
		],
	])("%s", (_name, change, reasons) => {
		const record = ledgerRecord("led-x", SAMPLES_IMPROVED, { run: change });
		const report = run([record]);
		expect(report.hypothesis.verdict).toBe("incomparable");
		expect(report.hypothesis.incomparableReasons).toEqual([...reasons]);
		expect(referenceVerdict(PLAN, record).verdict).toBe("incomparable");
		expect(report.adoption.judgment).toBe("undetermined");
	});
	test("a change within the plan's tolerance is incomparable, not support", () => {
		const record = ledgerRecord("led-x", flat(830));
		const report = run([record]);
		expect(report.hypothesis.verdict).toBe("incomparable");
		expect(report.hypothesis.incomparableReasons).toEqual([
			"INSUFFICIENT_RESOLUTION",
		]);
		expect(referenceVerdict(PLAN, record).reasons).toEqual([
			"INSUFFICIENT_RESOLUTION",
		]);
	});
});

describe("mid-way correction of the source", () => {
	const rev = (
		samples: readonly number[],
		ledgerRevision: number,
		extra: Parameters<typeof ledgerRecord>[2] = {},
	) => ledgerRecord("led-fix", samples, { ledgerRevision, ...extra });
	test.each([
		[
			"wrong then right",
			SAMPLES_WORSE,
			SAMPLES_IMPROVED,
			"refuted",
			"supported",
		],
		[
			"right then wrong",
			SAMPLES_IMPROVED,
			SAMPLES_WORSE,
			"supported",
			"refuted",
		],
	] as const)(
		"%s: re-evaluation follows the latest revision",
		(_n, first, second, before, after) => {
			const r1 = rev(first, 1);
			const r2 = rev(second, 2);
			expect(run([r1]).hypothesis.verdict).toBe(before);
			for (const order of [
				[r1, r2],
				[r2, r1],
			]) {
				const report = run(order);
				expect(report.hypothesis.verdict).toBe(after);
				expect(report.observations).toHaveLength(1);
				expect(report.observations[0]!.revision).toBe(2);
				expect(report.observations[0]!.sourceRef.revision).toBe("src-rev-2");
				expect(report.supersededObservations).toEqual([
					{ outcomeId: "led-fix", revision: 1 },
				]);
				expect(report.adoption.basis.observations).toEqual([
					{
						outcomeId: "led-fix",
						revision: 2,
						ledgerRevision: 2,
						sourceRevision: "src-rev-2",
					},
				]);
			}
		},
	);
	test("when the corrected revision is unverified, the old revision is not resurrected", () => {
		const report = run([
			rev(SAMPLES_IMPROVED, 1),
			rev(SAMPLES_IMPROVED, 2, { verification: "unverified" }),
		]);
		expect(report.observations).toEqual([]);
		expect(report.hypothesis.verdict).toBe("not_measured");
		expect(report.work.status).toBe("not_confirmed");
		expect(report.rejected).toEqual([
			{ recordId: "led-fix", revision: 2, reason: "LEDGER_UNVERIFIED" },
			{ recordId: "led-fix", revision: 1, reason: "LATEST_REVISION_REJECTED" },
		]);
	});
	test("the source digest follows the corrected content", () => {
		const r1 = rev(SAMPLES_WORSE, 1);
		const r2 = rev(SAMPLES_IMPROVED, 2);
		expect(r1.sourceRef.digest).not.toBe(r2.sourceRef.digest);
	});
});

describe("Goal withdrawal and re-evaluation", () => {
	const retracted = { ...GOAL, revision: 2, status: "retracted" } as const;
	test("a supported hypothesis stays a measurement but no longer serves a Goal", () => {
		const record = seriesOf("series-a-improved").record;
		const before = run([record]);
		const after = run([record], { goal: retracted });
		expect(before.adoption.judgment).toBe("keep_candidate");
		expect(after.hypothesis.verdict).toBe("supported");
		expect(after.observations).toEqual(before.observations);
		expect(after.adoption.judgment).toBe("moot_goal_retracted");
		expect(after.adoption.basis).toMatchObject({
			goalId: GOAL.goalId,
			goalRevision: 2,
			goalStatus: "retracted",
		});
	});
	test("a refuted hypothesis is also moot after withdrawal", () => {
		const report = run([seriesOf("series-b-worse").record], {
			goal: retracted,
		});
		expect(report.hypothesis.verdict).toBe("refuted");
		expect(report.adoption.judgment).toBe("moot_goal_retracted");
	});
	test("open gaps block the Goal only while it is adopted", () => {
		const executor = () => createReplayExecutor([]);
		const adopted = runCacheLatency({
			toolPermission: { granted: false },
			executor: executor(),
		});
		const gone = runCacheLatency({
			toolPermission: { granted: false },
			executor: executor(),
			goal: retracted,
		});
		expect(adopted.gaps.length).toBeGreaterThan(0);
		expect(adopted.gaps.every((g) => g.blocksGoal)).toBe(true);
		expect(gone.gaps.map((g) => g.gapKey)).toEqual(
			adopted.gaps.map((g) => g.gapKey),
		);
		expect(gone.gaps.every((g) => !g.blocksGoal)).toBe(true);
	});
});

describe("A45 no automatic measurement without Tool permission", () => {
	test("no permission -> needs-permission gap, executor never called", () => {
		const executor = createReplayExecutor(SERIES.map((s) => s.record));
		const report = runCacheLatency({
			toolPermission: { granted: false },
			executor,
		});
		expect(executor.calls).toBe(0);
		expect(report.measurement.status).toBe("needs_permission");
		expect(report.measurement.gap).toEqual({
			status: "measurement_gap",
			reasonCode: "TOOL_PERMISSION_REQUIRED",
			predictionId: "pred-cache-latency",
			automaticMeasurementStarted: false,
		});
		expect(report.work.status).toBe("not_started");
		expect(report.hypothesis.verdict).toBe("not_measured");
		expect(report.observations).toEqual([]);
		expect(report.dependencies.outcome).toBe("unknown");
		expect(report.gaps.map((g) => g.kind)).toEqual(["RESOURCE_STATE_UNKNOWN"]);
		expect(report.gaps[0]!.confirmWith).toEqual({
			kind: "entity",
			id: "latency-measurement-tool",
		});
	});
	test("no permission and a model claim: still nothing measured", () => {
		const report = runCacheLatency({
			toolPermission: { granted: false },
			executor: createReplayExecutor(SERIES.map((s) => s.record)),
			claims: [LLM_COMPLETED_CLAIM],
		});
		expect(report.work.status).toBe("not_started");
		expect(report.hypothesis.verdict).toBe("not_measured");
		expect(report.rejected).toEqual([
			{ recordId: "claim-1", reason: "LLM_TEXT_NOT_OBSERVATION" },
		]);
	});
	test("permission granted -> exactly one replay, dependencies all available", () => {
		const executor = createReplayExecutor([SERIES[0]!.record]);
		const report = runCacheLatency({ toolPermission: granted, executor });
		expect(executor.calls).toBe(1);
		expect(report.measurement.status).toBe("executed");
		expect(report.dependencies.outcome).toBe("all_available");
		expect(report.dependencies.successConfirmed).toBe(false);
		expect(report.gaps).toEqual([]);
	});
	test("permission alone is not enough when a dependency is unavailable", () => {
		const executor = createReplayExecutor([SERIES[0]!.record]);
		const report = runCacheLatency({
			toolPermission: granted,
			executor,
			resourceStates: [
				{ entityId: "prefix-cache-capability", state: "unavailable" },
				{ entityId: "stable-prefix", state: "available" },
				{ entityId: "latency-measurement-tool", state: "available" },
			],
		});
		expect(executor.calls).toBe(0);
		expect(report.measurement.status).toBe("blocked");
		expect(report.measurement.gap?.reasonCode).toBe("DEPENDENCY_NOT_SATISFIED");
		expect(report.work.status).toBe("not_started");
		expect(report.gaps.map((g) => g.kind)).toEqual(["MISSING_RESOURCE"]);
	});
});

describe("A45 only verified ledger entries become observations", () => {
	test("an LLM 'completed' text alone is not a runtime observation", () => {
		const report = run([], { claims: [LLM_COMPLETED_CLAIM] });
		expect(report.observations).toEqual([]);
		expect(report.hypothesis.verdict).toBe("not_measured");
		expect(report.work.status).toBe("not_confirmed");
		expect(report.rejected).toEqual([
			{ recordId: "claim-1", reason: "LLM_TEXT_NOT_OBSERVATION" },
		]);
	});
	test("the claim does not change what the ledger says", () => {
		const record = seriesOf("series-b-worse").record;
		const report = run([record], { claims: [LLM_COMPLETED_CLAIM] });
		expect(report.hypothesis.verdict).toBe("refuted");
		expect(report.observations).toHaveLength(1);
		expect(report.rejected).toHaveLength(1);
	});
	test.each<
		[string, Parameters<typeof ledgerRecord>[2], string, string, string]
	>([
		[
			"failed run",
			{ runStatus: "failed" },
			"TOOL_RUN_FAILED",
			"failed",
			"not_measured",
		],
		[
			"unverified entry",
			{ verification: "unverified" },
			"LEDGER_UNVERIFIED",
			"not_confirmed",
			"not_measured",
		],
	])("%s is rejected", (_n, extra, reason, work, verdict) => {
		const report = run([ledgerRecord("led-x", SAMPLES_IMPROVED, extra)]);
		expect(report.rejected).toEqual([
			{ recordId: "led-x", revision: 1, reason: reason as never },
		]);
		expect(report.work.status).toBe(work as never);
		expect(report.hypothesis.verdict).toBe(verdict as never);
		expect(report.observations).toEqual([]);
	});
	test("too few or non-finite samples are not observations", () => {
		const few = run([ledgerRecord("led-x", SAMPLES_IMPROVED.slice(0, 19))]);
		expect(few.rejected[0]!.reason).toBe("TOO_FEW_SAMPLES");
		const nan = run([
			ledgerRecord("led-y", [...SAMPLES_IMPROVED.slice(1), Number.NaN]),
		]);
		expect(nan.rejected[0]!.reason).toBe("INVALID_SAMPLES");
		expect(few.hypothesis.verdict).toBe("not_measured");
	});
	test("a duplicated entry revision is rejected, the first one is kept", () => {
		const record = seriesOf("series-a-improved").record;
		const report = run([record, record]);
		expect(report.rejected).toEqual([
			{ recordId: "led-a", revision: 1, reason: "DUPLICATE_REVISION" },
		]);
		expect(report.hypothesis.verdict).toBe("supported");
	});
});

describe("'work done' and 'hypothesis supported' are separate fields", () => {
	test.each<[string, CacheLatencyReport, string, string]>([
		["improved", run([SERIES[0]!.record]), "completed", "supported"],
		["worse", run([SERIES[1]!.record]), "completed", "refuted"],
		["other input", run([SERIES[2]!.record]), "completed", "incomparable"],
		[
			"failed run",
			run([ledgerRecord("led-x", SAMPLES_IMPROVED, { runStatus: "failed" })]),
			"failed",
			"not_measured",
		],
		[
			"no permission",
			runCacheLatency({
				toolPermission: { granted: false },
				executor: createReplayExecutor([]),
			}),
			"not_started",
			"not_measured",
		],
	])("%s", (_n, report, work, hypothesis) => {
		expect(report.work.status).toBe(work as never);
		expect(report.hypothesis.verdict).toBe(hypothesis as never);
	});
	test("completed work does not imply a supported hypothesis, and vice versa", () => {
		const refuted = run([SERIES[1]!.record]);
		expect(refuted.work.status).toBe("completed");
		expect(refuted.hypothesis.verdict).not.toBe("supported");
		// the two groups carry disjoint keys and neither embeds the other
		expect(Object.keys(refuted.work)).toEqual(["status", "ledger"]);
		expect(Object.keys(refuted.hypothesis)).not.toContain("status");
		expect(JSON.stringify(refuted.work)).not.toContain("refuted");
		expect(JSON.stringify(refuted.hypothesis)).not.toContain("completed");
	});
});

describe("observations trace back to source and ledger revision", () => {
	test.each(SERIES.map((s) => [s.seriesId, s.record] as const))(
		"%s",
		(_id, record) => {
			const report = run([record]);
			const o = report.observations[0]!;
			expect(o.outcomeId).toBe(record.ledgerEntryId);
			expect(o.ledgerEntryId).toBe(record.ledgerEntryId);
			expect(o.ledgerRevision).toBe(record.ledgerRevision);
			expect(o.toolRunId).toBe(record.toolRunId);
			expect(o.sourceRef).toEqual(record.sourceRef);
			expect(o.sourceRef.digest).toBe(
				createHash("sha256")
					.update(JSON.stringify(record.samples))
					.digest("hex"),
			);
			expect(report.work.ledger).toEqual([
				{
					ledgerEntryId: record.ledgerEntryId,
					ledgerRevision: record.ledgerRevision,
				},
			]);
			expect(report.adoption.basis).toMatchObject({
				goalId: GOAL.goalId,
				goalRevision: GOAL.revision,
				goalStatus: "adopted",
				predictionId: report.prediction.id,
				predictionRevision: report.prediction.revision,
			});
			expect(report.adoption.basis.observations).toEqual([
				{
					outcomeId: record.ledgerEntryId,
					revision: record.ledgerRevision,
					ledgerRevision: record.ledgerRevision,
					sourceRevision: record.sourceRef.revision,
				},
			]);
		},
	);
});

describe("determinism and input handling", () => {
	test("frozen inputs are accepted, repeated runs are identical", () => {
		const records = freeze(SERIES.map((s) => structuredClone(s.record)));
		const first = run(records);
		const second = run(records);
		expect(second).toEqual(first);
	});
	test("claims of any kind never reach the executor input as observations", () => {
		const claims: IngestRecord[] = [
			LLM_COMPLETED_CLAIM,
			{ kind: "llm_text", claimId: "claim-2", text: "tool run succeeded" },
		];
		const report = run([], { claims });
		expect(report.rejected.map((r) => r.reason)).toEqual([
			"LLM_TEXT_NOT_OBSERVATION",
			"LLM_TEXT_NOT_OBSERVATION",
		]);
		expect(report.observations).toEqual([]);
	});
});

describe("main.ts", () => {
	test("exits 0 and states the fixture-only scope", () => {
		const result = Bun.spawnSync([
			process.execPath,
			`${import.meta.dir}/../../eval/scenarios/cache-latency/main.ts`,
		]);
		const text = result.stdout.toString();
		expect(result.exitCode).toBe(0);
		expect(text).toContain("fixture / pure-rule evidence only");
		expect(text).not.toContain("FAIL");
	});
});
