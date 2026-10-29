/**
 * P4-05.c (N04): offline comparison of two runs over the same cases
 * (typically the Local candidate A and the remote contrast B).
 *
 * Analysis only. This module reads finished reports; nothing here is
 * model-facing and the gold is used only to label outcomes after the fact
 * (a sample "matches" when its recorded evaluation equals the gold
 * outcome). Two different quantities are kept apart, because the plan
 * (N04) forbids confusing them:
 *
 * - the escalation UPPER BOUND is post-hoc: of the cases A failed, the
 *   share B happened to match. It uses the gold, so no runtime router
 *   could have known which cases those were; it is a ceiling on what any
 *   routing could recover, never an achievable rate.
 * - the DETECTABLE-route recovery only counts cases a runtime router
 *   could actually have flagged: A samples that are "routable" (defined
 *   below from fields recorded without looking at the case outcome) and
 *   that B then matched. Routable cases where A had in fact matched are
 *   reported separately as false escalations: a real router would have
 *   paid for them too.
 *
 * Routable (offline proxy): a sample is routable when its status is not
 * "ok" (a timeout, an invalid output the validator rejected, or an
 * error) or when its evaluation carries mismatch or violation codes.
 * CaseEvaluation retains no raw verdict list, so these recorded flags are
 * the harness-visible approximation of "the run itself flagged this
 * sample"; a production router would use the validator verdicts instead.
 */
import { evaluationMatched, type SampleStatus } from "./scoring.ts";
import type { RunReport, SampleRecord } from "./runner.ts";

export class RunComparisonError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RunComparisonError";
	}
}

/** Failure tallies of one run, over the paired cases only. */
export interface RunFailureTallies {
	/** Failed samples per sample status; sums to `failures`. */
	readonly byStatus: Readonly<Record<SampleStatus, number>>;
	/**
	 * Failed samples per evaluation reason code (the mismatch codes and
	 * the violation kinds of the sample's evaluation). One sample counts
	 * once per code it carries, so these need not sum to `failures`.
	 */
	readonly byReasonCode: Readonly<Record<string, number>>;
	readonly failures: number;
}

export interface RunComparison {
	readonly a: {
		readonly kind: string;
		readonly modelId: string;
		readonly modelVersion: string;
	};
	readonly b: {
		readonly kind: string;
		readonly modelId: string;
		readonly modelVersion: string;
	};
	/** Cases present in both runs; the only cases compared. */
	readonly cases: number;
	readonly bothMatch: number;
	/** A failed and B matched: the cases an escalation could recover. */
	readonly onlyAFailed: number;
	readonly onlyBFailed: number;
	readonly bothFailed: number;
	/** Cases present in one run only; excluded from every count above. */
	readonly unpaired: { readonly onlyInA: number; readonly onlyInB: number };
	readonly failuresA: RunFailureTallies;
	readonly failuresB: RunFailureTallies;
	/**
	 * (A failed and B matched) / A failures over the paired cases; null
	 * when A failed nothing. Post-hoc ceiling (see the header), not a
	 * runtime-achievable recovery rate.
	 */
	readonly escalationUpperBound: number | null;
	readonly detectableRoute: {
		/** Paired cases whose A sample is routable (see the header). */
		readonly routable: number;
		/** Routable cases A failed and B matched. */
		readonly recovered: number;
		/**
		 * recovered / routable cases A actually failed; null when no
		 * routable case of A failed.
		 */
		readonly recoveryRate: number | null;
		/** Routable cases A had in fact matched: wasted escalations. */
		readonly falseEscalations: number;
	};
}

const matched = (sample: SampleRecord): boolean =>
	evaluationMatched(sample.evaluation);

const routable = (sample: SampleRecord): boolean =>
	sample.status !== "ok" ||
	sample.evaluation.mismatches.length > 0 ||
	sample.evaluation.violations.length > 0;

function tallies(samples: readonly SampleRecord[]): RunFailureTallies {
	const byStatus: Record<SampleStatus, number> = {
		ok: 0,
		invalid_output: 0,
		timeout: 0,
		error: 0,
	};
	const byReasonCode: Record<string, number> = {};
	let failures = 0;
	for (const sample of samples) {
		if (matched(sample)) continue;
		failures += 1;
		byStatus[sample.status] += 1;
		const codes = new Set([
			...sample.evaluation.mismatches,
			...sample.evaluation.violations,
		]);
		for (const code of codes)
			byReasonCode[code] = (byReasonCode[code] ?? 0) + 1;
	}
	return { byStatus, byReasonCode, failures };
}

const label = (report: RunReport) => ({
	kind: report.provider.kind,
	modelId: report.provider.modelId,
	modelVersion: report.provider.modelVersion,
});

/**
 * Compares run A against run B case by case. The two runs must be the
 * same evaluation, dataset and split; anything else is not a comparison.
 */
export function compareRuns(a: RunReport, b: RunReport): RunComparison {
	if (a.evaluationVersion !== b.evaluationVersion)
		throw new RunComparisonError(
			`evaluation version mismatch: ${a.evaluationVersion} vs ${b.evaluationVersion}`,
		);
	if (a.datasetVersion !== b.datasetVersion)
		throw new RunComparisonError(
			`dataset version mismatch: ${a.datasetVersion} vs ${b.datasetVersion}`,
		);
	if (a.split !== b.split)
		throw new RunComparisonError(`split mismatch: ${a.split} vs ${b.split}`);
	const byIdA = new Map(a.samples.map((s) => [s.caseId, s]));
	const byIdB = new Map(b.samples.map((s) => [s.caseId, s]));
	const pairedA: SampleRecord[] = [];
	const pairedB: SampleRecord[] = [];
	for (const [caseId, sampleA] of byIdA) {
		const sampleB = byIdB.get(caseId);
		if (sampleB) {
			pairedA.push(sampleA);
			pairedB.push(sampleB);
		}
	}
	let bothMatch = 0;
	let onlyAFailed = 0;
	let onlyBFailed = 0;
	let bothFailed = 0;
	let routableCount = 0;
	let recovered = 0;
	let routableFailed = 0;
	let falseEscalations = 0;
	for (const [index, sampleA] of pairedA.entries()) {
		const sampleB = pairedB[index]!;
		const aMatched = matched(sampleA);
		const bMatched = matched(sampleB);
		if (aMatched && bMatched) bothMatch += 1;
		else if (!aMatched && bMatched) onlyAFailed += 1;
		else if (aMatched) onlyBFailed += 1;
		else bothFailed += 1;
		if (routable(sampleA)) {
			routableCount += 1;
			if (aMatched) falseEscalations += 1;
			else {
				routableFailed += 1;
				if (bMatched) recovered += 1;
			}
		}
	}
	const aFailures = onlyAFailed + bothFailed;
	return {
		a: label(a),
		b: label(b),
		cases: pairedA.length,
		bothMatch,
		onlyAFailed,
		onlyBFailed,
		bothFailed,
		unpaired: {
			onlyInA: byIdA.size - pairedA.length,
			onlyInB: byIdB.size - pairedB.length,
		},
		failuresA: tallies(pairedA),
		failuresB: tallies(pairedB),
		escalationUpperBound: aFailures === 0 ? null : onlyAFailed / aFailures,
		detectableRoute: {
			routable: routableCount,
			recovered,
			recoveryRate: routableFailed === 0 ? null : recovered / routableFailed,
			falseEscalations,
		},
	};
}
