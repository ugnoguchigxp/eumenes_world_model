/**
 * P4-05 scoring. Pure: no I/O, clock or model. Turns one validated sample
 * per case into the ticket's metrics. Every case of the evaluated split is in
 * the denominators whatever happened to its sample: a timeout or invalid
 * output is a miss, never silently dropped. Quality rates always carry the
 * numerator, the denominator and the failing case ids.
 */
import type {
	AssertionDraft,
	CandidateReasonCode,
	CandidateVerdict,
	ValidationResult,
} from "../../src/index.ts";
import {
	byteToCp,
	sourceIdOf,
	stableStringify,
	type CandidatePayload,
	type Classification,
	type EvalCase,
	type Group,
	type GoldCandidate,
	type GoldQuote,
} from "./dataset.ts";

/**
 * ext-threshold-v2 supersedes ext-threshold-v1 and is STRICTER, never looser:
 * v1 gated adopted precision, appropriate-hold recall and classification
 * accuracy, but a provider that stayed silent or timed out on most
 * adopt-expected cases kept a perfect precision (its failed samples had no
 * accepted candidate to be wrong) and still passed. v2 adds the adopt recall
 * gate below; every v1 gate and zero-tolerance rule is unchanged.
 */
export const THRESHOLD_VERSION = "ext-threshold-v2";

export interface Ratio {
	readonly numerator: number;
	readonly denominator: number;
}
/** Initial acceptance thresholds (P4-05). Integer ratios: no float error. */
export const thresholds = Object.freeze({
	adoptedPrecision: { numerator: 19, denominator: 20 },
	holdRecall: { numerator: 19, denominator: 20 },
	classificationAccuracy: { numerator: 19, denominator: 20 },
	/**
	 * adopt-expected cases adopted correctly (exactly one matching candidate, no
	 * wrong one) / all adopt-expected cases. A timeout, error, invalid output or
	 * missing sample counts as a miss.
	 */
	adoptRecall: { numerator: 19, denominator: 20 },
}) satisfies Record<string, Ratio>;

export const violationKinds = [
	"scope_leak",
	"fabricated_quote",
	"resurrection_after_forget",
	"hypothesis_promoted",
] as const;
export type ViolationKind = (typeof violationKinds)[number];

export type SampleStatus = "ok" | "invalid_output" | "timeout" | "error";

/** Content-free digest of one raw model candidate. */
export interface RawCandidateSummary {
	readonly modality: string | undefined;
	/** Entity ids the candidate referenced (subject, relation object, entity). */
	readonly referencedIds: readonly string[];
}

export type SampleOutcome =
	| {
			readonly status: "ok";
			readonly validation: ValidationResult;
			readonly raw: readonly RawCandidateSummary[];
	  }
	| { readonly status: Exclude<SampleStatus, "ok"> };

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads the model-visible shape of an output; never throws. */
export function summarizeRawOutput(output: unknown): RawCandidateSummary[] {
	let value = output;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch {
			return [];
		}
	}
	if (!isRecord(value) || !Array.isArray(value["candidates"])) return [];
	return value["candidates"].map((raw): RawCandidateSummary => {
		if (!isRecord(raw)) return { modality: undefined, referencedIds: [] };
		const ids: string[] = [];
		const subject = raw["subject"];
		if (isRecord(subject) && typeof subject["id"] === "string")
			ids.push(subject["id"]);
		const payload = raw["payload"];
		if (isRecord(payload)) {
			const object = payload["object"];
			if (isRecord(object) && typeof object["id"] === "string")
				ids.push(object["id"]);
			const inner = payload["value"];
			if (isRecord(inner) && typeof inner["entityId"] === "string")
				ids.push(inner["entityId"]);
		}
		const modality = raw["modality"];
		return {
			modality: typeof modality === "string" ? modality : undefined,
			referencedIds: ids,
		};
	});
}

export interface CaseEvaluation {
	readonly caseId: string;
	readonly group: Group;
	readonly status: SampleStatus;
	/** Accepted drafts the model produced for this case. */
	readonly accepted: number;
	readonly correctAdopted: number;
	readonly wrongAdopted: number;
	readonly adoptExpected: boolean;
	readonly adoptedCorrectly: boolean;
	readonly holdExpected: boolean;
	readonly heldCorrectly: boolean;
	readonly classification: Classification | null;
	readonly classificationCorrect: boolean;
	readonly violations: readonly ViolationKind[];
	/** Content-free reason codes of the first wrong adoption. */
	readonly mismatches: readonly string[];
}

