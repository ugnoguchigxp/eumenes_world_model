/**
 * E03: quote semantic-support analysis (auxiliary, offline, pure).
 *
 * E03 separates three layers that the main scoring folds together:
 *
 * 1. Contract validity (layer 1): the quote's byte range, digest and
 *    source/version check out. This is an existing required check of the
 *    harness; here it only arrives as the per-item `contractValid` flag
 *    the caller computed, and is reported as `contractValidRate`.
 * 2. Semantic support (layer 2): whether the quote actually supports the
 *    claim's subject, relation, negation and conditions, judged as
 *    "supports" / "contradicts" / "insufficient". Judgments are produced
 *    OUTSIDE this module (by a judge model or a human) and arrive as a
 *    JSON document; this module only validates and aggregates them.
 * 3. Atomic precision (layer 3): among judged predictions, the share
 *    whose quote semantically supports the claim. It is reported
 *    SEPARATELY from gold recall: this module never computes recall and
 *    never invents gold figures — callers place their own recall numbers
 *    next to `atomicPrecision` so that a model cannot look good merely
 *    by staying silent.
 *
 * These are AUXILIARY metrics with no adoption authority. The judge does
 * not adopt, reject or rewrite any candidate, and nothing here touches
 * the A46/A50 thresholds, the frozen dataset or the main scoring. The
 * module is suite-agnostic: ext-ja and JacRED callers both map their
 * reports onto the small input shapes below.
 */

export type QuoteSupportVerdict = "supports" | "contradicts" | "insufficient";

const VERDICTS: ReadonlySet<string> = new Set([
	"supports",
	"contradicts",
	"insufficient",
]);

/**
 * One judged prediction/candidate. `goldMatched` is the caller's label
 * from the main scoring (true: the prediction matched gold; false: it
 * did not; null: gold status unknown or not applicable, e.g. for
 * candidates the main scoring never classified). `contractValid` is
 * layer 1 above, as computed by the caller's existing quote checks.
 */
export interface QuoteSupportItem {
	readonly itemId: string;
	readonly goldMatched: boolean | null;
	readonly contractValid: boolean;
	readonly verdict: QuoteSupportVerdict;
}

export interface QuoteSupportGroup {
	readonly total: number;
	readonly supports: number;
	readonly contradicts: number;
	readonly insufficient: number;
	/** supports / total; null when total is 0. */
	readonly supportRate: number | null;
}

export interface QuoteSupportSummary {
	/** All judged items. */
	readonly total: number;
	readonly supports: number;
	readonly contradicts: number;
	readonly insufficient: number;
	/** supports / total; null when total is 0. */
	readonly supportRate: number | null;
	/** Items whose quote passed layer-1 contract validation. */
	readonly contractValid: number;
	/** contractValid / total; null when total is 0. */
	readonly contractValidRate: number | null;
	/**
	 * Support rate restricted to contract-valid items; null when no item
	 * is contract-valid. Layer 1 and layer 2 stay separate: a quote can
	 * be position-valid yet not support the claim.
	 */
	readonly supportRateAmongContractValid: number | null;
	/** Breakdown by the caller's gold label (true / false / null). */
	readonly byGoldMatched: {
		readonly matched: QuoteSupportGroup;
		readonly mismatched: QuoteSupportGroup;
		readonly unknown: QuoteSupportGroup;
	};
	/** gold says match, but the quote does not support the claim. */
	readonly goldMatchedButNotSupported: number;
	/** gold says no match, yet the quote supports the claim. */
	readonly goldMismatchedButSupported: number;
	/**
	 * supports / (items with goldMatched !== null), falling back to
	 * supports / total when no item carries a gold label; null when the
	 * denominator is 0. Precision-side only — pair it with the caller's
	 * gold recall before drawing conclusions.
	 */
	readonly atomicPrecision: number | null;
}

export class QuoteSupportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "QuoteSupportError";
	}
}

const rate = (numerator: number, denominator: number): number | null =>
	denominator === 0 ? null : numerator / denominator;

function groupOf(items: readonly QuoteSupportItem[]): QuoteSupportGroup {
	let supports = 0;
	let contradicts = 0;
	let insufficient = 0;
	for (const item of items) {
		if (item.verdict === "supports") supports += 1;
		else if (item.verdict === "contradicts") contradicts += 1;
		else insufficient += 1;
	}
	return {
		total: items.length,
		supports,
		contradicts,
		insufficient,
		supportRate: rate(supports, items.length),
	};
}

