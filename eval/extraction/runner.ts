/**
 * P4-05 runner. One case at a time (concurrency 1) through an injectable
 * provider, then the pure extraction validator, then scoring. The runner never
 * imports a concrete model client and the harness itself never calls cloud: a
 * provider is supplied by the operator/host through main.ts. That the supplied
 * provider is Local is self-declared (`info.kind`) by whoever supplies it and is
 * NOT technically enforced here; Local eligibility is the host's responsibility.
 */
import { createHash, randomUUID } from "node:crypto";
import {
	prepareExtraction,
	validateCandidates,
	type CanonicalHasher,
	type Entity,
} from "../../src/index.ts";
import {
	EVALUATION_VERSION,
	casesOf,
	foreignEntityIds,
	sourceIdOf,
	type Dataset,
	type EvalCase,
	type Split,
} from "./dataset.ts";
import {
	evaluateSample,
	scoreEvaluations,
	summarizePerformance,
	summarizeRawOutput,
	type CaseEvaluation,
	type PerformanceSummary,
	type SampleOutcome,
	type SampleStatus,
	type ScoreReport,
} from "./scoring.ts";

export type ProviderConfig = Readonly<
	Record<string, string | number | boolean>
>;

/**
 * Who produced the outputs. Fixture results are never model results. `local`
 * is a self-declaration of the operator/host that supplied the provider; the
 * harness cannot verify it.
 */
export interface ProviderInfo {
	readonly kind: "fixture" | "local";
	readonly modelId: string;
	readonly modelVersion: string;
	readonly config: ProviderConfig;
}

/**
 * Exactly what the model may see. Gold, the case id, the group and the split
 * never appear in a request.
 */
export interface ProviderRequest {
	/**
	 * Opaque per-run key (salted hash of the call index). It only correlates a
	 * request with its response; the runner alone maps it back to a case. Real
	 * providers must ignore it.
	 */
	readonly requestKey: string;
	readonly window: readonly {
		readonly utteranceId: string;
		readonly text: string;
	}[];
	readonly entities: readonly {
		readonly id: string;
		readonly displayName: string;
		readonly aliases: readonly string[];
	}[];
	readonly predicates: readonly string[];
	readonly timeoutMs: number;
}
export interface ProviderResponse {
	/** Raw model output: a JSON string or an object `{ candidates: [...] }`. */
	readonly output: unknown;
	readonly usage?: {
		readonly inputTokens?: number;
		readonly outputTokens?: number;
	};
}
export interface ExtractionProvider {
	readonly info: ProviderInfo;
	/** False when the backend cannot be reached; the run is then not started. */
	isAvailable?(): Promise<boolean>;
	extract(
		request: ProviderRequest,
		signal: AbortSignal,
	): Promise<ProviderResponse>;
}

export class ProviderTimeoutError extends Error {
	constructor() {
		super("provider timeout");
		this.name = "ProviderTimeoutError";
	}
}
export class ProviderUnavailableError extends Error {
	constructor(message = "provider unavailable") {
		super(message);
		this.name = "ProviderUnavailableError";
	}
}
/**
 * The provider ignored the abort signal and its promise did not settle within
 * the grace period. It is a timeout for the sample, and the runner stops calling
 * the provider (see `RunReport.abandonedProviderCalls`).
 */
export class ProviderAbandonedError extends ProviderTimeoutError {
	constructor() {
		super();
		this.name = "ProviderAbandonedError";
	}
}
export class HoldoutAccessError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HoldoutAccessError";
	}
}

/** "tuning" is the prompt-tuning path: it can only ever see dev cases. */
export type RunMode = "tuning" | "acceptance";

/** The only way to pick cases: tuning mode refuses the holdout split. */
export function selectCases(
	dataset: Dataset,
	split: Split,
	mode: RunMode,
): readonly EvalCase[] {
	if (split === "holdout" && mode === "tuning")
		throw new HoldoutAccessError("holdout is not available for tuning");
	return casesOf(dataset, split);
}

