/**
 * Deterministic runner for the cache-latency scenario (P5-03). It chains the
 * pure World APIs: explicit Goal -> candidate -> conditions/dependencies ->
 * measurement plan -> permission gate -> observations -> assessOutcome ->
 * report. Measurement is an injected executor; this runner never executes a
 * Tool, reads a host ledger, or calls a model.
 */
import {
	assessOutcome,
	checkDependencies,
	findResearchGaps,
	type Checked,
	type DependencyResult,
	type GoalReference,
	type IncomparableReason,
	type ResearchGap,
	type SourceRef,
} from "../../../src/index.ts";
import {
	AS_OF_MS,
	CONDITION_OBSERVATIONS,
	EDGES,
	GOAL,
	INTERVENTION,
	PLAN,
	SCOPE,
	SUBJECT_ID,
	type IngestRecord,
	type LedgerRecord,
	type MeasurementPlan,
	type RunSettings,
} from "./fixture.ts";
import { p95NearestRank } from "./scorer.ts";

export interface ToolPermission {
	readonly granted: boolean;
	readonly grantRef?: string;
}
/** Replays pre-fixed ledger records. Counts calls so tests can see any run. */
export interface MeasurementExecutor {
	readonly calls: number;
	run(plan: MeasurementPlan): readonly LedgerRecord[];
}
export function createReplayExecutor(
	records: readonly LedgerRecord[],
): MeasurementExecutor {
	let calls = 0;
	return {
		get calls() {
			return calls;
		},
		run() {
			calls++;
			return records;
		},
	};
}

export type ResourceStates = readonly {
	readonly entityId: string;
	readonly state: "available" | "unavailable" | "unknown";
}[];
export interface RunInput {
	readonly goal?: GoalReference;
	readonly plan?: MeasurementPlan;
	readonly toolPermission: ToolPermission;
	readonly executor: MeasurementExecutor;
	/** Model text reported alongside the run; never an observation. */
	readonly claims?: readonly IngestRecord[];
	/** Replaces the default resource states (tool state follows permission). */
	readonly resourceStates?: ResourceStates;
}

/** Why no measurement was started. Never a request that was executed. */
export interface NeedsPermissionGap {
	readonly status: "measurement_gap";
	readonly reasonCode: "TOOL_PERMISSION_REQUIRED" | "DEPENDENCY_NOT_SATISFIED";
	readonly predictionId: string;
	readonly automaticMeasurementStarted: false;
}
export type RejectReason =
	| "LLM_TEXT_NOT_OBSERVATION"
	| "LEDGER_UNVERIFIED"
	| "TOOL_RUN_FAILED"
	| "TOO_FEW_SAMPLES"
	| "INVALID_SAMPLES"
	| "DUPLICATE_REVISION"
	| "LATEST_REVISION_REJECTED";
export interface RejectedRecord {
	readonly recordId: string;
	readonly revision?: number;
	readonly reason: RejectReason;
}
export type WorkStatus =
	| "not_started"
	| "completed"
	| "failed"
	| "not_confirmed";
export type HypothesisVerdict =
	| "supported"
	| "refuted"
	| "incomparable"
	| "mixed"
	| "not_measured";

/** An observation with the chain back to its source and ledger revision. */
export interface TracedObservation {
	readonly outcomeId: string;
	readonly revision: number;
	readonly ledgerEntryId: string;
	readonly ledgerRevision: number;
	readonly toolRunId: string;
	readonly sourceRef: SourceRef;
	readonly p95: number;
	readonly verdict: "supported" | "refuted" | "incomparable";
	readonly delta?: number;
	readonly reasons: readonly IncomparableReason[];
}
export type AdoptionJudgment =
	| "keep_candidate"
	| "drop_candidate"
	| "undetermined"
	| "moot_goal_retracted";