/** Aggregates judged items into the three-layer summary above. */
export function summarizeQuoteSupport(
	items: readonly QuoteSupportItem[],
): QuoteSupportSummary {
	const all = groupOf(items);
	const valid = items.filter((item) => item.contractValid);
	const goldKnown = items.filter((item) => item.goldMatched !== null);
	return {
		total: all.total,
		supports: all.supports,
		contradicts: all.contradicts,
		insufficient: all.insufficient,
		supportRate: all.supportRate,
		contractValid: valid.length,
		contractValidRate: rate(valid.length, items.length),
		supportRateAmongContractValid: rate(
			valid.filter((item) => item.verdict === "supports").length,
			valid.length,
		),
		byGoldMatched: {
			matched: groupOf(items.filter((item) => item.goldMatched === true)),
			mismatched: groupOf(items.filter((item) => item.goldMatched === false)),
			unknown: groupOf(items.filter((item) => item.goldMatched === null)),
		},
		goldMatchedButNotSupported: items.filter(
			(item) => item.goldMatched === true && item.verdict !== "supports",
		).length,
		goldMismatchedButSupported: items.filter(
			(item) => item.goldMatched === false && item.verdict === "supports",
		).length,
		atomicPrecision:
			goldKnown.length > 0
				? rate(all.supports, goldKnown.length)
				: all.supportRate,
	};
}

/** One judgment entry of a judgments document. */
export interface QuoteSupportJudgment {
	readonly itemId: string;
	readonly verdict: QuoteSupportVerdict;
	readonly rationale?: string;
}

/** A judgments document, as produced by an external judge. */
export interface QuoteSupportJudgments {
	readonly suiteId: string;
	readonly items: readonly QuoteSupportJudgment[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Strictly validates an untrusted judgments document. Throws
 * QuoteSupportError on a missing or mistyped field, an unknown verdict,
 * or a duplicate itemId; nothing is silently repaired or dropped.
 */
export function parseQuoteSupportJudgments(
	input: unknown,
): QuoteSupportJudgments {
	if (!isRecord(input))
		throw new QuoteSupportError("judgments document must be an object");
	if (typeof input.suiteId !== "string" || input.suiteId.length === 0)
		throw new QuoteSupportError("suiteId must be a non-empty string");
	if (!Array.isArray(input.items))
		throw new QuoteSupportError("items must be an array");
	const seen = new Set<string>();
	const items: QuoteSupportJudgment[] = [];
	for (const [index, raw] of input.items.entries()) {
		if (!isRecord(raw))
			throw new QuoteSupportError(`items[${index}] must be an object`);
		if (typeof raw.itemId !== "string" || raw.itemId.length === 0)
			throw new QuoteSupportError(
				`items[${index}].itemId must be a non-empty string`,
			);
		if (seen.has(raw.itemId))
			throw new QuoteSupportError(`duplicate itemId: ${raw.itemId}`);
		seen.add(raw.itemId);
		if (typeof raw.verdict !== "string" || !VERDICTS.has(raw.verdict))
			throw new QuoteSupportError(
				`items[${index}].verdict is not a known verdict: ` +
					JSON.stringify(raw.verdict),
			);
		if (raw.rationale !== undefined && typeof raw.rationale !== "string")
			throw new QuoteSupportError(
				`items[${index}].rationale must be a string when present`,
			);
		items.push({
			itemId: raw.itemId,
			verdict: raw.verdict as QuoteSupportVerdict,
			...(raw.rationale === undefined ? {} : { rationale: raw.rationale }),
		});
	}
	return { suiteId: input.suiteId, items };
}

/**
 * A prediction awaiting judgment. The caller supplies the gold label and
 * the layer-1 contract flag per prediction; the module stays agnostic
 * about which suite or report shape they came from.
 */
export interface QuoteSupportPredictionRef {
	readonly itemId: string;
	readonly goldMatched: boolean | null;
	readonly contractValid: boolean;
}

/**
 * Joins predictions with their judgments into QuoteSupportItems.
 * A judgment whose itemId matches no prediction always throws. A
 * prediction left unjudged throws only when `requireComplete` is true;
 * otherwise it is simply absent from the result (and therefore from the
 * summary's denominator — callers wanting full coverage pass true).
 */
export function pairJudgments(
	predictions: readonly QuoteSupportPredictionRef[],
	judgments: QuoteSupportJudgments,
	options: { readonly requireComplete?: boolean } = {},
): QuoteSupportItem[] {
	const byId = new Map<string, QuoteSupportPredictionRef>();
	for (const prediction of predictions) {
		if (byId.has(prediction.itemId))
			throw new QuoteSupportError(
				`duplicate prediction itemId: ${prediction.itemId}`,
			);
		byId.set(prediction.itemId, prediction);
	}
	const judged = new Set<string>();
	const paired: QuoteSupportItem[] = [];
	for (const judgment of judgments.items) {
		const prediction = byId.get(judgment.itemId);
		if (prediction === undefined)
			throw new QuoteSupportError(
				`judgment for unknown itemId: ${judgment.itemId}`,
			);
		judged.add(judgment.itemId);
		paired.push({
			itemId: prediction.itemId,
			goldMatched: prediction.goldMatched,
			contractValid: prediction.contractValid,
			verdict: judgment.verdict,
		});
	}
	if (options.requireComplete === true) {
		for (const prediction of predictions)
			if (!judged.has(prediction.itemId))
				throw new QuoteSupportError(
					`prediction left unjudged: ${prediction.itemId}`,
				);
	}
	return paired;
}
