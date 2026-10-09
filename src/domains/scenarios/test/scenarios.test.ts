import { describe, expect, test } from "bun:test";
import { assessOutcome, compareScenarios } from "../index.ts";

const NOW = 1791500000000;
const scope = { principal: "p-a", scopeKey: "scope-a" };
const yes = { kind: "explicitly_unconditional", adoptionEvidenceId: "ev-1" };
const axis = { metric: "latency", comparison: "p95" };

type Rec = Record<string, unknown>;
function freeze<T>(value: T): T {
	if (typeof value === "object" && value !== null) {
		for (const v of Object.values(value)) freeze(v);
		Object.freeze(value);
	}
	return value;
}
const edge = (
	id: string,
	from: string,
	to: string,
	relation: string,
	extra: Rec = {},
): Rec => ({
	id,
	revision: 1,
	from,
	to,
	relation,
	status: "active",
	causalEligible: true,
	condition: yes,
	...extra,
});

describe("A18 compareScenarios", () => {
	const baselineEdges = [
		edge("e1", "a", "b", "increases", { axis }),
		edge("e2", "b", "c", "increases", { axis }),
	];
	const query = (overlays: Rec[], edges: Rec[] = baselineEdges): Rec => ({
		contractVersion: 1,
		scope,
		authorized: true,
		asOf: NOW,
		maxAgeMs: 60_000,
		observations: [],
		edges,
		entityId: "a",
		direction: "forward",
		overlays,
	});
	const overlayA = {
		overlayId: "A",
		addEdges: [edge("e3", "c", "d", "decreases", { axis })],
		removeEdgeIds: [],
	};
	const overlayB = { overlayId: "B", addEdges: [], removeEdgeIds: ["e2"] };

	test("A/B are applied separately to the same baseline and differences are reported", () => {
		const input = freeze(query([overlayA, overlayB]));
		const result = compareScenarios(input);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const { value } = result;
		expect(value.status).toBe("complete");
		expect(value.quantitativeEffect).toBe("not_computed");
		expect(value.overlays[0].versusBaseline.added).toEqual([
			"e1@1:a->b:increases>e2@1:b->c:increases>e3@1:c->d:decreases",
		]);
		expect(value.overlays[0].versusBaseline.removed).toEqual([]);
		expect(value.overlays[1].versusBaseline.removed).toEqual([
			"e1@1:a->b:increases>e2@1:b->c:increases",
		]);
		expect(value.comparison.onlyA).toEqual([
			"e1@1:a->b:increases>e2@1:b->c:increases",
			"e1@1:a->b:increases>e2@1:b->c:increases>e3@1:c->d:decreases",
		]);
		expect(value.comparison.onlyB).toEqual([]);
		expect(value.comparison.sameEffect).toEqual(["e1@1:a->b:increases"]);
		expect(value.baseline.paths.length).toBe(2);
	});
	test("input is not mutated (deep-frozen input does not throw) and results are deterministic", () => {
		const input = freeze(query([overlayA, overlayB]));
		const snapshot = JSON.stringify(input);
		const first = compareScenarios(input);
		const second = compareScenarios(input);
		expect(JSON.stringify(input)).toBe(snapshot);
		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
	});
	test("sign flips are reported as differing effects", () => {
		const flip = {
			overlayId: "F",
			addEdges: [edge("e1", "a", "b", "decreases", { axis, revision: 2 })],
			removeEdgeIds: ["e1"],
		};
		const result = compareScenarios(query([flip, overlayB]));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.overlays[0].versusBaseline.removed).toContain(
			"e1@1:a->b:increases",
		);
		expect(result.value.overlays[0].versusBaseline.added).toContain(
			"e1@2:a->b:decreases",
		);
	});
	test("correlation added by an overlay does not propagate as an effect", () => {
		const corr = {
			overlayId: "A",
			addEdges: [edge("e9", "a", "z", "correlates_with")],
			removeEdgeIds: [],
		};
		const result = compareScenarios(query([corr, overlayB]));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.overlays[0].versusBaseline.added).toEqual([]);
	});
	test("no path is not reported as no effect; truncated trace is partial", () => {
		const result = compareScenarios(
			query(
				[overlayA, overlayB],
				[edge("e1", "x", "y", "increases", { axis })],
			),
		);
		expect(result.ok && result.value.baseline.noPathMeaning).toBe(
			"NO_PATH_FOUND_NOT_NO_EFFECT",
		);
		const tight = { ...query([overlayA, overlayB]), budget: { expansions: 1 } };
		const partial = compareScenarios(tight);
		expect(partial.ok && partial.value.status).toBe("partial");
	});
	test("malformed overlays are rejected", () => {
		for (const overlays of [
			[overlayA],
			[overlayA, overlayA],
			[overlayA, { ...overlayB, extra: 1 }],
			[overlayA, { overlayId: "B", addEdges: "x" }],
			"nope",
		])
			expect(compareScenarios(query(overlays as Rec[])).ok).toBe(false);
		expect(compareScenarios(null).ok).toBe(false);
		const bad = compareScenarios(
			query([overlayA, { overlayId: "B", addEdges: [{ id: "x" }] }]),
		);
		expect(bad.ok).toBe(false);
	});
});

