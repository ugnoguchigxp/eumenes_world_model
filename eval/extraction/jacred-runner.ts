/**
 * E01 runner for the JacRED suite (jacred-ja-v1): one provider call per
 * case (first generation only), a local parse of the raw output down to
 * relation predictions, then the pure scoring of jacred-scoring.ts. Unlike
 * the A46 runner there is no validator, holdout discipline or acceptance
 * here: this suite is an external-validity diagnostic, and its report is
 * never an acceptance result.
 */
import { createHash } from "node:crypto";
import type {
	JacredCase,
	JacredSuite,
	JacredUnsupportedCounts,
} from "./jacred.ts";
import {
	aggregateJacredScores,
	scoreJacredCase,
	type JacredCaseScore,
	type JacredPrediction,
	type JacredTotals,
} from "./jacred-scoring.ts";
import {
	ProviderTimeoutError,
	defaultTimeoutMs,
	type ExtractionProvider,
	type ProviderInfo,
	type ProviderRequest,
} from "./runner.ts";

export type JacredCaseStatus = "ok" | "invalid_output" | "error";

export interface JacredCaseReport {
	readonly caseId: string;
	readonly upstreamIndex: number;
	readonly status: JacredCaseStatus;
	readonly predictions: readonly JacredPrediction[];
	/** Candidates that were not usable relation predictions. */
	readonly ignoredNonRelation: number;
	readonly score: JacredCaseScore;
	/** Passthrough from the case: unrepresentable gold, never a failure. */
	readonly unsupported: JacredUnsupportedCounts;
}

export interface JacredRunReport {
	readonly suiteId: string;
	readonly split: string;
	readonly condition: string;
	readonly textJoinRule: string;
	readonly upstreamSha256: string;
	readonly provider: ProviderInfo;
	/** ISO timestamp from the injected clock (or the wall clock). */
	readonly generatedAt: string;
	readonly timeoutMs: number;
	readonly totals: JacredTotals;
	readonly cases: readonly JacredCaseReport[];
}

export interface JacredRunOptions {
	readonly timeoutMs?: number;
	/** Clock injection for `generatedAt`; defaults to `() => new Date()`. */
	readonly now?: () => Date;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

type EntityRef =
	| { readonly kind: "id"; readonly id: string }
	| { readonly kind: "alias"; readonly text: string };

function entityRefOf(value: unknown): EntityRef | undefined {
	if (!isRecord(value)) return undefined;
	if (value.kind === "id" && typeof value.id === "string")
		return { kind: "id", id: value.id };
	if (value.kind === "alias" && typeof value.text === "string")
		return { kind: "alias", text: value.text };
	return undefined;
}

/**
 * Resolves a model entity reference to an entity id. An alias that matches
 * a supplied displayName/alias resolves to that entity; an unresolved
 * alias keeps its raw text as the id, so scoring counts it as an invalid
 * prediction (unknown id) instead of the parse dropping it silently.
 */
function resolveEntityRef(ref: EntityRef, tc: JacredCase): string {
	if (ref.kind === "id") return ref.id;
	const found = tc.entities.find(
		(e) => e.displayName === ref.text || e.aliases.includes(ref.text),
	);
	return found?.id ?? ref.text;
}

interface ParsedOutput {
	readonly predictions: readonly JacredPrediction[];
	readonly ignoredNonRelation: number;
}

/** Parses raw model output; undefined means the output is malformed. */
function parseOutput(
	output: unknown,
	tc: JacredCase,
): ParsedOutput | undefined {
	let parsed: unknown = output;
	if (typeof output === "string") {
		try {
			parsed = JSON.parse(output);
		} catch {
			return undefined;
		}
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.candidates)) return undefined;
	const predictions: JacredPrediction[] = [];
	let ignoredNonRelation = 0;
	for (const candidate of parsed.candidates) {
		if (!isRecord(candidate) || !isRecord(candidate.payload)) {
			ignoredNonRelation += 1;
			continue;
		}
		const payload = candidate.payload;
		if (payload.kind !== "relation" || typeof payload.relation !== "string") {
			ignoredNonRelation += 1;
			continue;
		}
		const subject = entityRefOf(candidate.subject);
		const object = entityRefOf(payload.object);
		if (subject === undefined || object === undefined) {
			ignoredNonRelation += 1;
			continue;
		}
		const quote = candidate.quote;
		predictions.push({
			subjectId: resolveEntityRef(subject, tc),
			relation: payload.relation,
			objectId: resolveEntityRef(object, tc),
			quoteUtteranceId:
				isRecord(quote) && typeof quote.utteranceId === "string"
					? quote.utteranceId
					: null,
		});
	}
	return { predictions, ignoredNonRelation };
}

async function callProvider(
	provider: ExtractionProvider,
	request: ProviderRequest,
	timeoutMs: number,
): Promise<unknown> {
	const controller = new AbortController();
	// If the call settles after the timeout wins the race, its rejection
	// must not surface as an unhandled rejection.
	const call = Promise.resolve().then(() =>
		provider.extract(request, controller.signal),
	);
	call.catch(() => {});
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(new ProviderTimeoutError());
		}, timeoutMs);
	});
	try {
		const response = await Promise.race([call, timeout]);
		return response.output;
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

/** Runs every case of the suite through the provider and scores them. */
export async function runJacredSuite(
	suite: JacredSuite,
	provider: ExtractionProvider,
	options: JacredRunOptions = {},
): Promise<JacredRunReport> {
	const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
	const now = options.now ?? (() => new Date());
	const relationCodes = new Set(suite.predicates.map((p) => p.code));
	const reports: JacredCaseReport[] = [];
	for (const tc of suite.cases) {
		const request: ProviderRequest = {
			requestKey: createHash("sha256")
				.update(`${suite.suiteId}:${tc.caseId}`)
				.digest("hex")
				.slice(0, 16),
			window: tc.utterances.map((u) => ({
				utteranceId: u.utteranceId,
				text: u.text,
			})),
			entities: tc.entities.map((e) => ({
				id: e.id,
				displayName: e.displayName,
				aliases: e.aliases,
			})),
			predicates: suite.predicates.map((p) => p.code),
			timeoutMs,
		};
		let status: JacredCaseStatus = "error";
		let predictions: readonly JacredPrediction[] = [];
		let ignoredNonRelation = 0;
		try {
			const output = await callProvider(provider, request, timeoutMs);
			const parsed = parseOutput(output, tc);
			if (parsed === undefined) {
				status = "invalid_output";
			} else {
				status = "ok";
				predictions = parsed.predictions;
				ignoredNonRelation = parsed.ignoredNonRelation;
			}
		} catch {
			status = "error";
		}
		reports.push({
			caseId: tc.caseId,
			upstreamIndex: tc.upstreamIndex,
			status,
			predictions,
			ignoredNonRelation,
			score: scoreJacredCase({
				gold: tc.gold,
				predictions,
				entityIds: new Set(tc.entities.map((e) => e.id)),
				relationCodes,
			}),
			unsupported: tc.unsupported,
		});
	}
	const { totals } = aggregateJacredScores(reports.map((r) => r.score));
	return {
		suiteId: suite.suiteId,
		split: suite.split,
		condition: suite.condition,
		textJoinRule: suite.textJoinRule,
		upstreamSha256: suite.upstreamSha256,
		provider: provider.info,
		generatedAt: now().toISOString(),
		timeoutMs,
		totals,
		cases: reports,
	};
}