export interface CacheLatencyReport {
	readonly goal: GoalReference;
	readonly prediction: { readonly id: string; readonly revision: number };
	readonly dependencies: Pick<
		DependencyResult,
		"outcome" | "unsatisfied" | "unknown" | "successConfirmed"
	>;
	readonly gaps: readonly ResearchGap[];
	readonly measurement: {
		readonly status: "executed" | "needs_permission" | "blocked";
		readonly gap?: NeedsPermissionGap;
		readonly executorCalls: number;
	};
	/** "The work was done": what the ledger says about the run itself. */
	readonly work: {
		readonly status: WorkStatus;
		readonly ledger: readonly {
			readonly ledgerEntryId: string;
			readonly ledgerRevision: number;
		}[];
	};
	/** "The hypothesis is supported": only what the observations say. */
	readonly hypothesis: {
		readonly verdict: HypothesisVerdict;
		readonly causalProof: false;
		readonly counts: {
			readonly supported: number;
			readonly refuted: number;
			readonly incomparable: number;
		};
		readonly incomparableReasons: readonly IncomparableReason[];
	};
	readonly observations: readonly TracedObservation[];
	readonly supersededObservations: readonly {
		readonly outcomeId: string;
		readonly revision: number;
	}[];
	readonly rejected: readonly RejectedRecord[];
	readonly adoption: {
		readonly judgment: AdoptionJudgment;
		readonly basis: {
			readonly goalId: string;
			readonly goalRevision: number;
			readonly goalStatus: GoalReference["status"];
			readonly predictionId: string;
			readonly predictionRevision: number;
			readonly observations: readonly {
				readonly outcomeId: string;
				readonly revision: number;
				readonly ledgerRevision: number;
				readonly sourceRevision: string;
			}[];
		};
	};
}

const PREDICTION_ID = "pred-cache-latency";
const COMPARISON_ID = "cmp-cache-latency";
const PREDICTION_REVISION = 1;
const TOOL_ENTITY = "latency-measurement-tool";
const CACHE_ENTITY = "cache-candidate";

function must<T>(checked: Checked<T>): T {
	if (!checked.ok)
		throw new Error(`World call failed: ${checked.code} at ${checked.path}`);
	return checked.value;
}

const configurationOf = (
	x: Pick<RunSettings, "model" | "prefix" | "warmState">,
) => `model=${x.model};prefix=${x.prefix};warm=${x.warmState}`;

/** The quantitative prediction that carries the plan's fixed conditions. */
export function buildPrediction(plan: MeasurementPlan) {
	return {
		kind: "quantitative",
		predictionId: PREDICTION_ID,
		revision: PREDICTION_REVISION,
		comparisonId: COMPARISON_ID,
		conditions: {
			subjectId: SUBJECT_ID,
			metric: plan.metric,
			unit: plan.unit,
			statistic: plan.statistic,
			configuration: configurationOf(plan),
			inputProfile: plan.inputLength,
		},
		baselineRef: plan.baselineRef,
		baselineValue: plan.baselineValue,
		expectedWindow: plan.period,
		expectedDirection: "decreases",
		measurementTolerance: plan.tolerance,
		origin: "world_hypothesis",
		intervention: INTERVENTION,
	};
}

function buildOutcome(record: LedgerRecord, p95: number) {
	return {
		kind: "outcome",
		outcomeId: record.ledgerEntryId,
		revision: record.ledgerRevision,
		comparisonId: COMPARISON_ID,
		predictionRevision: PREDICTION_REVISION,
		conditions: {
			subjectId: SUBJECT_ID,
			metric: record.run.metric,
			unit: record.run.unit,
			statistic: record.run.statistic,
			configuration: configurationOf(record.run),
			inputProfile: record.run.inputLength,
		},
		baselineRef: record.run.baselineRef,
		window: record.run.period,
		value: p95,
	};
}

interface Ingested {
	readonly outcomes: readonly ReturnType<typeof buildOutcome>[];
	readonly records: ReadonlyMap<string, LedgerRecord>;
	readonly rejected: readonly RejectedRecord[];
	/** Verified and succeeded ledger records, latest revision per entry. */
	readonly confirmed: readonly LedgerRecord[];
	readonly failedRuns: number;
}
const keyOf = (id: string, revision: number) => `${id}\u0000${revision}`;

/**
 * Turns records into outcomes. Only a verified, succeeded ledger entry with
 * enough finite samples is an observation. If the latest revision of an entry
 * is rejected, no older revision of it is used instead.
 */
