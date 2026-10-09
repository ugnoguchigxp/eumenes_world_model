/**
 * A46 / P4-05 harness checks: dataset freeze, scoring thresholds, the four
 * zero-tolerance violations, failures in the denominators, holdout isolation
 * and a fixture end to end. Everything here is deterministic fixture work: no
 * model, no network. It proves the harness, never model quality.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	DATASET_SHA256,
	DATASET_VERSION,
	EVALUATION_VERSION,
	DatasetIntegrityError,
	byteToCp,
	casesOf,
	codePointLength,
	cpToByte,
	datasetDigest,
	groups,
	loadDataset,
	readCommittedDatasetUnchecked,
	type Dataset,
	type EvalCase,
	type Split,
} from "../../eval/extraction/dataset.ts";
import {
	createCaseResolver,
	createFixtureProvider,
	fixtureVariants,
	ManualClock,
	referenceCandidates,
	wireCandidate,
	type FixtureVariant,
} from "../../eval/extraction/fixture-provider.ts";
import { buildDataset } from "../../eval/extraction/generate.ts";
import {
	exitCodes,
	main,
	redactHoldoutReport,
	stampedResultPath,
	type MainIo,
} from "../../eval/extraction/main.ts";
import {
	HoldoutAccessError,
	ProviderAbandonedError,
	ProviderTimeoutError,
	diagnosticCaseText,
	runEvaluation,
	selectCases,
	type ExtractionProvider,
	type ProviderRequest,
	type ProviderResponse,
	type RunReport,
} from "../../eval/extraction/runner.ts";
import {
	THRESHOLD_VERSION,
	percentile,
	scoreEvaluations,
	summarizePerformance,
	thresholds,
	violationKinds,
	type CaseEvaluation,
} from "../../eval/extraction/scoring.ts";
import {
	normalizeText,
	skeletonOverlap,
} from "../../eval/extraction/skeleton.ts";

// Pinned independently of dataset.ts: both must change with a new version.
const PINNED_DIGEST =
	"100097a76c4832c2af76b419c0fc16153f412163a711399d12ad10e1fc0fd332";
// The retired v1 dataset (kept only to show the independence check fails on it).
const RETIRED_V1_DIGEST =
	"712cff3b17fad1662fd0a5e5f9c26c8ded4940f069b3a7c42cea372aff51e296";

const dataset = loadDataset();
const resolveCase = createCaseResolver(dataset);
const caseOfRequest = (request: Pick<ProviderRequest, "window">): EvalCase => {
	const found = resolveCase(request);
	if (!found) throw new Error("request matches no case");
	return found;
};
const byId = new Map(dataset.cases.map((c) => [c.caseId, c]));
const caseOf = (id: string): EvalCase => {
	const found = byId.get(id);
	if (!found) throw new Error(`no case ${id}`);
	return found;
};

describe("dataset freeze", () => {
	test("200 cases: 10 groups x (10 dev + 10 holdout) with stable ids", () => {
		expect(dataset.version).toBe(DATASET_VERSION);
		expect(dataset.cases.length).toBe(200);
		expect(casesOf(dataset, "dev").length).toBe(100);
		expect(casesOf(dataset, "holdout").length).toBe(100);
		const expected: string[] = [];
		for (const group of groups)
			for (const split of ["dev", "holdout"] as const)
				for (let i = 1; i <= 10; i++)
					expected.push(
						`ext-v2-${group}-${split}-${String(i).padStart(2, "0")}`,
					);
		expect(dataset.cases.map((c) => c.caseId)).toEqual(expected);
		expect(new Set(expected).size).toBe(200);
		for (const group of groups)
			for (const split of ["dev", "holdout"] as const)
				expect(
					dataset.cases.filter((c) => c.group === group && c.split === split)
						.length,
				).toBe(10);
	});

	test("versions: dataset ext-ja-v2, evaluation ext-v2, threshold v2", () => {
		expect(DATASET_VERSION).toBe("ext-ja-v2");
		expect(EVALUATION_VERSION).toBe("ext-v2");
		expect(THRESHOLD_VERSION).toBe("ext-threshold-v2");
	});

	test("gold is frozen by digest; regeneration reproduces the commit", () => {
		expect(DATASET_SHA256).toBe(PINNED_DIGEST);
		expect(datasetDigest(readCommittedDatasetUnchecked())).toBe(PINNED_DIGEST);
		// The generator is deterministic and equals the committed output.
		expect(datasetDigest(buildDataset())).toBe(PINNED_DIGEST);
		expect(buildDataset()).toEqual(readCommittedDatasetUnchecked());
		// Any gold edit changes the digest.
		const tampered: Dataset = {
			...dataset,
			cases: dataset.cases.map((c, i) =>
				i === 0 && c.gold.outcome === "hold"
					? { ...c, gold: { ...c.gold, reason: "question" as const } }
					: c,
			),
		};
		expect(datasetDigest(tampered)).not.toBe(PINNED_DIGEST);
		expect(new DatasetIntegrityError("x").name).toBe("DatasetIntegrityError");
	});

	test("quote offsets are code points and slice real text", () => {
		let checked = 0;
		for (const tc of dataset.cases) {
			const candidates = [
				...tc.gold.reference.map((r) => r.candidate),
				...(tc.forgotten ? [tc.forgotten.claim] : []),
			];
			for (const c of candidates)
				for (const q of [c.quote, ...(c.altQuotes ?? [])]) {
					const text = tc.utterances.find(
						(u) => u.utteranceId === q.utteranceId,
					)!.text;
					const slice = [...text].slice(q.startCp, q.endCp).join("");
					expect(slice.length).toBeGreaterThan(0);
					expect(q.endCp).toBeLessThanOrEqual(codePointLength(text));
					expect(slice.endsWith("。") || slice.endsWith("？")).toBe(true);
					// Round trip through UTF-8 byte offsets.
					const startByte = cpToByte(text, q.startCp);
					expect(byteToCp(text, startByte)).toBe(q.startCp);
					expect(byteToCp(text, startByte + 1)).toBeUndefined();
					checked++;
				}
		}
		expect(checked).toBeGreaterThan(190);
	});

	test("every case is unique; dev and holdout share no claim sentence", () => {
		const key = (c: EvalCase) => c.utterances.map((u) => u.text).join("|");
		expect(new Set(dataset.cases.map(key)).size).toBe(200);
		// Fixtures find their case by the window text: it must be unambiguous.
		for (const tc of dataset.cases)
			expect(caseOfRequest({ window: tc.utterances }).caseId).toBe(tc.caseId);
		// No utterance at all (fillers included) is shared by the two splits.
		const texts = (split: Split) =>
			new Set(
				casesOf(dataset, split).flatMap((c) => c.utterances.map((u) => u.text)),
			);
		const dev = texts("dev");
		for (const t of texts("holdout")) expect(dev.has(t)).toBe(false);
	});

	test("holdout is independent of dev: normalized skeletons are disjoint", () => {
		// Entities, people, numbers and lead-ins are normalized away, so a shared
		// skeleton means the same sentence structure in both splits.
		const overlap = skeletonOverlap(dataset);
		expect(overlap.sharedCaseIds).toEqual([]);
		expect(overlap.sharedSentences).toEqual([]);
		// The normalizer really collapses the slots.
		expect(normalizeText("確認したところ、検索機能は使える。")).toBe(
			normalizeText("念のため、翻訳機能は使える。"),
		);
		expect(normalizeText("佐藤さんは音声サービスの担当だ。")).toBe(
			"<P>は<S>の担当だ。",
		);
		expect(normalizeText("通知機能の応答時間は135ミリ秒だ。")).toBe(
			normalizeText("同期機能の応答時間は450ミリ秒だ。"),
		);
		// Each split still has several distinct structures of its own.
		for (const split of ["dev", "holdout"] as const) {
			const own = new Set(
				casesOf(dataset, split).map((c) =>
					c.utterances.map((u) => normalizeText(u.text)).join("|"),
				),
			);
			expect(own.size).toBeGreaterThanOrEqual(40);
		}
	});

	test("the retired v1 data fails the independence check", () => {
		const v1 = JSON.parse(
			readFileSync(
				new URL(
					"../../eval/extraction/retired/dataset.v1.retired.json",
					import.meta.url,
				),
				"utf8",
			),
		) as Dataset;
		expect(datasetDigest(v1)).toBe(RETIRED_V1_DIGEST);
		expect(v1.version).toBe("ext-ja-v1");
		const overlap = skeletonOverlap(v1);
		// 95 of the 100 v1 holdout cases had a dev twin.
		expect(overlap.sharedCaseIds.length).toBe(95);
		expect(overlap.sharedSentences.length).toBeGreaterThan(0);
	});

	test("gold shape per split: 30 classification cases, forget cases present", () => {
		for (const split of ["dev", "holdout"] as const) {
			const cases = casesOf(dataset, split);
			expect(cases.filter((c) => c.gold.classification).length).toBe(30);
			expect(cases.filter((c) => c.gold.outcome === "adopt").length).toBe(66);
			expect(cases.filter((c) => c.gold.outcome === "hold").length).toBe(34);
			expect(cases.filter((c) => c.forgotten).length).toBe(2);
		}
	});
});

// ----------------------------------------------------------------- helpers

type Make = (tc: EvalCase) => ProviderResponse["output"];

/** The oracle with chosen cases answered differently. */
function withOverrides(
	base: ExtractionProvider,
	overrides: Readonly<Record<string, Make>>,
): ExtractionProvider {
	return {
		info: base.info,
		async extract(request, signal) {
			const tc = caseOfRequest(request);
			const make = overrides[tc.caseId];
			if (make) return { output: make(tc) };
			return base.extract(request, signal);
		},
	};
}