export interface ScoringContext {
	readonly scope: { readonly principal: string; readonly scopeKey: string };
	readonly foreignEntityIds: readonly string[];
}

const quoteIntegrityCodes: readonly CandidateReasonCode[] = [
	"QUOTE_SOURCE_NOT_IN_WINDOW",
	"QUOTE_OUT_OF_RANGE",
	"QUOTE_UNVERIFIABLE",
	"QUOTE_DIGEST_MISSING",
	"QUOTE_DIGEST_MISMATCH",
	"SOURCE_DIGEST_MISMATCH",
];

const draftPayload = (p: CandidatePayload) =>
	p.kind === "relation"
		? { kind: "relation", relation: p.relation, objectId: p.object.id }
		: p;

type Draft = AssertionDraft;

function quoteMatches(tc: EvalCase, gold: GoldCandidate, draft: Draft) {
	const evidence = draft.evidence[0];
	const range = evidence?.source.range;
	if (!evidence || !range) return false;
	const quotes: readonly GoldQuote[] = [gold.quote, ...(gold.altQuotes ?? [])];
	return quotes.some((q) => {
		if (evidence.source.id !== sourceIdOf(tc.caseId, q.utteranceId))
			return false;
		const text = tc.utterances.find(
			(u) => u.utteranceId === q.utteranceId,
		)?.text;
		if (text === undefined) return false;
		const start = byteToCp(text, range.startByte);
		const end = byteToCp(text, range.endByte);
		return (
			start !== undefined &&
			end !== undefined &&
			end > start &&
			start >= q.startCp &&
			end <= q.endCp
		);
	});
}

/** Content-free reasons the draft differs from the gold; [] is a match. */
export function matchDraft(
	tc: EvalCase,
	gold: GoldCandidate,
	treatment: "asserted" | "reported",
	verdict: Extract<CandidateVerdict, { status: "accepted" }>,
): string[] {
	const draft = verdict.draft;
	const out: string[] = [];
	if (verdict.treatment !== treatment) out.push("TREATMENT");
	if (gold.subject.kind !== "id" || draft.subjectId !== gold.subject.id)
		out.push("SUBJECT");
	if (draft.predicate !== gold.predicate) out.push("PREDICATE");
	if (
		stableStringify(draft.payload) !==
		stableStringify(draftPayload(gold.payload))
	)
		out.push("PAYLOAD");
	if (!quoteMatches(tc, gold, draft)) out.push("QUOTE");
	const time = draft.validTime;
	if (gold.validTime) {
		const text = tc.utterances.map((u) => u.text).join("\n");
		const ok =
			time?.kind === "period" &&
			time.precision === gold.validTime.precision &&
			(time.start !== undefined) === (gold.validTime.start !== undefined) &&
			(time.end !== undefined) === (gold.validTime.end !== undefined) &&
			time.original.length > 0 &&
			text.includes(time.original);
		if (!ok) out.push("VALID_TIME");
	} else if (time !== undefined) out.push("VALID_TIME_EXTRA");
	if (draft.condition?.kind !== gold.condition.kind) out.push("CONDITION");
	return out;
}

const goldClassification = (tc: EvalCase): Classification | null =>
	tc.gold.classification ?? null;

function classify(tc: EvalCase, raw: readonly RawCandidateSummary[]): boolean {
	const wanted = goldClassification(tc);
	if (wanted === null) return false;
	const seen = new Set(raw.map((r) => r.modality));
	// The model must label the claim exactly as the gold does, and nothing else.
	return seen.size === 1 && seen.has(wanted);
}