describe("A18 assessOutcome", () => {
	const conditions = {
		subjectId: "svc",
		metric: "latency",
		unit: "ms",
		statistic: "p95",
		configuration: "cfg-1",
		inputProfile: "len-1000",
	};
	const window = { startMs: NOW, endMs: NOW + 3_600_000 };
	const prediction = (extra: Rec = {}): Rec => ({
		kind: "quantitative",
		predictionId: "pred-1",
		revision: 1,
		comparisonId: "cmp-1",
		conditions,
		baselineRef: "base-1",
		baselineValue: 100,
		expectedWindow: window,
		expectedDirection: "decreases",
		measurementTolerance: 2,
		origin: "user_report",
		intervention: "cache-on",
		...extra,
	});
	const outcome = (id: string, value: number, extra: Rec = {}): Rec => ({
		kind: "outcome",
		outcomeId: id,
		revision: 1,
		comparisonId: "cmp-1",
		predictionRevision: 1,
		conditions,
		baselineRef: "base-1",
		window,
		value,
		...extra,
	});
	const assess = (pred: Rec, observations: Rec[]) =>
		assessOutcome({
			contractVersion: 1,
			scope,
			prediction: pred,
			observations,
		});
	const verdictOf = (observations: Rec[], pred: Rec = prediction()) => {
		const r = assess(pred, observations);
		if (!r.ok || r.value.status !== "assessed") throw new Error("not assessed");
		return r.value;
	};

	test.each([
		[90, "supported"],
		[110, "refuted"],
		[99, "incomparable"],
		[98, "incomparable"], // delta == -tolerance is not beyond it
		[102, "incomparable"],
		[97.5, "supported"],
		[103, "refuted"],
	])(
		"baseline 100ms tol 2ms expect decreases: %p ms -> %s",
		(value, expected) => {
			const result = verdictOf([outcome("o1", value)]);
			expect(result.verdict).toBe(expected as never);
			if (expected === "incomparable")
				expect(result.observations[0]!.reasons).toEqual([
					"INSUFFICIENT_RESOLUTION",
				]);
		},
	);
	test("expected increases reverses the verdicts", () => {
		const p = prediction({ expectedDirection: "increases" });
		expect(verdictOf([outcome("o1", 110)], p).verdict).toBe("supported");
		expect(verdictOf([outcome("o1", 90)], p).verdict).toBe("refuted");
	});
	test("delta is outcome minus baseline", () => {
		expect(verdictOf([outcome("o1", 90)]).observations[0]!.delta).toBe(-10);
	});
	test.each([
		[
			"statistic avg vs p95",
			{ conditions: { ...conditions, statistic: "avg" } },
			"STATISTIC_MISMATCH",
		],
		["ms vs s", { conditions: { ...conditions, unit: "s" } }, "UNIT_MISMATCH"],
		[
			"metric",
			{ conditions: { ...conditions, metric: "throughput" } },
			"METRIC_MISMATCH",
		],
		[
			"subject",
			{ conditions: { ...conditions, subjectId: "other" } },
			"SUBJECT_MISMATCH",
		],
		[
			"configuration",
			{ conditions: { ...conditions, configuration: "cfg-2" } },
			"CONFIGURATION_MISMATCH",
		],
		[
			"input length",
			{ conditions: { ...conditions, inputProfile: "len-9" } },
			"INPUT_PROFILE_MISMATCH",
		],
		[
			"period",
			{ window: { startMs: NOW + 1, endMs: NOW + 3_600_000 } },
			"WINDOW_MISMATCH",
		],
		["baseline", { baselineRef: "base-2" }, "BASELINE_MISMATCH"],
		["comparison id", { comparisonId: "cmp-2" }, "COMPARISON_ID_MISMATCH"],
		[
			"plan revision",
			{ predictionRevision: 2 },
			"PREDICTION_REVISION_MISMATCH",
		],
	])("%s => incomparable, never supported", (_name, extra, reason) => {
		// value 90 would be supported if the conditions had matched
		const result = verdictOf([outcome("o1", 90, extra as Rec)]);
		expect(result.verdict).toBe("incomparable");
		expect(result.observations[0]!.reasons).toEqual([reason as never]);
		expect(result.observations[0]!.delta).toBeUndefined();
	});
	test("mixed only when comparable observations disagree; incomparable kept separately", () => {
		const mixed = verdictOf([
			outcome("o1", 90),
			outcome("o2", 110),
			outcome("o3", 99),
			outcome("o4", 90, { conditions: { ...conditions, unit: "s" } }),
		]);
		expect(mixed.verdict).toBe("mixed");
		expect(mixed.counts).toEqual({ supported: 1, refuted: 1, incomparable: 2 });
		expect(mixed.incomparableReasons).toEqual([
			{ reason: "INSUFFICIENT_RESOLUTION", count: 1 },
			{ reason: "UNIT_MISMATCH", count: 1 },
		]);
		const notMixed = verdictOf([
			outcome("o1", 90),
			outcome("o2", 99),
			outcome("o3", 90, { baselineRef: "x" }),
		]);
		expect(notMixed.verdict).toBe("supported");
		expect(verdictOf([]).verdict).toBe("incomparable");
	});
	test("observations are ordered deterministically", () => {
		const r = verdictOf([outcome("o2", 90), outcome("o1", 110)]);
		expect(r.observations.map((o) => o.outcomeId)).toEqual(["o1", "o2"]);
	});
	test("supported is not a causal proof; origin and intervention are kept", () => {
		const r = verdictOf([outcome("o1", 90)]);
		expect(r.causalProof).toBe(false);
		expect(r.origin).toBe("user_report");
		expect(r.intervention).toBe("cache-on");
		expect(r.comparisonConditions).toEqual(conditions);
	});
	test("qualitative causes/enables never enter the calculation", () => {
		for (const relation of ["causes", "enables"]) {
			const r = assess(
				{
					kind: "qualitative",
					predictionId: "p-q",
					revision: 1,
					relation,
					subjectId: "a",
					objectId: "b",
				},
				[outcome("o1", 90)],
			);
			expect(r.ok && r.value).toEqual({
				status: "measurement_gap",
				predictionId: "p-q",
				reasonCode: "NO_MEASUREMENT_PLAN",
			});
		}
	});
	test("prediction and observation cannot be swapped; strict validation", () => {
		expect(assess(prediction(), [prediction()]).ok).toBe(false);
		expect(assess(outcome("o1", 90), []).ok).toBe(false);
		for (const bad of [
			prediction({ measurementTolerance: -1 }),
			prediction({ measurementTolerance: Number.NaN }),
			prediction({ baselineValue: Number.POSITIVE_INFINITY }),
			prediction({ expectedDirection: "same" }),
			prediction({ expectedWindow: { startMs: NOW, endMs: NOW } }),
			prediction({ confidence: 0.9 }),
			prediction({ comparisonId: undefined }),
			prediction({ origin: "" }),
		])
			expect(assess(bad, []).ok).toBe(false);
		expect(assess(prediction(), [outcome("o1", Number.NaN)]).ok).toBe(false);
		expect(assess(prediction(), [outcome("o1", 1), outcome("o1", 2)]).ok).toBe(
			false,
		);
		expect(
			assess(
				prediction(),
				Array.from({ length: 65 }, (_, i) => outcome(`o${i}`, 90)),
			).ok,
		).toBe(false);
		expect(
			assessOutcome({
				contractVersion: 2,
				scope,
				prediction: prediction(),
				observations: [],
			}).ok,
		).toBe(false);
		expect(
			assessOutcome({
				contractVersion: 1,
				scope,
				prediction: prediction(),
				observations: [],
				x: 1,
			}).ok,
		).toBe(false);
	});
	test("frozen inputs are accepted and unchanged", () => {
		const pred = freeze(prediction());
		const obs = freeze([outcome("o1", 90)]);
		expect(assess(pred, obs).ok).toBe(true);
	});
});