async function run(
	provider: ExtractionProvider,
	split: Split = "holdout",
	ds: Dataset = dataset,
): Promise<RunReport> {
	return runEvaluation({
		dataset: ds,
		provider,
		split,
		mode: split === "dev" ? "tuning" : "acceptance",
		promptVersion: "test-prompt-1",
		timeoutMs: 30_000,
		clock: new ManualClock(),
	});
}
const oracle = () => createFixtureProvider(dataset, "oracle");

/** Evaluation stub: only the fields the aggregate reads matter. */
function evaluation(
	tc: EvalCase,
	pick: Partial<CaseEvaluation> = {},
): CaseEvaluation {
	const adopt = tc.gold.outcome === "adopt";
	return {
		caseId: tc.caseId,
		group: tc.group,
		status: "ok",
		accepted: adopt ? 1 : 0,
		correctAdopted: adopt ? 1 : 0,
		wrongAdopted: 0,
		adoptExpected: adopt,
		adoptedCorrectly: adopt,
		holdExpected: !adopt,
		heldCorrectly: !adopt,
		classification: tc.gold.classification ?? null,
		classificationCorrect: tc.gold.classification !== undefined,
		violations: [],
		mismatches: [],
		...pick,
	};
}

describe("scoring thresholds (initial acceptance, 19/20)", () => {
	test("threshold table is the ticket's 0.95 as integer ratios", () => {
		expect(Object.keys(thresholds).sort()).toEqual([
			"adoptRecall",
			"adoptedPrecision",
			"classificationAccuracy",
			"holdRecall",
		]);
		for (const t of Object.values(thresholds))
			expect(t).toEqual({ numerator: 19, denominator: 20 });
	});

	const holdout = casesOf(dataset, "holdout");
	const adoptCases = holdout
		.filter((c) => c.gold.outcome === "adopt")
		.slice(0, 20);
	const holdCases = holdout
		.filter((c) => c.gold.outcome === "hold")
		.slice(0, 20);
	const classCases = holdout.filter((c) => c.gold.classification).slice(0, 20);

	const table: [string, number, boolean][] = [
		["20/20", 20, true],
		["19/20", 19, true],
		["18/20", 18, false],
		["0/20", 0, false],
	];
	test.each(table)("adopted precision %s", (_n, good, pass) => {
		const evals = adoptCases.map((c, i) =>
			i < good
				? evaluation(c)
				: evaluation(c, {
						correctAdopted: 0,
						wrongAdopted: 1,
						adoptedCorrectly: false,
					}),
		);
		const m = scoreEvaluations(adoptCases, evals).adoptedPrecision;
		expect([m.numerator, m.denominator, m.passed]).toEqual([good, 20, pass]);
		expect(m.failingCaseIds.length).toBe(20 - good);
	});
	test.each(table)("appropriate-hold recall %s", (_n, good, pass) => {
		const evals = holdCases.map((c, i) =>
			evaluation(c, { heldCorrectly: i < good }),
		);
		const m = scoreEvaluations(holdCases, evals).holdRecall;
		expect([m.numerator, m.denominator, m.passed]).toEqual([good, 20, pass]);
		expect(m.failingCaseIds.length).toBe(20 - good);
	});
	test.each(table)("classification accuracy %s", (_n, good, pass) => {
		const evals = classCases.map((c, i) =>
			evaluation(c, { classificationCorrect: i < good }),
		);
		const m = scoreEvaluations(classCases, evals).classificationAccuracy;
		expect([m.numerator, m.denominator, m.passed]).toEqual([good, 20, pass]);
		expect(m.failingCaseIds.length).toBe(20 - good);
	});
	test.each(table)("adopt recall %s", (_n, good, pass) => {
		const evals = adoptCases.map((c, i) =>
			i < good
				? evaluation(c)
				: evaluation(c, {
						accepted: 0,
						correctAdopted: 0,
						adoptedCorrectly: false,
					}),
		);
		const m = scoreEvaluations(adoptCases, evals).adoptRecall;
		expect([m.numerator, m.denominator, m.passed]).toEqual([good, 20, pass]);
		expect(m.threshold).toEqual({ numerator: 19, denominator: 20 });
		expect(m.failingCaseIds.length).toBe(20 - good);
	});
	test("no adopted candidate means precision is undefined and not passed", () => {
		const evals = adoptCases.map((c) =>
			evaluation(c, {
				accepted: 0,
				correctAdopted: 0,
				adoptedCorrectly: false,
			}),
		);
		const m = scoreEvaluations(adoptCases, evals).adoptedPrecision;
		expect([m.numerator, m.denominator, m.rate, m.passed]).toEqual([
			0,
			0,
			null,
			false,
		]);
	});
	test("a wrong adoption on a hold case lowers precision and hold recall", () => {
		const c = holdCases[0]!;
		const score = scoreEvaluations(
			[c],
			[evaluation(c, { accepted: 1, wrongAdopted: 1, heldCorrectly: false })],
		);
		expect(score.adoptedPrecision.failingCaseIds).toEqual([c.caseId]);
		expect(score.holdRecall.failingCaseIds).toEqual([c.caseId]);
	});
});

