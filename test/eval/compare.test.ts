/**
 * P4-05.c (N04): the offline run comparison. Fabricated reports only:
 * the arithmetic of pairing, the post-hoc escalation upper bound and the
 * detectable-route recovery are checked without any model run.
 */
import { describe, expect, test } from "bun:test";
import {
	compareRuns,
	RunComparisonError,
} from "../../eval/extraction/compare.ts";
import type { RunReport, SampleRecord } from "../../eval/extraction/runner.ts";
import type {
	CaseEvaluation,
	RateMetric,
	SampleStatus,
	ScoreReport,
	ViolationKind,
} from "../../eval/extraction/scoring.ts";

const rate: RateMetric = {
	numerator: 0,
	denominator: 0,
	rate: null,
	threshold: null,
	passed: null,
	failingCaseIds: [],
};
const score: ScoreReport = {
	thresholdVersion: "ext-threshold-v2",
	caseCount: 0,
	evaluatedCount: 0,
	missingCaseIds: [],
	duplicateCaseIds: [],
	unexpectedCaseIds: [],
	statusCounts: { ok: 0, invalid_output: 0, timeout: 0, error: 0 },
	adoptedPrecision: rate,
	holdRecall: rate,
	classificationAccuracy: rate,
	adoptRecall: rate,
	violations: {
		scope_leak: [],
		fabricated_quote: [],
		resurrection_after_forget: [],
		hypothesis_promoted: [],
	},
	perGroup: {},
	thresholdsMet: false,
	reasons: [],
};

interface SampleSpec {
	readonly status?: SampleStatus;
	readonly matched?: boolean;
	readonly mismatches?: readonly string[];
	readonly violations?: readonly ViolationKind[];
}

const sample = (caseId: string, spec: SampleSpec = {}): SampleRecord => {
	const isMatched = spec.matched ?? true;
	const evaluation: CaseEvaluation = {
		caseId,
		group: "ordinary",
		status: spec.status ?? "ok",
		accepted: isMatched ? 1 : 0,
		correctAdopted: isMatched ? 1 : 0,
		wrongAdopted: 0,
		adoptExpected: true,
		adoptedCorrectly: isMatched,
		holdExpected: false,
		heldCorrectly: false,
		classification: null,
		classificationCorrect: false,
		violations: spec.violations ?? [],
		mismatches: spec.mismatches ?? [],
	};
	return {
		caseId,
		status: spec.status ?? "ok",
		latencyMs: 1,
		inputBytes: 1,
		outputBytes: 1,
		usage: null,
		evaluation,
		supply: {
			datasetVersion: "ext-ja-v2",
			entitySet: "base",
			supplied: [],
			suppliedCount: 0,
			limit: null,
			truncated: false,
			scope: { principal: "p", scopeKey: "s" },
			requestDigest: "0".repeat(64),
		},
		supplyClass: "supplied",
	};
};

const report = (
	samples: readonly SampleRecord[],
	overrides: Partial<RunReport> = {},
): RunReport => ({
	evaluationVersion: "ext-v2",
	datasetVersion: "ext-ja-v2",
	split: "dev",
	mode: "tuning",
	promptVersion: "p1",
	provider: {
		kind: "local",
		modelId: "model-a",
		modelVersion: "1",
		config: {},
	},
	timeoutMs: 1_000,
	score,
	performance: {
		samples: samples.length,
		latencyP50Ms: null,
		latencyP95Ms: null,
		timeoutCount: 0,
		timeoutRate: null,
		failureCount: 0,
		inputBytesTotal: 0,
		inputBytesMax: 0,
	},
	usage: null,
	acceptance: { eligible: false, modelAccepted: false, note: "n/a" },
	abandonedProviderCalls: 0,
	supplySummary: {
		counts: {
			supplied: samples.length,
			gold_not_supplied: 0,
			intended_hold: 0,
			ambiguous_supply: 0,
		},
		modelAttributableFailures: 0,
	},
	samples,
	...overrides,
});