describe("review fixes: scenarios", () => {
	const baselineEdges = (n: number) =>
		Array.from({ length: n }, (_, i) =>
			edge(`b${String(i).padStart(3, "0")}`, `u${i}`, `y${i}`, "causes"),
		);
	const base = (edges: Rec[], overlays: Rec[], extra: Rec = {}): Rec => ({
		contractVersion: 1,
		scope,
		authorized: true,
		asOf: NOW,
		maxAgeMs: 60_000,
		observations: [],
		edges,
		entityId: "x",
		direction: "forward",
		overlays,
		...extra,
	});
	test("different overlay edges sharing an id are different paths", () => {
		const a = {
			overlayId: "A",
			addEdges: [edge("n1", "x", "y", "increases", { axis })],
			removeEdgeIds: [],
		};
		const b = {
			overlayId: "B",
			addEdges: [edge("n1", "x", "z", "increases", { axis })],
			removeEdgeIds: [],
		};
		const r = compareScenarios(base([], [a, b]));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.comparison.sameEffect).toEqual([]);
		expect(r.value.comparison.onlyA).toHaveLength(1);
		expect(r.value.comparison.onlyB).toHaveLength(1);
	});
	test("overlay edges survive a full candidate budget; the cut is reported", () => {
		const overlay = {
			overlayId: "A",
			addEdges: [edge("zz-new", "x", "w", "causes")],
			removeEdgeIds: [],
		};
		const other = { overlayId: "B", addEdges: [], removeEdgeIds: [] };
		const r = compareScenarios(base(baselineEdges(500), [overlay, other]));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.reasons).toContain("OVERLAY_BASELINE_TRUNCATED");
		expect(r.value.status).toBe("partial");
		const pathNodes = r.value.overlays[0].influence.paths.map((p) =>
			p.nodes.join(">"),
		);
		// "zz-new" sorts last by id: without the reservation it would be cut.
		expect(pathNodes).toContain("x>w");
	});
	test("no truncation note when everything fits", () => {
		const r = compareScenarios(
			base(baselineEdges(3), [
				{ overlayId: "A", addEdges: [], removeEdgeIds: [] },
				{ overlayId: "B", addEdges: [], removeEdgeIds: [] },
			]),
		);
		expect(r.ok && r.value.reasons).toEqual([]);
	});
});