/**
 * Case text for human diagnostics. The holdout text is never emitted, in any
 * mode: it only ever reaches the provider as a request during acceptance.
 */
export function diagnosticCaseText(dataset: Dataset, caseId: string): string {
	const found = dataset.cases.find((c) => c.caseId === caseId);
	if (!found) throw new Error(`unknown case ${caseId}`);
	if (found.split === "holdout")
		throw new HoldoutAccessError("holdout text is never emitted");
	return found.utterances.map((u) => u.text).join("\n");
}

export interface Clock {
	now(): number;
}
export const systemClock: Clock = { now: () => performance.now() };

export interface RunOptions {
	readonly dataset: Dataset;
	readonly provider: ExtractionProvider;
	readonly split: Split;
	readonly mode: RunMode;
	/** Frozen prompt identity, recorded in the report. */
	readonly promptVersion: string;
	readonly timeoutMs?: number;
	/**
	 * After a timeout the runner aborts the call and waits up to this long for
	 * the provider promise to settle before it starts the next case, so that
	 * concurrency stays 1 even for a provider that ignores the abort signal.
	 */
	readonly settleGraceMs?: number;
	/** Salt of the opaque request keys; random per run when omitted. */
	readonly requestKeySalt?: string;
	readonly clock?: Clock;
	readonly hasher?: CanonicalHasher;
}

export interface SampleRecord {
	readonly caseId: string;
	readonly status: SampleStatus;
	readonly latencyMs: number;
	readonly inputBytes: number;
	readonly outputBytes: number | null;
	readonly usage: ProviderResponse["usage"] | null;
	readonly evaluation: CaseEvaluation;
}
export interface RunReport {
	readonly evaluationVersion: string;
	readonly datasetVersion: string;
	readonly split: Split;
	readonly mode: RunMode;
	readonly promptVersion: string;
	readonly provider: ProviderInfo;
	readonly timeoutMs: number;
	readonly score: ScoreReport;
	readonly performance: PerformanceSummary;
	/** Summed over samples that reported it; null when none did. */
	readonly usage: {
		readonly inputTokens: number;
		readonly outputTokens: number;
		readonly samples: number;
	} | null;
	/**
	 * Acceptance needs holdout + acceptance mode + a provider that declares
	 * itself local. The declaration is not verified here.
	 */
	readonly acceptance: {
		readonly eligible: boolean;
		readonly modelAccepted: boolean;
		readonly note: string;
	};
	/**
	 * Provider calls that ignored the abort signal and never settled within the
	 * grace period. After the first one the provider is not called again (that
	 * would run two inferences at once); the remaining cases are recorded as
	 * errors. Any non-zero value means the run is not a clean measurement.
	 */
	readonly abandonedProviderCalls: number;
	readonly samples: readonly SampleRecord[];
}

export const defaultTimeoutMs = 30_000;
export const defaultSettleGraceMs = 5_000;
const encoder = new TextEncoder();
const sha256: CanonicalHasher = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
const recordedAt = 1_791_500_000_000;
export const interpretationVersion = "eval-extract-1";
const assignedSlots = 8;

function buildEntities(dataset: Dataset, tc: EvalCase): Entity[] {
	const scoped =
		(scope: Dataset["scope"]) =>
		(e: Dataset["foreignEntities"][number]): Entity => ({
			id: e.id,
			scope,
			revision: e.revision,
			displayName: e.displayName,
			aliases: e.aliases,
			externalRefs: [],
		});
	return [
		...dataset.entitySets[tc.entitySet].map(scoped(dataset.scope)),
		// Foreign entities go to the validator only, never to the model.
		...dataset.foreignEntities.map(scoped(dataset.foreignScope)),
	];
}

interface Prepared {
	readonly visible: Omit<ProviderRequest, "requestKey" | "timeoutMs">;
	readonly inputBytes: number;
	readonly validationInput: (output: unknown) => unknown;
}