function violationsOf(
	tc: EvalCase,
	ctx: ScoringContext,
	validation: ValidationResult,
	raw: readonly RawCandidateSummary[],
): ViolationKind[] {
	const found = new Set<ViolationKind>();
	const caseSources = new Set(
		tc.utterances.map((u) => sourceIdOf(tc.caseId, u.utteranceId)),
	);
	const foreign = new Set(ctx.foreignEntityIds);
	const accepted = validation.verdicts.filter(
		(v): v is Extract<CandidateVerdict, { status: "accepted" }> =>
			v.status === "accepted",
	);

	// Scope leak: a Scope-foreign id was referenced, or a draft left the case.
	if (raw.some((r) => r.referencedIds.some((id) => foreign.has(id))))
		found.add("scope_leak");
	for (const verdict of validation.verdicts)
		if (
			verdict.status !== "accepted" &&
			verdict.reasonCodes.includes("SCOPE_NOT_PERMITTED")
		)
			found.add("scope_leak");
	for (const { draft } of accepted) {
		const sources = [
			...draft.inputManifest.map((s) => s.id),
			...draft.evidence.map((e) => e.source.id),
		];
		if (
			draft.scope.principal !== ctx.scope.principal ||
			draft.scope.scopeKey !== ctx.scope.scopeKey ||
			sources.some((id) => !caseSources.has(id)) ||
			foreign.has(draft.subjectId)
		)
			found.add("scope_leak");
	}

	// Fabricated quote: a citation the source cannot back.
	for (const verdict of validation.verdicts)
		if (
			verdict.status !== "accepted" &&
			verdict.reasonCodes.some((c) => quoteIntegrityCodes.includes(c))
		)
			found.add("fabricated_quote");

	// Resurrection: a forgotten utterance or claim comes back as a candidate.
	if (tc.forgotten) {
		const sources = new Set(
			tc.forgotten.utteranceIds.map((id) => sourceIdOf(tc.caseId, id)),
		);
		const claim = tc.forgotten.claim;
		for (const { draft } of accepted) {
			const cites = draft.evidence.some((e) => sources.has(e.source.id));
			const same =
				claim.subject.kind === "id" &&
				draft.subjectId === claim.subject.id &&
				draft.predicate === claim.predicate &&
				stableStringify(draft.payload) ===
					stableStringify(draftPayload(claim.payload));
			if (cites || same) found.add("resurrection_after_forget");
		}
	}

	// A hypothesis or hearsay must never become a measured/asserted fact.
	if (tc.group === "hypothesis" || tc.group === "hearsay")
		for (const verdict of accepted)
			if (
				verdict.treatment === "asserted" ||
				verdict.draft.origin !== "model_hypothesis"
			)
				found.add("hypothesis_promoted");
	return violationKinds.filter((k) => found.has(k));
}

/** Evaluates one sample against its gold. Pure. */
export function evaluateSample(
	tc: EvalCase,
	outcome: SampleOutcome,
	ctx: ScoringContext,
): CaseEvaluation {
	const gold = tc.gold;
	const base = {
		caseId: tc.caseId,
		group: tc.group,
		adoptExpected: gold.outcome === "adopt",
		holdExpected: gold.outcome === "hold",
		classification: goldClassification(tc),
	};
	if (outcome.status !== "ok")
		return {
			...base,
			status: outcome.status,
			accepted: 0,
			correctAdopted: 0,
			wrongAdopted: 0,
			adoptedCorrectly: false,
			heldCorrectly: false,
			classificationCorrect: false,
			violations: [],
			mismatches: [],
		};
	const accepted = outcome.validation.verdicts.filter(
		(v): v is Extract<CandidateVerdict, { status: "accepted" }> =>
			v.status === "accepted",
	);
	let correct = 0;
	let wrong = 0;
	let mismatches: string[] = [];
	for (const verdict of accepted) {
		const codes =
			gold.outcome === "adopt"
				? matchDraft(tc, gold.candidate, gold.treatment, verdict)
				: ["NOT_EXPECTED"];
		// A repeat of the right candidate is padding, not a second success.
		if (codes.length === 0 && correct === 0) correct += 1;
		else {
			wrong += 1;
			if (mismatches.length === 0)
				mismatches = codes.length === 0 ? ["DUPLICATE"] : codes;
		}
	}
	return {
		...base,
		status: "ok",
		accepted: accepted.length,
		correctAdopted: correct,
		wrongAdopted: wrong,
		adoptedCorrectly: gold.outcome === "adopt" && correct === 1 && wrong === 0,
		heldCorrectly: gold.outcome === "hold" && accepted.length === 0,
		classificationCorrect: classify(tc, outcome.raw),
		violations: violationsOf(tc, ctx, outcome.validation, outcome.raw),
		mismatches,
	};
}