describe("review fixes: corrected outcomes", () => {
	const conditions = {
		subjectId: "svc",
		metric: "latency",
		unit: "ms",
		statistic: "p95",
		configuration: "cfg-1",
		inputProfile: "len-1000",
	};
	const window = { startMs: NOW, endMs: NOW + 3_600_000 };
	const prediction: Rec = {
		kind: "quantitative",
		predictionId: "pred-1",
		revision: 1,
		comparisonId: "cmp-1",
		conditions,
		baselineRef: "base-1",
		baselineValue: 100,
		expectedWindow: window,
		expectedDirection: "decreases",
		measurementTolerance: 2,
		origin: "user_report",
	};
	const oc = (id: string, revision: number, value: number): Rec => ({
		kind: "outcome",
		outcomeId: id,
		revision,
		comparisonId: "cmp-1",
		predictionRevision: 1,
		conditions,
		baselineRef: "base-1",
		window,
		value,
	});
	const assess = (observations: Rec[]) =>
		assessOutcome({ contractVersion: 1, scope, prediction, observations });
	test("a corrected outcome revision replaces the earlier one, in any input order", () => {
		for (const observations of [
			[oc("o1", 1, 110), oc("o1", 2, 90)],
			[oc("o1", 2, 90), oc("o1", 1, 110)],
		]) {
			const r = assess(observations);
			expect(r.ok).toBe(true);
			if (!r.ok || r.value.status !== "assessed") return;
			expect(r.value.verdict).toBe("supported");
			expect(r.value.counts).toEqual({
				supported: 1,
				refuted: 0,
				incomparable: 0,
			});
			expect(r.value.observations).toHaveLength(1);
			expect(r.value.supersededObservations).toEqual([
				{ outcomeId: "o1", revision: 1 },
			]);
		}
	});
	test("different outcomes still combine into mixed", () => {
		const r = assess([oc("o1", 1, 90), oc("o2", 1, 110)]);
		expect(r.ok && r.value.status === "assessed" && r.value.verdict).toBe(
			"mixed",
		);
	});
});

