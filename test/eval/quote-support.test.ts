/**
 * E03: quote semantic-support analysis. All fixtures are handcrafted;
 * no model, no network, no real run output is read here.
 */
import { describe, expect, test } from "bun:test";
import {
	QuoteSupportError,
	pairJudgments,
	parseQuoteSupportJudgments,
	summarizeQuoteSupport,
	type QuoteSupportItem,
	type QuoteSupportPredictionRef,
} from "../../eval/extraction/quote-support.ts";

const item = (over: Partial<QuoteSupportItem> = {}): QuoteSupportItem => ({
	itemId: "i1",
	goldMatched: true,
	contractValid: true,
	verdict: "supports",
	...over,
});

describe("summarizeQuoteSupport", () => {
	test("aggregates verdict counts and the support rate", () => {
		const summary = summarizeQuoteSupport([
			item({ itemId: "a" }),
			item({ itemId: "b", verdict: "contradicts" }),
			item({ itemId: "c", verdict: "insufficient" }),
			item({ itemId: "d" }),
		]);
		expect(summary.total).toBe(4);
		expect(summary.supports).toBe(2);
		expect(summary.contradicts).toBe(1);
		expect(summary.insufficient).toBe(1);
		expect(summary.supportRate).toBe(0.5);
	});

	test("empty input yields null rates, never NaN", () => {
		const summary = summarizeQuoteSupport([]);
		expect(summary.total).toBe(0);
		expect(summary.supportRate).toBeNull();
		expect(summary.contractValidRate).toBeNull();
		expect(summary.supportRateAmongContractValid).toBeNull();
		expect(summary.atomicPrecision).toBeNull();
		expect(summary.byGoldMatched.matched.supportRate).toBeNull();
		expect(summary.goldMatchedButNotSupported).toBe(0);
		expect(summary.goldMismatchedButSupported).toBe(0);
	});

	test("layer 1 and layer 2 stay separate", () => {
		// Position-valid but content-insufficient: counted as contract
		// valid, not as supported, and excluded from the valid-only rate's
		// numerator.
		const summary = summarizeQuoteSupport([
			item({ itemId: "a", verdict: "insufficient" }),
			item({ itemId: "b", contractValid: false }),
			item({ itemId: "c" }),
		]);
		expect(summary.contractValid).toBe(2);
		expect(summary.contractValidRate).toBeCloseTo(2 / 3);
		expect(summary.supportRateAmongContractValid).toBe(0.5);
		expect(summary.supportRate).toBeCloseTo(2 / 3);
	});

	test("breaks down by gold label and counts both disagreements", () => {
		const summary = summarizeQuoteSupport([
			item({ itemId: "a", verdict: "contradicts" }),
			item({ itemId: "b", goldMatched: false }),
			item({ itemId: "c", goldMatched: false, verdict: "insufficient" }),
			item({ itemId: "d", goldMatched: null, verdict: "insufficient" }),
		]);
		expect(summary.byGoldMatched.matched.total).toBe(1);
		expect(summary.byGoldMatched.matched.supportRate).toBe(0);
		expect(summary.byGoldMatched.mismatched.total).toBe(2);
		expect(summary.byGoldMatched.mismatched.supportRate).toBe(0.5);
		expect(summary.byGoldMatched.unknown.total).toBe(1);
		expect(summary.goldMatchedButNotSupported).toBe(1);
		expect(summary.goldMismatchedButSupported).toBe(1);
	});

	test("atomic precision uses gold-labelled items as denominator", () => {
		const summary = summarizeQuoteSupport([
			item({ itemId: "a" }),
			item({ itemId: "b", goldMatched: false, verdict: "insufficient" }),
			item({ itemId: "c", goldMatched: null }),
		]);
		// 2 supports over the 2 gold-labelled items; the unlabelled
		// support is not allowed to inflate the labelled denominator.
		expect(summary.atomicPrecision).toBe(1);
	});

	test("atomic precision falls back to all items without gold labels", () => {
		const summary = summarizeQuoteSupport([
			item({ itemId: "a", goldMatched: null }),
			item({ itemId: "b", goldMatched: null, verdict: "insufficient" }),
		]);
		expect(summary.atomicPrecision).toBe(0.5);
	});
});