describe("compareRuns guards", () => {
	const one = [sample("c1")];
	test("mismatched evaluation, dataset or split throws", () => {
		const a = report(one);
		expect(() =>
			compareRuns(a, report(one, { evaluationVersion: "ext-vX" })),
		).toThrow(RunComparisonError);
		expect(() =>
			compareRuns(a, report(one, { datasetVersion: "ext-ja-vX" })),
		).toThrow(RunComparisonError);
		expect(() => compareRuns(a, report(one, { split: "holdout" }))).toThrow(
			RunComparisonError,
		);
		expect(() => compareRuns(a, report(one))).not.toThrow();
	});
});

describe("compareRuns pairing and tallies", () => {
	const a = report([
		sample("c1"),
		sample("c2", { matched: false, mismatches: ["SUBJECT"] }),
		sample("c3"),
		sample("c4", { matched: false, violations: ["scope_leak"] }),
		sample("c5", { matched: false, status: "timeout" }),
		sample("c6-only-a", { matched: false }),
	]);
	const b = report(
		[
			sample("c1"),
			sample("c2"),
			sample("c3", { matched: false, mismatches: ["PREDICATE"] }),
			sample("c4", { matched: false }),
			sample("c5"),
			sample("c7-only-b"),
		],
		{
			provider: {
				kind: "remote",
				modelId: "model-b",
				modelVersion: "2",
				config: {},
			},
		},
	);
	const compared = compareRuns(a, b);

	test("pairs by case id and counts the four outcomes", () => {
		expect(compared.cases).toBe(5);
		expect(compared.bothMatch).toBe(1);
		expect(compared.onlyAFailed).toBe(2);
		expect(compared.onlyBFailed).toBe(1);
		expect(compared.bothFailed).toBe(1);
		expect(compared.unpaired).toEqual({ onlyInA: 1, onlyInB: 1 });
		expect(compared.a.modelId).toBe("model-a");
		expect(compared.b).toEqual({
			kind: "remote",
			modelId: "model-b",
			modelVersion: "2",
		});
	});

	test("failure tallies group by status and by reason code", () => {
		expect(compared.failuresA.failures).toBe(3);
		expect(compared.failuresA.byStatus).toEqual({
			ok: 2,
			invalid_output: 0,
			timeout: 1,
			error: 0,
		});
		expect(compared.failuresA.byReasonCode).toEqual({
			SUBJECT: 1,
			scope_leak: 1,
		});
		expect(compared.failuresB.failures).toBe(2);
		expect(compared.failuresB.byReasonCode).toEqual({ PREDICATE: 1 });
	});

	test("the upper bound is B's share of all A failures", () => {
		// A failed c2, c4, c5; B matched c2 and c5: 2/3.
		expect(compared.escalationUpperBound).toBeCloseTo(2 / 3);
	});

	test("routable recovery counts only runtime-detectable failures", () => {
		// Routable A samples: c2 (mismatch codes), c4 (violation codes),
		// c5 (timeout). B matched c2 and c5, not c4.
		expect(compared.detectableRoute.routable).toBe(3);
		expect(compared.detectableRoute.recovered).toBe(2);
		expect(compared.detectableRoute.recoveryRate).toBeCloseTo(2 / 3);
		expect(compared.detectableRoute.falseEscalations).toBe(0);
	});
});

describe("compareRuns edge cases", () => {
	test("upper bound is null when A failed nothing", () => {
		const a = report([sample("c1"), sample("c2")]);
		const b = report([sample("c1"), sample("c2", { matched: false })]);
		const compared = compareRuns(a, b);
		expect(compared.escalationUpperBound).toBeNull();
		expect(compared.detectableRoute.recoveryRate).toBeNull();
		expect(compared.detectableRoute.routable).toBe(0);
	});

	test("a matched case with recorded codes is a false escalation", () => {
		const a = report([
			sample("c1", { matched: true, violations: ["scope_leak"] }),
			sample("c2", { matched: false, status: "invalid_output" }),
		]);
		const b = report([
			sample("c1", { matched: false }),
			sample("c2", { matched: false }),
		]);
		const compared = compareRuns(a, b);
		expect(compared.detectableRoute.routable).toBe(2);
		expect(compared.detectableRoute.falseEscalations).toBe(1);
		expect(compared.detectableRoute.recovered).toBe(0);
		expect(compared.detectableRoute.recoveryRate).toBe(0);
		// Post-hoc, B recovered nothing of A's single failure.
		expect(compared.escalationUpperBound).toBe(0);
	});
});