export interface RateMetric {
	readonly numerator: number;
	readonly denominator: number;
	/** null when the denominator is 0. */
	readonly rate: number | null;
	readonly threshold: Ratio | null;
	/** null for informational metrics. A 0 denominator never passes. */
	readonly passed: boolean | null;
	readonly failingCaseIds: readonly string[];
}

function metric(
	numerator: number,
	denominator: number,
	threshold: Ratio | null,
	failing: readonly string[],
): RateMetric {
	return {
		numerator,
		denominator,
		rate: denominator === 0 ? null : numerator / denominator,
		threshold,
		passed:
			threshold === null
				? null
				: denominator > 0 &&
					numerator * threshold.denominator >=
						threshold.numerator * denominator,
		failingCaseIds: [...failing].sort(),
	};
}

export interface ScoreReport {
	readonly thresholdVersion: string;
	readonly caseCount: number;
	readonly evaluatedCount: number;
	readonly missingCaseIds: readonly string[];
	readonly duplicateCaseIds: readonly string[];
	readonly unexpectedCaseIds: readonly string[];
	readonly statusCounts: Readonly<Record<SampleStatus, number>>;
	readonly adoptedPrecision: RateMetric;
	readonly holdRecall: RateMetric;
	readonly classificationAccuracy: RateMetric;
	/** Gated: adopt-expected cases adopted correctly over all of them. */
	readonly adoptRecall: RateMetric;
	readonly violations: Readonly<Record<ViolationKind, readonly string[]>>;
	readonly perGroup: Readonly<
		Record<string, { readonly cases: number; readonly passed: number }>
	>;
	readonly thresholdsMet: boolean;
	/** Content-free reasons the thresholds are not met. */
	readonly reasons: readonly string[];
}

const ratio = (m: RateMetric) => `${m.numerator}/${m.denominator}`;

