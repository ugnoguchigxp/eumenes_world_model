/**
 * Deterministic fixture providers for verifying the runner and the scorer.
 * They are NOT models: "oracle" replays the gold, the degraded variants are
 * mutations of it. Their results prove the harness, never model quality.
 *
 * A request carries no case id (only an opaque per-run key), so a fixture
 * finds its case by the visible window text. This is fixture-only: it reads
 * the gold, which a real provider never can.
 */
import {
	cpToByte,
	foreignEntityIds,
	type Dataset,
	type EvalCase,
	type GoldCandidate,
	type ModelModality,
	type SubjectQuery,
} from "./dataset.ts";
import {
	ProviderTimeoutError,
	type Clock,
	type ExtractionProvider,
	type ProviderInfo,
	type ProviderRequest,
	type ProviderResponse,
} from "./runner.ts";

export const fixtureVariants = [
	"oracle",
	"overconfident",
	"scope-leak",
	"bad-quote",
	"resurrection",
	"timeouts",
	"malformed",
] as const;
export type FixtureVariant = (typeof fixtureVariants)[number];

/** A clock the fixture can advance, so latency percentiles are exact. */
export class ManualClock implements Clock {
	private current = 0;
	now(): number {
		return this.current;
	}
	advance(ms: number): void {
		this.current += ms;
	}
}

/** Maps a request back to its case by the text the model would see. */
export function createCaseResolver(
	dataset: Dataset,
): (request: Pick<ProviderRequest, "window">) => EvalCase | undefined {
	const keyOf = (window: ProviderRequest["window"]) =>
		JSON.stringify(window.map((w) => [w.utteranceId, w.text]));
	const byWindow = new Map<string, EvalCase>();
	for (const tc of dataset.cases) {
		const key = keyOf(tc.utterances);
		if (!byWindow.has(key)) byWindow.set(key, tc);
	}
	return (request) => byWindow.get(keyOf(request.window));
}

export interface FixtureOptions {
	readonly clock?: ManualClock;
	/** Simulated latency per call index. Needs `clock` to be visible. */
	readonly latencyMs?: (index: number) => number;
}

const defaultLatency = (index: number) => 100 + ((index * 37) % 400);

export interface WireCandidate {
	readonly subject: unknown;
	readonly predicate: string;
	readonly payload: unknown;
	readonly quote: {
		readonly utteranceId: string;
		readonly startByte: number;
		readonly endByte: number;
	};
	readonly modality: ModelModality;
	readonly condition?: unknown;
	readonly validTime?: unknown;
}

export function wireCandidate(
	tc: EvalCase,
	candidate: GoldCandidate,
	modality: ModelModality,
	subject: SubjectQuery = candidate.subject,
): WireCandidate {
	const text = tc.utterances.find(
		(u) => u.utteranceId === candidate.quote.utteranceId,
	)!.text;
	const validTime = candidate.validTime && {
		kind: "period",
		precision: candidate.validTime.precision,
		original: candidate.validTime.original,
		...(candidate.validTime.start ? { start: candidate.validTime.start } : {}),
		...(candidate.validTime.end ? { end: candidate.validTime.end } : {}),
	};
	return {
		subject,
		predicate: candidate.predicate,
		payload: candidate.payload,
		quote: {
			utteranceId: candidate.quote.utteranceId,
			startByte: cpToByte(text, candidate.quote.startCp),
			endByte: cpToByte(text, candidate.quote.endCp),
		},
		modality,
		...(candidate.condition.kind === "expression"
			? { condition: candidate.condition }
			: {}),
		...(validTime ? { validTime } : {}),
	};
}

/** A candidate per gold reference entry, optionally mutated. */
export function referenceCandidates(tc: EvalCase): WireCandidate[] {
	return tc.gold.reference.map((r) =>
		wireCandidate(tc, r.candidate, r.modality),
	);
}

/** An alias subject becomes the first matching id: ambiguity guessed away. */
function guessSubject(tc: EvalCase, dataset: Dataset, q: SubjectQuery) {
	if (q.kind === "id") return q;
	const hit = dataset.entitySets[tc.entitySet].find((e) =>
		e.aliases.includes(q.text),
	);
	return hit ? ({ kind: "id", id: hit.id } as const) : q;
}

function produce(
	variant: FixtureVariant,
	tc: EvalCase,
	dataset: Dataset,
): unknown {
	if (variant === "malformed") return "{not json";
	if (variant === "oracle" || variant === "timeouts")
		return { candidates: referenceCandidates(tc) };
	if (variant === "overconfident") {
		// Every claim is asserted fact; ambiguous names are guessed.
		const list = tc.gold.reference.map((r) =>
			wireCandidate(
				tc,
				r.candidate,
				"asserted",
				guessSubject(tc, dataset, r.candidate.subject),
			),
		);
		if (
			tc.gold.outcome === "hold" &&
			tc.gold.reason === "forgotten" &&
			tc.forgotten
		)
			list.push(wireCandidate(tc, tc.forgotten.claim, "asserted"));
		return { candidates: list };
	}
	if (variant === "scope-leak") {
		const base = referenceCandidates(tc);
		const foreign = foreignEntityIds(dataset)[0]!;
		const first = base[0];
		return {
			candidates: first
				? [{ ...first, subject: { kind: "id", id: foreign } }, ...base.slice(1)]
				: [],
		};
	}
	if (variant === "bad-quote") {
		return {
			candidates: referenceCandidates(tc).map((c) => ({
				...c,
				quote: { ...c.quote, startByte: 0, endByte: 100_000 },
			})),
		};
	}
	// resurrection: the forgotten claim is extracted despite the request.
	return {
		candidates: tc.forgotten
			? [wireCandidate(tc, tc.forgotten.claim, "asserted")]
			: referenceCandidates(tc),
	};
}

export function createFixtureProvider(
	dataset: Dataset,
	variant: FixtureVariant,
	options: FixtureOptions = {},
): ExtractionProvider {
	const resolve = createCaseResolver(dataset);
	const latency = options.latencyMs ?? defaultLatency;
	let calls = 0;
	const info: ProviderInfo = {
		kind: "fixture",
		modelId: `fixture-${variant}`,
		modelVersion: "1",
		config: { deterministic: true, variant },
	};
	return {
		info,
		extract(request: ProviderRequest): Promise<ProviderResponse> {
			const index = calls++;
			const tc = resolve(request);
			if (!tc) return Promise.reject(new Error("unknown fixture case"));
			if (variant === "timeouts" && index % 4 === 3) {
				options.clock?.advance(request.timeoutMs);
				return Promise.reject(new ProviderTimeoutError());
			}
			options.clock?.advance(latency(index));
			return Promise.resolve({
				output: produce(variant, tc, dataset),
				usage: { inputTokens: 50, outputTokens: 20 },
			});
		},
	};
}