function prepare(
	dataset: Dataset,
	tc: EvalCase,
	hasher: CanonicalHasher,
): Prepared | undefined {
	const states = tc.utterances.map((u) => ({
		namespace: "eval",
		kind: "message",
		id: sourceIdOf(tc.caseId, u.utteranceId),
		revision: "rev-1",
		digest: hasher(encoder.encode(u.text)),
		principal: dataset.scope.principal,
		scopeKey: dataset.scope.scopeKey,
		status: "available",
		content: u.text,
	}));
	const ref = (s: (typeof states)[number]) => ({
		namespace: s.namespace,
		kind: s.kind,
		id: s.id,
		revision: s.revision,
		digest: s.digest,
	});
	const prepared = prepareExtraction(
		{
			contractVersion: 1,
			scope: dataset.scope,
			utterances: tc.utterances.map((u, i) => ({
				utteranceId: u.utteranceId,
				source: ref(states[i]!),
				confirmed: true,
				origin: u.origin,
				rootEvidenceId: `root-${tc.caseId}-${u.utteranceId}`,
			})),
			sources: { states },
		},
		hasher,
	);
	if (
		!prepared.ok ||
		prepared.value.status !== "prepared" ||
		prepared.value.window.length !== tc.utterances.length
	)
		return undefined;
	const visible = {
		window: tc.utterances.map((u) => ({
			utteranceId: u.utteranceId,
			text: u.text,
		})),
		entities: dataset.entitySets[tc.entitySet].map((e) => ({
			id: e.id,
			displayName: e.displayName,
			aliases: e.aliases,
		})),
		predicates: dataset.predicates,
	};
	const window = prepared.value.window;
	const manifest = prepared.value.manifest;
	const entities = buildEntities(dataset, tc);
	return {
		visible,
		inputBytes: encoder.encode(JSON.stringify(visible)).length,
		validationInput: (modelOutput) => ({
			contractVersion: 1,
			scope: dataset.scope,
			window,
			manifest,
			sources: { states },
			entities,
			assigned: {
				recordedAt,
				interpretationVersion,
				freshnessMaxAgeMs: 86_400_000,
				items: Array.from({ length: assignedSlots }, (_, i) => ({
					assertionId: `eval-claim-${i}`,
					evidenceId: `eval-ev-${i}`,
				})),
			},
			modelOutput,
		}),
	};
}

/**
 * Calls the provider with a deadline. On timeout the call is aborted and the
 * provider promise is given `graceMs` to settle, so that the next case never
 * overlaps a call that is still running; a promise that outlives the grace
 * period raises ProviderAbandonedError.
 */