describe("zero-tolerance violations: one case fails the run", () => {
	const text = (id: string) => caseOf(id).utterances[0]!.text;

	async function single(
		id: string,
		make: Make,
	): Promise<{ report: RunReport; evaluation: CaseEvaluation }> {
		const report = await run(withOverrides(oracle(), { [id]: make }));
		return {
			report,
			evaluation: report.samples.find((s) => s.caseId === id)!.evaluation,
		};
	}
	/** Everything else in the report passes; only the violation is left. */
	function onlyViolation(report: RunReport, kind: string) {
		const s = report.score;
		expect(s.adoptedPrecision.passed).toBe(true);
		expect(s.holdRecall.passed).toBe(true);
		expect(s.classificationAccuracy.passed).toBe(true);
		expect(s.thresholdsMet).toBe(false);
		expect(s.reasons).toEqual([`zero-tolerance ${kind}: 1 case(s)`]);
		expect(report.acceptance.modelAccepted).toBe(false);
	}

	test("scope leak: a Scope-foreign entity id", async () => {
		const id = "ext-v2-ordinary-holdout-01";
		const { report, evaluation } = await single(id, (tc) => {
			const base = referenceCandidates(tc)[0]!;
			return {
				candidates: [{ ...base, subject: { kind: "id", id: "ent-yamada" } }],
			};
		});
		expect(evaluation.violations).toEqual(["scope_leak"]);
		expect(report.score.violations.scope_leak).toEqual([id]);
		// A foreign entity as a relation object leaks the same way.
		expect(text(id).length).toBeGreaterThan(0);
		const alt = await single("ext-v2-ordinary-holdout-03", (tc) => {
			const base = referenceCandidates(tc)[0]!;
			return {
				candidates: [
					{
						...base,
						payload: {
							kind: "relation",
							relation: "depends_on",
							object: { kind: "id", id: "ent-confidential" },
						},
					},
				],
			};
		});
		expect(alt.evaluation.violations).toEqual(["scope_leak"]);
		onlyViolation(report, "scope_leak");
	});

	test("fabricated quote: a range the source cannot back", async () => {
		const id = "ext-v2-ordinary-holdout-02";
		const { report, evaluation } = await single(id, (tc) => {
			const base = referenceCandidates(tc)[0]!;
			return {
				candidates: [
					{ ...base, quote: { ...base.quote, startByte: 0, endByte: 9999 } },
				],
			};
		});
		expect(evaluation.violations).toEqual(["fabricated_quote"]);
		expect(report.score.violations.fabricated_quote).toEqual([id]);
		// An utterance outside the window is fabricated too.
		const ghost = await single("ext-v2-ordinary-holdout-03", (tc) => {
			const base = referenceCandidates(tc)[0]!;
			return {
				candidates: [
					{ ...base, quote: { ...base.quote, utteranceId: "u-99" } },
				],
			};
		});
		expect(ghost.evaluation.violations).toEqual(["fabricated_quote"]);
		onlyViolation(report, "fabricated_quote");
	});

	test("resurrection after forget: the forgotten claim comes back", async () => {
		const id = "ext-v2-correction-holdout-05";
		expect(caseOf(id).forgotten).toBeDefined();
		const { report, evaluation } = await single(id, (tc) => ({
			candidates: [wireCandidate(tc, tc.forgotten!.claim, "asserted")],
		}));
		expect(evaluation.violations).toEqual(["resurrection_after_forget"]);
		expect(report.score.violations.resurrection_after_forget).toEqual([id]);
		// 33/34 and 66/67 are above 0.95, yet the run still fails.
		expect(report.score.holdRecall.numerator).toBe(33);
		onlyViolation(report, "resurrection_after_forget");
	});

	test("hypothesis promoted: a hypothetical claim adopted as asserted", async () => {
		const id = "ext-v2-hypothesis-holdout-01";
		const { report, evaluation } = await single(id, (tc) => ({
			candidates: [
				wireCandidate(tc, tc.gold.reference[0]!.candidate, "asserted"),
			],
		}));
		expect(evaluation.violations).toEqual(["hypothesis_promoted"]);
		expect(report.score.violations.hypothesis_promoted).toEqual([id]);
		onlyViolation(report, "hypothesis_promoted");
		// Hearsay adopted as asserted fact is the same violation.
		const hear = await single("ext-v2-hearsay-holdout-01", (tc) => ({
			candidates: [
				wireCandidate(tc, tc.gold.reference[0]!.candidate, "asserted"),
			],
		}));
		expect(hear.evaluation.violations).toEqual(["hypothesis_promoted"]);
	});

	test("the violation list is exactly the four ticket kinds", () => {
		expect([...violationKinds]).toEqual([
			"scope_leak",
			"fabricated_quote",
			"resurrection_after_forget",
			"hypothesis_promoted",
		]);
	});
});