describe("parseQuoteSupportJudgments", () => {
	test("accepts a well-formed document, rationale optional", () => {
		const parsed = parseQuoteSupportJudgments({
			suiteId: "ext-ja-v2",
			items: [
				{ itemId: "a", verdict: "supports", rationale: "根拠が一致" },
				{ itemId: "b", verdict: "insufficient" },
			],
		});
		expect(parsed.suiteId).toBe("ext-ja-v2");
		expect(parsed.items).toHaveLength(2);
		expect(parsed.items[0]?.rationale).toBe("根拠が一致");
		expect(parsed.items[1]?.rationale).toBeUndefined();
	});

	test("rejects an unknown verdict", () => {
		expect(() =>
			parseQuoteSupportJudgments({
				suiteId: "s",
				items: [{ itemId: "a", verdict: "partial" }],
			}),
		).toThrow(QuoteSupportError);
	});

	test("rejects a duplicate itemId", () => {
		expect(() =>
			parseQuoteSupportJudgments({
				suiteId: "s",
				items: [
					{ itemId: "a", verdict: "supports" },
					{ itemId: "a", verdict: "contradicts" },
				],
			}),
		).toThrow(QuoteSupportError);
	});

	test("rejects missing fields", () => {
		expect(() => parseQuoteSupportJudgments({ items: [] })).toThrow(
			QuoteSupportError,
		);
		expect(() =>
			parseQuoteSupportJudgments({
				suiteId: "s",
				items: [{ verdict: "supports" }],
			}),
		).toThrow(QuoteSupportError);
		expect(() =>
			parseQuoteSupportJudgments({ suiteId: "s", items: [{ itemId: "a" }] }),
		).toThrow(QuoteSupportError);
		expect(() => parseQuoteSupportJudgments("nope")).toThrow(QuoteSupportError);
	});
});

describe("pairJudgments", () => {
	const predictions: QuoteSupportPredictionRef[] = [
		{ itemId: "a", goldMatched: true, contractValid: true },
		{ itemId: "b", goldMatched: false, contractValid: false },
		{ itemId: "c", goldMatched: null, contractValid: true },
	];
	const judgments = parseQuoteSupportJudgments({
		suiteId: "s",
		items: [
			{ itemId: "a", verdict: "supports" },
			{ itemId: "b", verdict: "insufficient" },
		],
	});

	test("pairs verdicts with caller-supplied gold and contract flags", () => {
		const paired = pairJudgments(predictions, judgments);
		expect(paired).toHaveLength(2);
		expect(paired[0]).toEqual({
			itemId: "a",
			goldMatched: true,
			contractValid: true,
			verdict: "supports",
		});
		expect(paired[1]?.contractValid).toBe(false);
	});

	test("unjudged predictions are allowed unless requireComplete", () => {
		expect(pairJudgments(predictions, judgments)).toHaveLength(2);
		expect(() =>
			pairJudgments(predictions, judgments, { requireComplete: true }),
		).toThrow(QuoteSupportError);
	});

	test("requireComplete passes when every prediction is judged", () => {
		const full = parseQuoteSupportJudgments({
			suiteId: "s",
			items: [
				{ itemId: "a", verdict: "supports" },
				{ itemId: "b", verdict: "supports" },
				{ itemId: "c", verdict: "contradicts" },
			],
		});
		expect(
			pairJudgments(predictions, full, { requireComplete: true }),
		).toHaveLength(3);
	});

	test("a judgment for an unknown prediction always throws", () => {
		const stray = parseQuoteSupportJudgments({
			suiteId: "s",
			items: [{ itemId: "zzz", verdict: "supports" }],
		});
		expect(() => pairJudgments(predictions, stray)).toThrow(QuoteSupportError);
	});
});