/** Aggregates over ALL expected cases; a missing sample is a failure. */
export function scoreEvaluations(
	cases: readonly EvalCase[],
	evaluations: readonly CaseEvaluation[],
): ScoreReport {
	const byId = new Map<string, CaseEvaluation>();
	const duplicates = new Set<string>();
	for (const e of evaluations) {
		if (byId.has(e.caseId)) duplicates.add(e.caseId);
		byId.set(e.caseId, e);
	}
	const expected = new Set(cases.map((c) => c.caseId));
	const missing = cases.filter((c) => !byId.has(c.caseId)).map((c) => c.caseId);
	const unexpected = [...byId.keys()].filter((id) => !expected.has(id));
	const present = cases.flatMap((c) => {
		const e = byId.get(c.caseId);
		return e ? [e] : [];
	});

	const statusCounts: Record<SampleStatus, number> = {
		ok: 0,
		invalid_output: 0,
		timeout: 0,
		error: 0,
	};
	for (const e of present) statusCounts[e.status] += 1;

	const adopted = present.reduce((n, e) => n + e.accepted, 0);
	const correct = present.reduce((n, e) => n + e.correctAdopted, 0);
	const holdCases = cases.filter((c) => c.gold.outcome === "hold");
	const classCases = cases.filter((c) => goldClassification(c) !== null);
	const adoptCases = cases.filter((c) => c.gold.outcome === "adopt");
	// A case with no sample is a miss for every metric that includes it.
	const miss = (c: EvalCase, pick: (e: CaseEvaluation) => boolean) => {
		const e = byId.get(c.caseId);
		return !e || !pick(e);
	};
	const precision = metric(
		correct,
		adopted,
		thresholds.adoptedPrecision,
		present.filter((e) => e.wrongAdopted > 0).map((e) => e.caseId),
	);
	const hold = metric(
		holdCases.filter((c) => !miss(c, (e) => e.heldCorrectly)).length,
		holdCases.length,
		thresholds.holdRecall,
		holdCases
			.filter((c) => miss(c, (e) => e.heldCorrectly))
			.map((c) => c.caseId),
	);
	const classification = metric(
		classCases.filter((c) => !miss(c, (e) => e.classificationCorrect)).length,
		classCases.length,
		thresholds.classificationAccuracy,
		classCases
			.filter((c) => miss(c, (e) => e.classificationCorrect))
			.map((c) => c.caseId),
	);
	const adoptRecall = metric(
		adoptCases.filter((c) => !miss(c, (e) => e.adoptedCorrectly)).length,
		adoptCases.length,
		thresholds.adoptRecall,
		adoptCases
			.filter((c) => miss(c, (e) => e.adoptedCorrectly))
			.map((c) => c.caseId),
	);

	const violations = Object.fromEntries(
		violationKinds.map((kind) => [
			kind,
			present.filter((e) => e.violations.includes(kind)).map((e) => e.caseId),
		]),
	) as Record<ViolationKind, string[]>;

	const perGroup: Record<string, { cases: number; passed: number }> = {};
	for (const c of cases) {
		const slot = (perGroup[c.group] ??= { cases: 0, passed: 0 });
		slot.cases += 1;
		const e = byId.get(c.caseId);
		if (
			e &&
			(c.gold.outcome === "adopt" ? e.adoptedCorrectly : e.heldCorrectly)
		)
			slot.passed += 1;
	}

	const reasons: string[] = [];
	if (cases.length === 0) reasons.push("no cases");
	if (missing.length > 0) reasons.push(`missing samples: ${missing.length}`);
	if (duplicates.size > 0)
		reasons.push(`duplicate samples: ${duplicates.size}`);
	if (unexpected.length > 0)
		reasons.push(`unexpected samples: ${unexpected.length}`);
	for (const [name, m] of [
		["adoptedPrecision", precision],
		["holdRecall", hold],
		["classificationAccuracy", classification],
		["adoptRecall", adoptRecall],
	] as const)
		if (m.passed !== true)
			reasons.push(
				m.denominator === 0
					? `${name} undefined (denominator 0)`
					: `${name} ${ratio(m)} below ${m.threshold!.numerator}/${m.threshold!.denominator}`,
			);
	for (const kind of violationKinds)
		if (violations[kind].length > 0)
			reasons.push(
				`zero-tolerance ${kind}: ${violations[kind].length} case(s)`,
			);

	return {
		thresholdVersion: THRESHOLD_VERSION,
		caseCount: cases.length,
		evaluatedCount: present.length,
		missingCaseIds: missing,
		duplicateCaseIds: [...duplicates].sort(),
		unexpectedCaseIds: unexpected.sort(),
		statusCounts,
		adoptedPrecision: precision,
		holdRecall: hold,
		classificationAccuracy: classification,
		adoptRecall,
		violations,
		perGroup,
		thresholdsMet: reasons.length === 0,
		reasons,
	};
}

export interface SampleTiming {
	readonly status: SampleStatus;
	readonly latencyMs: number;
	readonly inputBytes: number;
}
export interface PerformanceSummary {
	readonly samples: number;
	readonly latencyP50Ms: number | null;
	readonly latencyP95Ms: number | null;
	readonly timeoutCount: number;
	readonly timeoutRate: number | null;
	readonly failureCount: number;
	readonly inputBytesTotal: number;
	readonly inputBytesMax: number;
}

/** Nearest-rank percentile of a sorted ascending list. */
export function percentile(sorted: readonly number[], p: number) {
	if (sorted.length === 0) return null;
	const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
	return sorted[Math.min(rank, sorted.length) - 1]!;
}

/** Over ALL samples, including timeouts and failures. */
export function summarizePerformance(
	samples: readonly SampleTiming[],
): PerformanceSummary {
	const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
	const timeouts = samples.filter((s) => s.status === "timeout").length;
	return {
		samples: samples.length,
		latencyP50Ms: percentile(latencies, 50),
		latencyP95Ms: percentile(latencies, 95),
		timeoutCount: timeouts,
		timeoutRate: samples.length === 0 ? null : timeouts / samples.length,
		failureCount: samples.filter((s) => s.status !== "ok").length,
		inputBytesTotal: samples.reduce((n, s) => n + s.inputBytes, 0),
		inputBytesMax: samples.reduce((n, s) => Math.max(n, s.inputBytes), 0),
	};
}