export function ingest(
	input: readonly IngestRecord[],
	plan: MeasurementPlan,
): Ingested {
	const rejected: RejectedRecord[] = [];
	const accepted = new Map<string, LedgerRecord>();
	const ledger: LedgerRecord[] = [];
	for (const record of input) {
		if (record.kind === "llm_text") {
			rejected.push({
				recordId: record.claimId,
				reason: "LLM_TEXT_NOT_OBSERVATION",
			});
			continue;
		}
		const key = keyOf(record.ledgerEntryId, record.ledgerRevision);
		if (ledger.some((r) => keyOf(r.ledgerEntryId, r.ledgerRevision) === key)) {
			rejected.push({
				recordId: record.ledgerEntryId,
				revision: record.ledgerRevision,
				reason: "DUPLICATE_REVISION",
			});
			continue;
		}
		ledger.push(record);
	}
	const reasonOf = (record: LedgerRecord): RejectReason | undefined => {
		if (record.verification !== "verified") return "LEDGER_UNVERIFIED";
		if (record.runStatus !== "succeeded") return "TOOL_RUN_FAILED";
		if (!record.samples.every((v) => Number.isFinite(v)))
			return "INVALID_SAMPLES";
		if (record.samples.length < plan.minSamples) return "TOO_FEW_SAMPLES";
		return undefined;
	};
	const latest = new Map<string, number>();
	for (const record of ledger)
		latest.set(
			record.ledgerEntryId,
			Math.max(latest.get(record.ledgerEntryId) ?? 0, record.ledgerRevision),
		);
	const confirmed: LedgerRecord[] = [];
	let failedRuns = 0;
	const dead = new Set<string>();
	for (const record of ledger) {
		if (record.ledgerRevision !== latest.get(record.ledgerEntryId)) continue;
		const reason = reasonOf(record);
		if (record.runStatus === "failed") failedRuns++;
		if (reason !== undefined) {
			dead.add(record.ledgerEntryId);
			rejected.push({
				recordId: record.ledgerEntryId,
				revision: record.ledgerRevision,
				reason,
			});
		} else confirmed.push(record);
	}
	const outcomes: ReturnType<typeof buildOutcome>[] = [];
	for (const record of ledger) {
		if (dead.has(record.ledgerEntryId)) {
			if (record.ledgerRevision !== latest.get(record.ledgerEntryId))
				rejected.push({
					recordId: record.ledgerEntryId,
					revision: record.ledgerRevision,
					reason: "LATEST_REVISION_REJECTED",
				});
			continue;
		}
		if (reasonOf(record) !== undefined) {
			rejected.push({
				recordId: record.ledgerEntryId,
				revision: record.ledgerRevision,
				reason: reasonOf(record)!,
			});
			continue;
		}
		accepted.set(keyOf(record.ledgerEntryId, record.ledgerRevision), record);
		outcomes.push(buildOutcome(record, p95NearestRank(record.samples)!));
	}
	return { outcomes, records: accepted, rejected, confirmed, failedRuns };
}

function workStatus(
	executed: boolean,
	ingested: Ingested | undefined,
): WorkStatus {
	if (!executed || !ingested) return "not_started";
	if (ingested.confirmed.length > 0) return "completed";
	return ingested.failedRuns > 0 ? "failed" : "not_confirmed";
}

function judgment(
	goal: GoalReference,
	verdict: HypothesisVerdict,
): AdoptionJudgment {
	if (goal.status === "retracted") return "moot_goal_retracted";
	if (verdict === "supported") return "keep_candidate";
	if (verdict === "refuted") return "drop_candidate";
	return "undetermined";
}