async function callWithTimeout(
	provider: ExtractionProvider,
	request: ProviderRequest,
	timeoutMs: number,
	graceMs: number,
): Promise<ProviderResponse> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let settled = false;
	const call = new Promise<ProviderResponse>((resolve) =>
		resolve(provider.extract(request, controller.signal)),
	);
	const done = call.then(
		() => {
			settled = true;
		},
		() => {
			settled = true;
		},
	);
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(new ProviderTimeoutError());
		}, timeoutMs);
	});
	try {
		return await Promise.race([call, timeout]);
	} catch (error) {
		if (error instanceof ProviderTimeoutError && !settled) {
			let grace: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([
				done,
				new Promise<void>((resolve) => {
					grace = setTimeout(resolve, graceMs);
				}),
			]);
			clearTimeout(grace);
			if (!settled) throw new ProviderAbandonedError();
		}
		throw error;
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

/** Runs the selected split through the provider and scores every case. */
export async function runEvaluation(options: RunOptions): Promise<RunReport> {
	const { dataset, provider, split, mode } = options;
	// Refuses (before any provider call) when tuning would touch the holdout.
	const cases = selectCases(dataset, split, mode);
	if (options.promptVersion.length === 0)
		throw new Error("promptVersion is required");
	const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
	const graceMs = options.settleGraceMs ?? defaultSettleGraceMs;
	const salt = options.requestKeySalt ?? randomUUID();
	const clock = options.clock ?? systemClock;
	const hasher = options.hasher ?? sha256;
	if (provider.isAvailable && !(await provider.isAvailable()))
		throw new ProviderUnavailableError();

	const context = {
		scope: dataset.scope,
		foreignEntityIds: foreignEntityIds(dataset),
	};
	const samples: SampleRecord[] = [];
	let abandoned = 0;
	let index = 0;
	for (const tc of cases) {
		const prepared = prepare(dataset, tc, hasher);
		const started = clock.now();
		let status: SampleStatus = "error";
		let outcome: SampleOutcome = { status: "error" };
		let usage: ProviderResponse["usage"] | null = null;
		let outputBytes: number | null = null;
		// After an abandoned call the provider is not called again: the stuck call
		// may still be running and a second one would break concurrency 1.
		if (prepared && abandoned === 0) {
			// Opaque: the key says nothing of the case, its group or its split.
			const requestKey = hasher(encoder.encode(`${salt}:${index++}`)).slice(
				0,
				16,
			);
			try {
				const response = await callWithTimeout(
					provider,
					{ requestKey, ...prepared.visible, timeoutMs },
					timeoutMs,
					graceMs,
				);
				usage = response.usage ?? null;
				outputBytes =
					typeof response.output === "string"
						? encoder.encode(response.output).length
						: encoder.encode(JSON.stringify(response.output) ?? "").length;
				const validated = validateCandidates(
					prepared.validationInput(response.output),
					hasher,
				);
				if (!validated.ok) outcome = { status: "error" };
				else if (validated.value.status === "rejected") {
					const bad = validated.value.reasonCode === "MALFORMED_OUTPUT";
					outcome = bad
						? { status: "invalid_output" }
						: {
								status: "ok",
								validation: validated.value,
								raw: summarizeRawOutput(response.output),
							};
				} else
					outcome = {
						status: "ok",
						validation: validated.value,
						raw: summarizeRawOutput(response.output),
					};
			} catch (error) {
				if (error instanceof ProviderAbandonedError) abandoned += 1;
				outcome = {
					status: error instanceof ProviderTimeoutError ? "timeout" : "error",
				};
			}
		}
		status = outcome.status;
		const latencyMs = Math.max(0, clock.now() - started);
		samples.push({
			caseId: tc.caseId,
			status,
			latencyMs,
			inputBytes: prepared?.inputBytes ?? 0,
			outputBytes,
			usage,
			evaluation: evaluateSample(tc, outcome, context),
		});
	}

	const score = scoreEvaluations(
		cases,
		samples.map((s) => s.evaluation),
	);
	const reported = samples.filter((s) => s.usage !== null);
	const eligible =
		split === "holdout" &&
		mode === "acceptance" &&
		provider.info.kind === "local";
	const modelAccepted = eligible && score.thresholdsMet;
	return {
		evaluationVersion: EVALUATION_VERSION,
		datasetVersion: dataset.version,
		split,
		mode,
		promptVersion: options.promptVersion,
		provider: provider.info,
		timeoutMs,
		score,
		performance: summarizePerformance(samples),
		usage:
			reported.length === 0
				? null
				: {
						inputTokens: reported.reduce(
							(n, s) => n + (s.usage?.inputTokens ?? 0),
							0,
						),
						outputTokens: reported.reduce(
							(n, s) => n + (s.usage?.outputTokens ?? 0),
							0,
						),
						samples: reported.length,
					},
		acceptance: {
			eligible,
			modelAccepted,
			note: modelAccepted
				? "initial thresholds met on the holdout with a provider declared local (self-declared, not verified by the harness)"
				: eligible
					? "not accepted: thresholds not met"
					: "not an acceptance run (needs holdout + acceptance mode + a provider declared local)",
		},
		abandonedProviderCalls: abandoned,
		samples,
	};
}