describe("model output is validated by the extraction domain", () => {
	test("model-issued fields and a repeated candidate are not adopted", async () => {
		const forbidden = await run(
			withOverrides(oracle(), {
				"ext-v2-ordinary-holdout-01": (tc) => ({
					candidates: [{ ...referenceCandidates(tc)[0]!, id: "claim-999" }],
				}),
				"ext-v2-ordinary-holdout-02": (tc) => ({
					candidates: [
						referenceCandidates(tc)[0]!,
						referenceCandidates(tc)[0]!,
					],
				}),
			}),
		);
		const first = forbidden.samples.find(
			(s) => s.caseId === "ext-v2-ordinary-holdout-01",
		)!;
		expect(first.evaluation.accepted).toBe(0);
		// Padding the right answer twice counts the copy as wrong.
		const twice = forbidden.samples.find(
			(s) => s.caseId === "ext-v2-ordinary-holdout-02",
		)!;
		expect(twice.evaluation.correctAdopted).toBe(1);
		expect(twice.evaluation.wrongAdopted).toBe(1);
		expect(twice.evaluation.mismatches).toEqual(["DUPLICATE"]);
		expect(forbidden.score.adoptedPrecision.failingCaseIds).toEqual([
			"ext-v2-ordinary-holdout-02",
		]);
	});

	test("a condition that is dropped or invented is a wrong adoption", async () => {
		const report = await run(
			withOverrides(oracle(), {
				// gold has a condition; the model drops it
				"ext-v2-condition-mismatch-holdout-01": (tc) => {
					const { condition: _drop, ...rest } = referenceCandidates(
						tc,
					)[0] as unknown as Record<string, unknown>;
					return { candidates: [rest] };
				},
			}),
		);
		const e = report.samples.find(
			(s) => s.caseId === "ext-v2-condition-mismatch-holdout-01",
		)!.evaluation;
		expect(e.wrongAdopted).toBe(1);
		expect(e.mismatches).toContain("CONDITION");
	});
});

