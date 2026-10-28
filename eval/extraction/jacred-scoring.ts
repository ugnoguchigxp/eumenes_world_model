/**
 * E01 scoring for the JacRED suite (jacred-ja-v1): pure functions over gold
 * triples and already-parsed predictions. Separate from the A46 scoring in
 * scoring.ts; the two suites' numbers are never mixed.
 *
 * Validity rule: a prediction whose subject id, object id or relation code
 * is not in the case's supplied entity ids / the suite's predicate codes is
 * an invalid prediction. Invalid predictions are counted separately and
 * excluded from tp/fp: an unresolved alias or an invented id is a parse /
 * resolution failure of the harness-visible output, not a wrong relation.
 * quoteMissing counts scored (valid, deduplicated) predictions that carry
 * no quote utterance.
 */
import type { JacredGoldTriple } from "./jacred.ts";

/** One parsed relation prediction, as produced by jacred-runner. */
export interface JacredPrediction {
	readonly subjectId: string;
	readonly relation: string;
	readonly objectId: string;
	/** Utterance the model cited ("s<n>"), or null when it cited none. */
	readonly quoteUtteranceId: string | null;
}

export interface JacredScoreRates {
	readonly tp: number;
	readonly fp: number;
	readonly fn: number;
	/** tp / (tp + fp); 0 when nothing valid was predicted. */
	readonly precision: number;
	/** tp / (tp + fn); 0 when there is no gold. */
	readonly recall: number;
	readonly f1: number;
	/** TP triples whose cited utterance is the gold evidence utterance. */
	readonly evidenceMatch: number;
	/** evidenceMatch / tp; 0 when tp is 0. */
	readonly evidenceAccuracy: number;
	/** Predictions excluded by the validity rule above. */
	readonly invalidPredictions: number;
	/** Valid deduplicated predictions without a quote utterance. */
	readonly quoteMissing: number;
}

export type JacredCaseScore = JacredScoreRates;

export interface JacredTotals extends JacredScoreRates {
	readonly cases: number;
}

interface JacredCounts {
	readonly tp: number;
	readonly fp: number;
	readonly fn: number;
	readonly evidenceMatch: number;
	readonly invalidPredictions: number;
	readonly quoteMissing: number;
}

const rate = (numerator: number, denominator: number): number =>
	denominator === 0 ? 0 : numerator / denominator;

function ratesOf(counts: JacredCounts): JacredScoreRates {
	const precision = rate(counts.tp, counts.tp + counts.fp);
	const recall = rate(counts.tp, counts.tp + counts.fn);
	return {
		tp: counts.tp,
		fp: counts.fp,
		fn: counts.fn,
		precision,
		recall,
		f1:
			precision + recall === 0
				? 0
				: (2 * precision * recall) / (precision + recall),
		evidenceMatch: counts.evidenceMatch,
		evidenceAccuracy: rate(counts.evidenceMatch, counts.tp),
		invalidPredictions: counts.invalidPredictions,
		quoteMissing: counts.quoteMissing,
	};
}

const tripleKey = (subjectId: string, relation: string, objectId: string) =>
	JSON.stringify([subjectId, relation, objectId]);

export interface JacredScoreInput {
	readonly gold: readonly JacredGoldTriple[];
	readonly predictions: readonly JacredPrediction[];
	/** Entity ids supplied for the case (the validity domain for ids). */
	readonly entityIds: ReadonlySet<string>;
	/** Predicate codes of the suite (the validity domain for relations). */
	readonly relationCodes: ReadonlySet<string>;
}

/** Scores one case. Predictions are deduplicated first, keeping the first. */
export function scoreJacredCase(input: JacredScoreInput): JacredCaseScore {
	const goldByKey = new Map<string, JacredGoldTriple>();
	for (const triple of input.gold)
		goldByKey.set(
			tripleKey(triple.subjectId, triple.relation, triple.objectId),
			triple,
		);
	const seen = new Set<string>();
	let tp = 0;
	let fp = 0;
	let evidenceMatch = 0;
	let invalidPredictions = 0;
	let quoteMissing = 0;
	for (const prediction of input.predictions) {
		const key = tripleKey(
			prediction.subjectId,
			prediction.relation,
			prediction.objectId,
		);
		if (seen.has(key)) continue;
		seen.add(key);
		const valid =
			input.entityIds.has(prediction.subjectId) &&
			input.entityIds.has(prediction.objectId) &&
			input.relationCodes.has(prediction.relation);
		if (!valid) {
			invalidPredictions += 1;
			continue;
		}
		if (prediction.quoteUtteranceId === null) quoteMissing += 1;
		const gold = goldByKey.get(key);
		if (gold === undefined) {
			fp += 1;
			continue;
		}
		tp += 1;
		if (prediction.quoteUtteranceId === gold.evidenceUtteranceId)
			evidenceMatch += 1;
	}
	return ratesOf({
		tp,
		fp,
		fn: goldByKey.size - tp,
		evidenceMatch,
		invalidPredictions,
		quoteMissing,
	});
}

/**
 * Micro-averaged totals over per-case rows: counts are summed first and
 * the rates are computed from the sums (never averaged per case). The
 * per-case rows are returned alongside, unchanged.
 */
export function aggregateJacredScores(rows: readonly JacredCaseScore[]): {
	readonly cases: readonly JacredCaseScore[];
	readonly totals: JacredTotals;
} {
	const sum = {
		tp: 0,
		fp: 0,
		fn: 0,
		evidenceMatch: 0,
		invalidPredictions: 0,
		quoteMissing: 0,
	};
	for (const row of rows) {
		sum.tp += row.tp;
		sum.fp += row.fp;
		sum.fn += row.fn;
		sum.evidenceMatch += row.evidenceMatch;
		sum.invalidPredictions += row.invalidPredictions;
		sum.quoteMissing += row.quoteMissing;
	}
	return {
		cases: rows,
		totals: { ...ratesOf(sum), cases: rows.length },
	};
}