describe("round 2: decimal tolerance, overflow and overlay reporting", () => {
	const conditions = {
		subjectId: "svc",
		metric: "latency",
		unit: "ms",
		statistic: "p95",
		configuration: "cfg-1",
		inputProfile: "len-1000",
	};
	const window = { startMs: NOW, endMs: NOW + 3_600_000 };
	const run = (
		baseline: number,
		value: number,
		tolerance: number,
		dir = "increases",
	) => {
		const r = assessOutcome({
			contractVersion: 1,
			scope,
			prediction: {
				kind: "quantitative",
				predictionId: "pred-1",
				revision: 1,
				comparisonId: "cmp-1",
				conditions,
				baselineRef: "base-1",
				baselineValue: baseline,
				expectedWindow: window,
				expectedDirection: dir,
				measurementTolerance: tolerance,
				origin: "user_report",
				intervention: "cache-on",
			},
			observations: [
				{
					kind: "outcome",
					outcomeId: "o1",
					revision: 1,
					comparisonId: "cmp-1",
					predictionRevision: 1,
					conditions,
					baselineRef: "base-1",
					window,
					value,
				},
			],
		});
		if (!r.ok || r.value.status !== "assessed") throw new Error("not assessed");
		return r.value.observations[0]!;
	};
	test("decimal values at the tolerance boundary are incomparable (no float drift)", () => {
		// 0.4 - 0.1 is 0.30000000000000004 in doubles but exactly 0.3 as written.
		const edge = run(0.1, 0.4, 0.3);
		expect(edge.verdict).toBe("incomparable");
		expect(edge.reasons).toEqual(["INSUFFICIENT_RESOLUTION"]);
		expect(run(0.1, 0.41, 0.3).verdict).toBe("supported");
		expect(run(0.3, 0.1, 0.2, "decreases").verdict).toBe("incomparable");
		expect(run(0.3, 0.09, 0.2, "decreases").verdict).toBe("supported");
		expect(run(100, 90, 2, "decreases").verdict).toBe("supported");
	});
	test("a delta that overflows is incomparable and never leaks Infinity", () => {
		const r = run(1e308, -1e308, 2);
		expect(r.verdict).toBe("incomparable");
		expect(r.reasons).toEqual(["NON_FINITE_DELTA"]);
		expect(JSON.stringify(r)).not.toContain("null");
		expect("delta" in r).toBe(false);
	});
	test("compareScenarios reports a mistyped removal as partial", () => {
		const edges = [edge("e1", "a", "b", "increases", { axis })];
		const r = compareScenarios({
			contractVersion: 1,
			scope,
			authorized: true,
			asOf: NOW,
			maxAgeMs: 60_000,
			observations: [],
			edges,
			entityId: "a",
			direction: "forward",
			overlays: [
				{ overlayId: "A", addEdges: [], removeEdgeIds: ["no-such-edge"] },
				{ overlayId: "B", addEdges: [], removeEdgeIds: [] },
			],
		});
		expect(r.ok && r.value.status).toBe("partial");
		expect(r.ok && r.value.reasons).toContain("UNKNOWN_REMOVE_EDGE_ID");
	});
});