describe("failures are in every denominator", () => {
	test("timeouts: counted in recall/classification/latency/timeout rate", async () => {
		const clock = new ManualClock();
		const report = await runEvaluation({
			dataset,
			provider: createFixtureProvider(dataset, "timeouts", { clock }),
			split: "holdout",
			mode: "acceptance",
			promptVersion: "p",
			timeoutMs: 30_000,
			clock,
		});
		const s = report.score;
		expect(s.statusCounts.timeout).toBe(25);
		expect(s.holdRecall.denominator).toBe(34);
		expect(s.classificationAccuracy.denominator).toBe(30);
		expect(s.adoptRecall.denominator).toBe(66);
		expect(s.holdRecall.numerator).toBeLessThan(34);
		// Failed hold cases are listed, not dropped.
		const timedOut = report.samples
			.filter((x) => x.status === "timeout")
			.map((x) => x.caseId);
		for (const id of timedOut)
			if (caseOf(id).gold.outcome === "hold")
				expect(s.holdRecall.failingCaseIds).toContain(id);
		expect(report.performance.samples).toBe(100);
		expect(report.performance.timeoutCount).toBe(25);
		expect(report.performance.timeoutRate).toBe(0.25);
		// The timeouts sit in the tail: p95 is the timeout budget itself.
		expect(report.performance.latencyP95Ms).toBe(30_000);
		expect(s.thresholdsMet).toBe(false);
	});

	test("adopt recall gates adoption: silence or timeouts on most adopt cases fail", async () => {
		const adoptIds = casesOf(dataset, "holdout")
			.filter((c) => c.gold.outcome === "adopt" && c.group !== "hearsay")
			.map((c) => c.caseId);
		expect(adoptIds.length).toBe(56);
		const answered = new Set(adoptIds.slice(0, 3));
		const base = oracle();
		const failing = (mode: "silent" | "timeout"): ExtractionProvider => ({
			info: base.info,
			async extract(request, signal) {
				const tc = caseOfRequest(request);
				if (
					tc.gold.outcome === "adopt" &&
					tc.group !== "hearsay" &&
					!answered.has(tc.caseId)
				) {
					if (mode === "timeout") throw new ProviderTimeoutError();
					return { output: { candidates: [] } };
				}
				return base.extract(request, signal);
			},
		});
		for (const mode of ["silent", "timeout"] as const) {
			const report = await run(failing(mode));
			const s = report.score;
			// Every ext-threshold-v1 gate is met: nothing wrong was ever adopted.
			expect(s.adoptedPrecision.passed).toBe(true);
			expect(s.holdRecall.passed).toBe(true);
			expect(s.classificationAccuracy.passed).toBe(true);
			for (const kind of violationKinds) expect(s.violations[kind]).toEqual([]);
			// 10 hearsay + 3 answered of 66 adopt-expected cases.
			expect([s.adoptRecall.numerator, s.adoptRecall.denominator]).toEqual([
				13, 66,
			]);
			expect(s.adoptRecall.passed).toBe(false);
			expect(s.adoptRecall.failingCaseIds.length).toBe(53);
			// ext-threshold-v2 refuses the run.
			expect(s.thresholdsMet).toBe(false);
			expect(s.reasons).toEqual(["adoptRecall 13/66 below 19/20"]);
			expect(report.acceptance.modelAccepted).toBe(false);
		}
	});

	test("adopt recall passes at 63/66 and fails at 62/66", () => {
		const holdout = casesOf(dataset, "holdout");
		expect(holdout.filter((c) => c.gold.outcome === "adopt").length).toBe(66);
		const withMisses = (n: number) => {
			let left = n;
			return holdout.map((c) => {
				const e = evaluation(c);
				if (e.adoptExpected && left > 0 && e.classification === null) {
					left--;
					return {
						...e,
						accepted: 0,
						correctAdopted: 0,
						adoptedCorrectly: false,
					};
				}
				return e;
			});
		};
		expect(scoreEvaluations(holdout, withMisses(3)).adoptRecall.passed).toBe(
			true,
		);
		expect(scoreEvaluations(holdout, withMisses(4)).adoptRecall.passed).toBe(
			false,
		);
	});

	test("invalid output and provider errors are failures, not holds", async () => {
		const malformed = await run(createFixtureProvider(dataset, "malformed"));
		expect(malformed.score.statusCounts.invalid_output).toBe(100);
		expect(malformed.score.holdRecall.numerator).toBe(0);
		expect(malformed.score.holdRecall.denominator).toBe(34);
		const failing: ExtractionProvider = {
			info: oracle().info,
			extract: () => Promise.reject(new Error("boom")),
		};
		const errors = await run(failing);
		expect(errors.score.statusCounts.error).toBe(100);
		expect(errors.score.holdRecall.denominator).toBe(34);
		expect(errors.score.thresholdsMet).toBe(false);
	});

	test("a missing sample fails coverage and every metric containing it", () => {
		const holdout = casesOf(dataset, "holdout");
		const evals = holdout.slice(1).map((c) => evaluation(c));
		const score = scoreEvaluations(holdout, evals);
		expect(score.missingCaseIds).toEqual([holdout[0]!.caseId]);
		expect(score.evaluatedCount).toBe(99);
		expect(score.thresholdsMet).toBe(false);
		expect(score.reasons).toContain("missing samples: 1");
		// Duplicates and unknown samples are rejected as well.
		const dup = scoreEvaluations(holdout, [
			...holdout.map((c) => evaluation(c)),
			evaluation(holdout[0]!),
		]);
		expect(dup.duplicateCaseIds).toEqual([holdout[0]!.caseId]);
		expect(dup.thresholdsMet).toBe(false);
	});

	test("percentiles are nearest-rank over all samples", () => {
		const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
		expect(percentile(sorted, 50)).toBe(50);
		expect(percentile(sorted, 95)).toBe(95);
		expect(percentile([], 50)).toBeNull();
		const perf = summarizePerformance([
			{ status: "ok", latencyMs: 10, inputBytes: 5 },
			{ status: "timeout", latencyMs: 300, inputBytes: 7 },
			{ status: "error", latencyMs: 20, inputBytes: 3 },
			{ status: "ok", latencyMs: 40, inputBytes: 5 },
		]);
		expect(perf).toMatchObject({
			samples: 4,
			latencyP50Ms: 20,
			latencyP95Ms: 300,
			timeoutCount: 1,
			timeoutRate: 0.25,
			failureCount: 2,
			inputBytesTotal: 20,
			inputBytesMax: 7,
		});
		expect(summarizePerformance([]).timeoutRate).toBeNull();
	});

	test("the runner enforces the timeout on a hanging provider", async () => {
		const tiny = {
			...dataset,
			cases: [caseOf("ext-v2-ordinary-holdout-01")],
		};
		const hanging: ExtractionProvider = {
			info: oracle().info,
			extract: () => new Promise<ProviderResponse>(() => {}),
		};
		const report = await runEvaluation({
			dataset: tiny,
			provider: hanging,
			split: "holdout",
			mode: "acceptance",
			promptVersion: "p",
			timeoutMs: 20,
			settleGraceMs: 20,
		});
		expect(report.samples[0]!.status).toBe("timeout");
		expect(report.performance.timeoutRate).toBe(1);
		expect(report.abandonedProviderCalls).toBe(1);
		expect(new ProviderTimeoutError().name).toBe("ProviderTimeoutError");
		expect(new ProviderAbandonedError()).toBeInstanceOf(ProviderTimeoutError);
	});

	test("a provider that ignores the abort signal never overlaps the next call", async () => {
		const three = {
			...dataset,
			cases: casesOf(dataset, "holdout").slice(0, 3),
		};
		const base = createFixtureProvider(dataset, "oracle");
		let inFlight = 0;
		let maxInFlight = 0;
		let calls = 0;
		const slow: ExtractionProvider = {
			info: base.info,
			async extract(request, signal) {
				// The abort signal is ignored on purpose.
				void signal;
				const index = calls++;
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				try {
					if (index === 0) await new Promise((r) => setTimeout(r, 80));
					return await base.extract(request, new AbortController().signal);
				} finally {
					inFlight--;
				}
			},
		};
		const report = await runEvaluation({
			dataset: three,
			provider: slow,
			split: "holdout",
			mode: "acceptance",
			promptVersion: "p",
			timeoutMs: 10,
			settleGraceMs: 2_000,
		});
		// The late first call was waited for; the others ran strictly after it.
		expect(maxInFlight).toBe(1);
		expect(calls).toBe(3);
		expect(report.samples.map((x) => x.status)).toEqual([
			"timeout",
			"ok",
			"ok",
		]);
		expect(report.abandonedProviderCalls).toBe(0);
	});

	test("a provider that never settles is abandoned: no further calls are made", async () => {
		const three = {
			...dataset,
			cases: casesOf(dataset, "holdout").slice(0, 3),
		};
		let calls = 0;
		const stuck: ExtractionProvider = {
			info: oracle().info,
			extract() {
				calls++;
				return new Promise<ProviderResponse>(() => {});
			},
		};
		const report = await runEvaluation({
			dataset: three,
			provider: stuck,
			split: "holdout",
			mode: "acceptance",
			promptVersion: "p",
			timeoutMs: 10,
			settleGraceMs: 10,
		});
		expect(calls).toBe(1);
		expect(report.abandonedProviderCalls).toBe(1);
		expect(report.samples.map((x) => x.status)).toEqual([
			"timeout",
			"error",
			"error",
		]);
	});
});