export function runCacheLatency(input: RunInput): CacheLatencyReport {
	const goal = input.goal ?? GOAL;
	const plan = input.plan ?? PLAN;
	const permission = input.toolPermission;
	const resourceStates: ResourceStates = input.resourceStates ?? [
		{ entityId: "prefix-cache-capability", state: "available" },
		{ entityId: "stable-prefix", state: "available" },
		// Without a granted permission the tool is not known to be usable.
		{
			entityId: TOOL_ENTITY,
			state: permission.granted ? "available" : "unknown",
		},
	];
	const graph = {
		contractVersion: 1,
		scope: SCOPE,
		authorized: true,
		asOf: AS_OF_MS,
		maxAgeMs: 86_400_000,
		observations: CONDITION_OBSERVATIONS,
		edges: EDGES,
	};
	const dependencies = must(
		checkDependencies({ ...graph, entityId: CACHE_ENTITY, resourceStates }),
	);
	// Every dependency gap that is not yet confirmed blocks the Goal while the
	// Goal is adopted; a retracted Goal blocks nothing (the World rule).
	const annotations = EDGES.filter((e) => e.relation === "depends_on").flatMap(
		(e) =>
			(["MISSING_RESOURCE", "RESOURCE_STATE_UNKNOWN"] as const).map((kind) => ({
				gapKey: `${kind}:${e.id}`,
				blocksGoal: true,
			})),
	);
	const gaps = must(
		findResearchGaps({ ...graph, resourceStates, goal, annotations }),
	).gaps;

	let gap: NeedsPermissionGap | undefined;
	if (!permission.granted)
		gap = {
			status: "measurement_gap",
			reasonCode: "TOOL_PERMISSION_REQUIRED",
			predictionId: PREDICTION_ID,
			automaticMeasurementStarted: false,
		};
	else if (dependencies.outcome !== "all_available")
		gap = {
			status: "measurement_gap",
			reasonCode: "DEPENDENCY_NOT_SATISFIED",
			predictionId: PREDICTION_ID,
			automaticMeasurementStarted: false,
		};

	let ingested: Ingested | undefined;
	if (gap === undefined)
		ingested = ingest(
			[...input.executor.run(plan), ...(input.claims ?? [])],
			plan,
		);
	else if (input.claims)
		ingested = ingest(
			input.claims.filter((r) => r.kind === "llm_text"),
			plan,
		);

	let verdict: HypothesisVerdict = "not_measured";
	let counts = { supported: 0, refuted: 0, incomparable: 0 };
	let incomparableReasons: IncomparableReason[] = [];
	let observations: TracedObservation[] = [];
	let superseded: { outcomeId: string; revision: number }[] = [];
	if (gap === undefined && ingested && ingested.outcomes.length > 0) {
		const assessed = must(
			assessOutcome({
				contractVersion: 1,
				scope: SCOPE,
				prediction: buildPrediction(plan),
				observations: ingested.outcomes,
			}),
		);
		if (assessed.status !== "assessed")
			throw new Error("prediction must be quantitative");
		verdict = assessed.verdict;
		counts = { ...assessed.counts };
		incomparableReasons = assessed.incomparableReasons.map((r) => r.reason);
		superseded = assessed.supersededObservations.map((s) => ({ ...s }));
		observations = assessed.observations.map((o) => {
			const record = ingested.records.get(keyOf(o.outcomeId, o.revision))!;
			return {
				outcomeId: o.outcomeId,
				revision: o.revision,
				ledgerEntryId: record.ledgerEntryId,
				ledgerRevision: record.ledgerRevision,
				toolRunId: record.toolRunId,
				sourceRef: record.sourceRef,
				p95: p95NearestRank(record.samples)!,
				verdict: o.verdict,
				...(o.delta === undefined ? {} : { delta: o.delta }),
				reasons: o.reasons,
			};
		});
	}
	return {
		goal,
		prediction: { id: PREDICTION_ID, revision: PREDICTION_REVISION },
		dependencies: {
			outcome: dependencies.outcome,
			unsatisfied: dependencies.unsatisfied,
			unknown: dependencies.unknown,
			successConfirmed: dependencies.successConfirmed,
		},
		gaps,
		measurement: {
			status:
				gap === undefined
					? "executed"
					: gap.reasonCode === "TOOL_PERMISSION_REQUIRED"
						? "needs_permission"
						: "blocked",
			...(gap === undefined ? {} : { gap }),
			executorCalls: input.executor.calls,
		},
		work: {
			status: workStatus(gap === undefined, ingested),
			ledger: (ingested?.confirmed ?? []).map((r) => ({
				ledgerEntryId: r.ledgerEntryId,
				ledgerRevision: r.ledgerRevision,
			})),
		},
		hypothesis: { verdict, causalProof: false, counts, incomparableReasons },
		observations,
		supersededObservations: superseded,
		rejected: ingested?.rejected ?? [],
		adoption: {
			judgment: judgment(goal, verdict),
			basis: {
				goalId: goal.goalId,
				goalRevision: goal.revision,
				goalStatus: goal.status,
				predictionId: PREDICTION_ID,
				predictionRevision: PREDICTION_REVISION,
				observations: observations.map((o) => ({
					outcomeId: o.outcomeId,
					revision: o.revision,
					ledgerRevision: o.ledgerRevision,
					sourceRevision: o.sourceRef.revision,
				})),
			},
		},
	};
}
