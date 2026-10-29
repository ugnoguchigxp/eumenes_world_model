/**
 * P4-05.b: an OpenAI-compatible chat-completions provider for the
 * extraction harness, used for the Local run and for the Luna contrast
 * (kind "remote"). The class only speaks the wire protocol: it sends the
 * visible request (window, entities, predicates) with the frozen
 * instruction below and returns the message content verbatim as the model
 * output. Whether the content is valid is the validator's job, never this
 * class's.
 *
 * The endpoint is always supplied by the operator; nothing here defaults
 * to an external service. A "remote" provider is a contrast measurement
 * only: acceptance eligibility stays local-only in the runner.
 */
import {
	ProviderUnavailableError,
	type ExtractionProvider,
	type ProviderInfo,
	type ProviderRequest,
	type ProviderResponse,
} from "./runner.ts";

/** Frozen instruction identity; any wording change is a new version. */
export const EXTRACTION_INSTRUCTION_VERSION = "eval-extract-instruction-2";
export const EXTRACTION_INSTRUCTION = [
	"You extract candidate claims from a window of utterances.",
	'Answer with one JSON object of the form {"candidates": [...]} and',
	"nothing else. Each candidate is an object with:",
	'- subject: {"kind": "id", "id": <one of the given entity ids>}, or',
	'  {"kind": "alias", "text": <a name as written>} when no id fits;',
	"- predicate: one of the given predicates;",
	'- payload: {"kind": "value", "value": <typed value>} or',
	'  {"kind": "relation", "relation": <name>, "object":',
	'  {"kind": "id", "id": <entity id>}};',
	'- quote: {"utteranceId": <id>, "startByte": <n>, "endByte": <n>},',
	"  the UTF-8 byte range of the supporting sentence;",
	'- modality: one of "asserted", "reported", "hypothetical",',
	'  "negated", "question".',
	"Use only the given entities and predicates. When the subject cannot",
	"be resolved to a given entity, or a claim is negated, hypothetical or",
	"a question, still report it with the matching modality instead of",
	"dropping it or guessing an entity.",
	"Conventions (v2, from the agent-model contrast runs in progress.md):",
	"- Corrections: when a later utterance corrects an earlier claim about",
	"  the same subject and predicate, report ONLY the final corrected",
	'  claim, once, as "asserted" with the corrected value; never report',
	"  the superseded claim. A correction that flips a boolean is an",
	"  asserted claim whose payload carries the final boolean value, not",
	'  modality "negated". Values are always the final values.',
	"- Quote span: the byte range of the minimal span that itself states",
	"  the claim, starting at the claim's subject. Exclude discourse",
	"  lead-ins and framing clauses (e.g. 確認したところ、 / メモとして、 /",
	"  すみません、 / 訂正です。) from the span.",
].join("\n");

/** The fetch shape this provider needs (the global fetch satisfies it). */
export type FetchImpl = (
	input: string,
	init: {
		readonly method: string;
		readonly headers: Readonly<Record<string, string>>;
		readonly body: string;
		readonly signal: AbortSignal;
	},
) => Promise<{
	readonly ok: boolean;
	readonly status: number;
	json(): Promise<unknown>;
}>;

export interface ChatCompletionsProviderOptions {
	/** Full chat-completions endpoint URL, supplied by the operator. */
	readonly endpoint: string;
	readonly modelId: string;
	readonly modelVersion: string;
	/** "local" for the acceptance candidate, "remote" for a contrast. */
	readonly kind: "local" | "remote";
	/** Defaults to the global fetch; tests inject a fake. */
	readonly fetchImpl?: FetchImpl;
	readonly apiKey?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** An ExtractionProvider over an OpenAI-compatible chat endpoint. */
export class ChatCompletionsProvider implements ExtractionProvider {
	readonly info: ProviderInfo;
	private readonly endpoint: string;
	private readonly fetchImpl: FetchImpl;
	private readonly apiKey: string | undefined;

	constructor(options: ChatCompletionsProviderOptions) {
		this.endpoint = options.endpoint;
		this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchImpl);
		this.apiKey = options.apiKey;
		this.info = {
			kind: options.kind,
			modelId: options.modelId,
			modelVersion: options.modelVersion,
			config: {
				instructionVersion: EXTRACTION_INSTRUCTION_VERSION,
				temperature: 0,
			},
		};
	}

	async extract(
		request: ProviderRequest,
		signal: AbortSignal,
	): Promise<ProviderResponse> {
		const body = JSON.stringify({
			model: this.info.modelId,
			temperature: 0,
			messages: [
				{ role: "system", content: EXTRACTION_INSTRUCTION },
				{
					role: "user",
					content: JSON.stringify({
						window: request.window,
						entities: request.entities,
						predicates: request.predicates,
					}),
				},
			],
		});
		let response: Awaited<ReturnType<FetchImpl>>;
		try {
			response = await this.fetchImpl(this.endpoint, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
				},
				body,
				signal,
			});
		} catch (error) {
			// An abort is the runner's timeout machinery at work: it must
			// propagate unchanged, never become an availability failure.
			if (signal.aborted) throw error;
			throw new ProviderUnavailableError(
				"chat completions endpoint unreachable",
			);
		}
		if (!response.ok)
			throw new ProviderUnavailableError(
				`chat completions endpoint returned ${response.status}`,
			);
		let parsed: unknown;
		try {
			parsed = await response.json();
		} catch {
			throw new ProviderUnavailableError(
				"chat completions response was not JSON",
			);
		}
		const choices = isRecord(parsed) ? parsed["choices"] : undefined;
		const first = Array.isArray(choices) ? choices[0] : undefined;
		const message = isRecord(first) ? first["message"] : undefined;
		const content = isRecord(message) ? message["content"] : undefined;
		if (typeof content !== "string")
			throw new ProviderUnavailableError(
				"chat completions response has no message content",
			);
		const usage = isRecord(parsed) ? parsed["usage"] : undefined;
		const tokens = (v: unknown) =>
			typeof v === "number" && Number.isFinite(v) ? v : undefined;
		const inputTokens = isRecord(usage)
			? tokens(usage["prompt_tokens"])
			: undefined;
		const outputTokens = isRecord(usage)
			? tokens(usage["completion_tokens"])
			: undefined;
		return {
			// Verbatim: the raw JSON string is a valid ProviderResponse
			// output; the validator decides whether it is usable.
			output: content,
			...(inputTokens !== undefined || outputTokens !== undefined
				? {
						usage: {
							...(inputTokens !== undefined ? { inputTokens } : {}),
							...(outputTokens !== undefined ? { outputTokens } : {}),
						},
					}
				: {}),
		};
	}
}