describe("holdout isolation", () => {
	function spy() {
		const seen: ProviderRequest[] = [];
		const base = oracle();
		const provider: ExtractionProvider = {
			info: base.info,
			extract(request, signal) {
				seen.push(request);
				return base.extract(request, signal);
			},
		};
		return { provider, seen };
	}

	test("tuning mode cannot select or run the holdout", async () => {
		expect(() => selectCases(dataset, "holdout", "tuning")).toThrow(
			HoldoutAccessError,
		);
		const { provider, seen } = spy();
		await expect(
			runEvaluation({
				dataset,
				provider,
				split: "holdout",
				mode: "tuning",
				promptVersion: "p",
			}),
		).rejects.toThrow(HoldoutAccessError);
		expect(seen.length).toBe(0);
	});

	test("a dev run only ever sends dev cases and reports only dev ids", async () => {
		const { provider, seen } = spy();
		const report = await run(provider, "dev");
		expect(seen.length).toBe(100);
		const devIds = new Set(casesOf(dataset, "dev").map((c) => c.caseId));
		for (const request of seen)
			expect(devIds.has(caseOfRequest(request).caseId)).toBe(true);
		const holdoutTexts = casesOf(dataset, "holdout").flatMap((c) =>
			c.utterances.map((u) => u.text),
		);
		const sent = JSON.stringify(seen);
		for (const text of holdoutTexts) expect(sent.includes(text)).toBe(false);
		expect(JSON.stringify(report)).not.toContain("holdout-");
		expect(report.split).toBe("dev");
		// A dev run is never an acceptance.
		expect(report.acceptance.eligible).toBe(false);
	});

	test("holdout case text is never emitted; dev text can be", () => {
		expect(() =>
			diagnosticCaseText(dataset, "ext-v2-ordinary-holdout-01"),
		).toThrow(HoldoutAccessError);
		expect(
			diagnosticCaseText(dataset, "ext-v2-ordinary-dev-01").length,
		).toBeGreaterThan(0);
	});

	test("requests carry no gold; foreign entities are not shown", async () => {
		const { provider, seen } = spy();
		await run(provider, "dev");
		for (const request of seen) {
			expect(Object.keys(request).sort()).toEqual(
				["requestKey", "entities", "predicates", "timeoutMs", "window"].sort(),
			);
			const sent = JSON.stringify(request);
			expect(sent).not.toContain("ent-yamada");
			expect(sent).not.toContain("ent-confidential");
			expect(sent).not.toContain("reference");
		}
	});

	test("requests carry no case id, group or split; the key is opaque per run", async () => {
		const first = spy();
		await run(first.provider, "dev");
		const second = spy();
		await run(second.provider, "dev");
		const marks = [
			"ext-v",
			"holdout",
			"dev",
			"negation",
			"hypothesis",
			"hearsay",
			"other-person",
			"same-name",
			"condition-mismatch",
			"multi-evidence",
			"correction",
			"ordinary",
		];
		for (const request of first.seen) {
			expect(request.requestKey).toMatch(/^[0-9a-f]{16}$/);
			const sent = JSON.stringify(request);
			for (const mark of marks) expect(sent).not.toContain(mark);
		}
		const keys = first.seen.map((r) => r.requestKey);
		expect(new Set(keys).size).toBe(keys.length);
		// A fresh salt per run: keys do not repeat across runs, so they cannot be
		// learned as case labels.
		expect(second.seen.map((r) => r.requestKey)).not.toEqual(keys);
		// With a fixed salt the keys are reproducible.
		const a = spy();
		const b = spy();
		for (const s of [a, b])
			await runEvaluation({
				dataset,
				provider: s.provider,
				split: "dev",
				mode: "tuning",
				promptVersion: "p",
				requestKeySalt: "fixed",
				clock: new ManualClock(),
			});
		expect(a.seen.map((r) => r.requestKey)).toEqual(
			b.seen.map((r) => r.requestKey),
		);
	});

	test("the CLI refuses --show-failures for the holdout before any call", async () => {
		const io = capture();
		const code = await main(
			["--fixture", "oracle", "--show-failures"],
			{},
			io.io,
		);
		expect(code).toBe(exitCodes.usage);
		expect(io.out.join("\n")).not.toMatch(/ext-v\d-/);
	});

	test("a holdout run prints counts only; a dev run lists failing ids", async () => {
		const holdout = capture();
		const code = await main(["--fixture", "overconfident"], {}, holdout.io);
		expect(code).toBe(exitCodes.notAccepted);
		const text = holdout.out.join("\n");
		expect(text).toContain("zero-tolerance hypothesis_promoted: 20");
		expect(text).toContain("zero-tolerance resurrection_after_forget: 2");
		expect(text).toContain("adopt recall:");
		expect(text).not.toMatch(/ext-v\d-/);
		expect(text).not.toContain("holdout-");
		expect(text).not.toContain("failing ");
		expect(text).not.toContain("missing samples:");
		const dev = capture();
		await main(["--fixture", "overconfident", "--split", "dev"], {}, dev.io);
		expect(dev.out.join("\n")).toMatch(/failing precision: ext-v2-.*-dev-/);
		expect(dev.out.join("\n")).toMatch(
			/zero-tolerance hypothesis_promoted: 20 \[ext-v2-/,
		);
	});
});

describe("fixture end to end (A46 harness)", () => {
	test("oracle passes the holdout and records provider/config/bytes/latency", async () => {
		const clock = new ManualClock();
		const report = await runEvaluation({
			dataset,
			provider: createFixtureProvider(dataset, "oracle", { clock }),
			split: "holdout",
			mode: "acceptance",
			promptVersion: "p-oracle",
			timeoutMs: 30_000,
			clock,
		});
		const s = report.score;
		expect(s.thresholdsMet).toBe(true);
		expect([
			s.adoptedPrecision.numerator,
			s.adoptedPrecision.denominator,
		]).toEqual([66, 66]);
		expect([s.holdRecall.numerator, s.holdRecall.denominator]).toEqual([
			34, 34,
		]);
		expect([
			s.classificationAccuracy.numerator,
			s.classificationAccuracy.denominator,
		]).toEqual([30, 30]);
		expect(s.evaluatedCount).toBe(100);
		for (const kind of violationKinds) expect(s.violations[kind]).toEqual([]);
		expect(report.provider).toEqual({
			kind: "fixture",
			modelId: "fixture-oracle",
			modelVersion: "1",
			config: { deterministic: true, variant: "oracle" },
		});
		expect(report.promptVersion).toBe("p-oracle");
		expect(report.performance.latencyP50Ms).toBe(292);
		expect(report.performance.latencyP95Ms).toBe(477);
		expect(report.performance.timeoutRate).toBe(0);
		expect(report.performance.inputBytesTotal).toBeGreaterThan(0);
		for (const sample of report.samples)
			expect(sample.inputBytes).toBeGreaterThan(0);
		expect(report.usage).toEqual({
			inputTokens: 5000,
			outputTokens: 2000,
			samples: 100,
		});
		// A fixture can never satisfy the model acceptance.
		expect(report.acceptance.eligible).toBe(false);
		expect(report.acceptance.modelAccepted).toBe(false);
	});

	test("oracle also passes the dev split", async () => {
		const report = await run(oracle(), "dev");
		expect(report.score.thresholdsMet).toBe(true);
	});

	test("every degraded provider fails", async () => {
		const degraded = fixtureVariants.filter((v) => v !== "oracle");
		expect(degraded.length).toBe(6);
		for (const variant of degraded) {
			const clock = new ManualClock();
			const report = await runEvaluation({
				dataset,
				provider: createFixtureProvider(dataset, variant as FixtureVariant, {
					clock,
				}),
				split: "holdout",
				mode: "acceptance",
				promptVersion: "p",
				timeoutMs: 30_000,
				clock,
			});
			expect(report.score.thresholdsMet).toBe(false);
			expect(report.score.reasons.length).toBeGreaterThan(0);
			expect(report.acceptance.modelAccepted).toBe(false);
		}
	});

	test("overconfident output breaks all three rates and two violations", async () => {
		const report = await run(createFixtureProvider(dataset, "overconfident"));
		const s = report.score;
		expect(s.adoptedPrecision.passed).toBe(false);
		expect(s.holdRecall.passed).toBe(false);
		expect(s.classificationAccuracy.passed).toBe(false);
		expect(s.violations.hypothesis_promoted.length).toBe(20);
		expect(s.violations.resurrection_after_forget.length).toBe(2);
		expect(s.adoptedPrecision.failingCaseIds.length).toBeGreaterThan(0);
	});
});

function capture() {
	const out: string[] = [];
	const err: string[] = [];
	let imports = 0;
	const files = new Map<string, string>();
	const log: string[] = [];
	const state = {
		imports: 0,
		module: undefined as unknown,
		now: Date.UTC(2026, 9, 9, 12, 0, 0, 123),
		logFails: false,
	};
	const io: MainIo = {
		out: (line) => out.push(line),
		err: (line) => err.push(line),
		importModule: async () => {
			imports++;
			state.imports = imports;
			if (state.module instanceof Error) throw state.module;
			return state.module;
		},
		now: () => state.now,
		writeFile: (path, content) => void files.set(path, content),
		writeNewFile: (path, content) => {
			if (files.has(path)) return false;
			files.set(path, content);
			return true;
		},
		appendLine: (_path, line) => {
			if (state.logFails) throw new Error("disk full");
			log.push(line);
		},
		holdoutLogPath: "/audit/holdout-runs.jsonl",
	};
	return { io, out, err, state, files, log };
}

describe("CLI: the Local Provider is explicit and never fabricated", () => {
	test("no provider configured: non-zero, no numbers, nothing imported", async () => {
		const io = capture();
		const code = await main([], {}, io.io);
		expect(code).not.toBe(0);
		expect(code).toBe(exitCodes.providerUnavailable);
		expect(io.err.join("\n")).toContain("not accepted: provider unavailable");
		expect(io.out).toEqual([]);
		expect(io.state.imports).toBe(0);
	});

	test("a module that fails to load, or is not local, is unavailable", async () => {
		const broken = capture();
		broken.state.module = new Error("no such module");
		expect(await main(["--provider-module", "./x.ts"], {}, broken.io)).toBe(
			exitCodes.providerUnavailable,
		);
		expect(broken.out).toEqual([]);
		const cloud = capture();
		cloud.state.module = {
			createProvider: () => ({
				info: { kind: "fixture", modelId: "m", modelVersion: "1", config: {} },
				extract: () => Promise.reject(new Error("never")),
			}),
		};
		expect(await main(["--provider-module", "./x.ts"], {}, cloud.io)).toBe(
			exitCodes.providerUnavailable,
		);
		expect(cloud.err.join("\n")).toContain(
			"not accepted: provider unavailable",
		);
		expect(cloud.out).toEqual([]);
	});

	test("a provider that reports itself unreachable yields no samples", async () => {
		const io = capture();
		io.state.module = {
			createProvider: () => ({
				info: { kind: "local", modelId: "m", modelVersion: "1", config: {} },
				isAvailable: async () => false,
				extract: () => Promise.reject(new Error("never")),
			}),
		};
		const code = await main(
			["--provider-module", "./x.ts", "--prompt-version", "p1"],
			{},
			io.io,
		);
		expect(code).toBe(exitCodes.providerUnavailable);
		expect(io.err.join("\n")).toContain("not accepted: provider unavailable");
		expect(io.out).toEqual([]);
	});

	test("the env var names the module; --prompt-version is required", async () => {
		const io = capture();
		io.state.module = {
			createProvider: () => ({
				info: { kind: "local", modelId: "m", modelVersion: "1", config: {} },
				extract: () => Promise.reject(new Error("never")),
			}),
		};
		const code = await main(
			[],
			{ EUMENES_EVAL_EXTRACTION_PROVIDER: "./x.ts" },
			io.io,
		);
		expect(io.state.imports).toBe(1);
		expect(code).toBe(exitCodes.usage);
		expect(io.out).toEqual([]);
	});

	test("a local-declared stub is scored; fixtures are labelled as such", async () => {
		const io = capture();
		const base = createFixtureProvider(dataset, "oracle");
		io.state.module = {
			createProvider: () => ({
				info: {
					kind: "local",
					modelId: "stub",
					modelVersion: "0",
					config: { t: 0 },
				},
				extract: base.extract,
			}),
		};
		const code = await main(
			["--provider-module", "./stub.ts", "--prompt-version", "p1"],
			{},
			io.io,
		);
		expect(code).toBe(exitCodes.ok);
		expect(io.out.join("\n")).toContain("provider local model=stub");
		const fixture = capture();
		await main(["--fixture", "overconfident"], {}, fixture.io);
		expect(fixture.out[0]).toContain("FIXTURE RUN");
		expect(fixture.out.join("\n")).toContain("thresholds NOT MET");
	});

	const localStub = () => {
		const base = createFixtureProvider(dataset, "oracle");
		return {
			createProvider: () => ({
				info: {
					kind: "local",
					modelId: "stub",
					modelVersion: "7",
					config: {},
				},
				extract: base.extract,
			}),
		};
	};

	test("holdout --json is run-stamped, append-only and holds no case ids", async () => {
		const io = capture();
		io.state.module = localStub();
		const argv = [
			"--provider-module",
			"./stub.ts",
			"--prompt-version",
			"p-9",
			"--json",
			"/out/holdout.json",
		];
		expect(await main(argv, {}, io.io)).toBe(exitCodes.ok);
		// The same second again: a new file, the first one is never replaced.
		expect(await main(argv, {}, io.io)).toBe(exitCodes.ok);
		io.state.now += 1_000;
		expect(await main(argv, {}, io.io)).toBe(exitCodes.ok);
		expect([...io.files.keys()]).toEqual([
			"/out/holdout.20261009T120000123Z.json",
			"/out/holdout.20261009T120000123Z-1.json",
			"/out/holdout.20261009T120001123Z.json",
		]);
		expect(stampedResultPath("/out/holdout.json", io.state.now, 0)).toBe(
			"/out/holdout.20261009T120001123Z.json",
		);
		for (const content of io.files.values()) {
			expect(content).not.toMatch(/ext-v\d-/);
			expect(content).not.toContain("holdout-");
			const parsed = JSON.parse(content);
			expect(parsed.samples).toBeUndefined();
			expect(parsed.sampleCount).toBe(100);
			expect(parsed.evaluationVersion).toBe("ext-v2");
			expect(parsed.promptVersion).toBe("p-9");
			expect(parsed.score.adoptedPrecision.failingCount).toBe(0);
			expect(parsed.score.thresholdVersion).toBe("ext-threshold-v2");
		}
		// The dev result is the full report and may be overwritten.
		const dev = capture();
		dev.state.module = localStub();
		await main(
			[...argv.slice(0, 4), "--split", "dev", "--json", "/out/dev.json"],
			{},
			dev.io,
		);
		const full = JSON.parse(dev.files.get("/out/dev.json")!);
		expect(full.samples.length).toBe(100);
	});

	test("redacting a failing holdout report keeps counts, drops ids", async () => {
		const report = await run(createFixtureProvider(dataset, "overconfident"));
		expect(JSON.stringify(report)).toMatch(/ext-v2-/);
		const redacted = JSON.stringify(redactHoldoutReport(report));
		expect(redacted).not.toMatch(/ext-v\d-/);
		const parsed = JSON.parse(redacted);
		expect(parsed.score.violationCounts.hypothesis_promoted).toBe(20);
		expect(parsed.score.holdRecall.failingCount).toBeGreaterThan(0);
	});

	test("every holdout look is logged with its prompt version; dev and fixtures are not", async () => {
		const io = capture();
		io.state.module = localStub();
		const argv = (prompt: string, ...rest: string[]) => [
			"--provider-module",
			"./stub.ts",
			"--prompt-version",
			prompt,
			...rest,
		];
		await main(argv("prompt-A"), {}, io.io);
		await main(argv("prompt-B"), {}, io.io);
		await main(argv("prompt-dev", "--split", "dev"), {}, io.io);
		await main(["--fixture", "oracle"], {}, io.io);
		const entries = io.log.map((l) => JSON.parse(l));
		expect(entries.map((e) => [e.event, e.promptVersion])).toEqual([
			["start", "prompt-A"],
			["finish", "prompt-A"],
			["start", "prompt-B"],
			["finish", "prompt-B"],
		]);
		expect(entries[0]).toMatchObject({
			evaluationVersion: "ext-v2",
			datasetVersion: "ext-ja-v2",
			split: "holdout",
			modelId: "stub",
			modelVersion: "7",
			at: "2026-10-09T12:00:00.123Z",
		});
		expect(entries[1].adoptRecall).toBe("66/66");
		expect(io.log.join("\n")).not.toMatch(/ext-v\d-/);
	});

	test("the holdout is not run when its audit log cannot be written", async () => {
		const io = capture();
		io.state.module = localStub();
		io.state.logFails = true;
		const code = await main(
			["--provider-module", "./stub.ts", "--prompt-version", "p"],
			{},
			io.io,
		);
		expect(code).toBe(exitCodes.auditFailed);
		expect(io.out).toEqual([]);
		expect(io.err.join("\n")).toContain("audit log");
	});

	test("bad arguments are a usage error", async () => {
		for (const argv of [
			["--split", "all"],
			["--fixture", "nope"],
			["--wat"],
			["--timeout-ms", "0"],
		]) {
			const io = capture();
			expect(await main(argv, {}, io.io)).toBe(exitCodes.usage);
		}
	});
});
