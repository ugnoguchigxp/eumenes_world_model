/**
 * Local-model provider (Ollama-compatible /api/chat). Imported only by
 * main.ts. The harness itself connects only to loopback hostnames
 * (localhost, 127.0.0.1, ::1) and never follows redirects. That is a hostname
 * check and nothing more: it cannot see what the server on that address does
 * (a local Ollama can forward to a cloud-hosted model). Choosing a genuinely
 * local model is the operator's responsibility; model names that look like
 * cloud variants are refused only as a heuristic.
 * The prompt never mentions the condition, the rubric or the task split.
 */
import { renderItem } from "./context.ts";
import type { Provider, ProviderOutput, ProviderRequest } from "./types.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopbackEndpoint(endpoint: string): boolean {
	try {
		const url = new URL(endpoint);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			LOOPBACK.has(url.hostname)
		);
	} catch {
		return false;
	}
}

/** Heuristic only: Ollama names cloud variants "<model>:cloud" / "-cloud". */
export function looksLikeCloudModel(model: string): boolean {
	return /(^|[:/_-])cloud$/i.test(model.trim());
}

/** Output cap sent as num_predict and reserved inside num_ctx. */
export const NUM_PREDICT = 768;
/**
 * Conservative prompt-size estimate. Japanese is about 1 token per character
 * and often more for rare kanji; 1.5 plus a fixed template allowance keeps
 * num_ctx above the real prompt. The real prompt_eval_count is still checked.
 */
const TOKENS_PER_CHAR = 1.5;
const TEMPLATE_TOKENS = 512;
const CTX_STEP = 1024;
export const MIN_NUM_CTX = 4096;
export const MAX_NUM_CTX = 32_768;

export interface ContextPlan {
	readonly estimatedPromptTokens: number;
	readonly numCtx: number;
}

/** Sizes num_ctx from the whole message text (instructions included). */
export function planContext(messages: readonly Message[]): ContextPlan {
	const chars = messages.reduce((n, m) => n + [...m.content].length, 0);
	const estimatedPromptTokens =
		Math.ceil(chars * TOKENS_PER_CHAR) + TEMPLATE_TOKENS;
	const needed = estimatedPromptTokens + NUM_PREDICT;
	const numCtx = Math.max(MIN_NUM_CTX, Math.ceil(needed / CTX_STEP) * CTX_STEP);
	if (numCtx > MAX_NUM_CTX) {
		throw new Error(
			`prompt too large: estimated ${estimatedPromptTokens} tokens needs num_ctx ${numCtx} > ${MAX_NUM_CTX}`,
		);
	}
	return { estimatedPromptTokens, numCtx };
}

export interface Message {
	readonly role: "user" | "assistant";
	readonly content: string;
}

export const CORRECTION_MESSAGE =
	'直前の出力は指定のJSON形式として解析できませんでした。説明や前置きを付けず、次のJSONだけを出力し直してください: {"answer": 文字列, "citations": 引用した資料IDの配列, "hold": true または false}';
export const MAX_CORRECTIONS = 1;

export function buildPrompt(request: ProviderRequest): string {
	return [
		"次の資料だけを根拠に質問へ日本語で答えてください。",
		"資料にない事柄は断定せず、条件が確認できないときは保留してください。",
		'出力は次のJSONのみ: {"answer": 文字列, "citations": 引用した資料IDの配列, "hold": 保留するなら true}',
		"",
		`Scope: ${request.scope}`,
		"",
		"資料:",
		...request.context.map(renderItem),
		"",
		`質問: ${request.question}`,
	].join("\n");
}

export interface ParsedAnswer {
	readonly text: string;
	readonly citations: readonly string[];
	readonly hold: boolean;
}

export function parseModelJson(content: string): ParsedAnswer | null {
	const start = content.indexOf("{");
	const end = content.lastIndexOf("}");
	if (start < 0 || end < start) return null;
	try {
		const value = JSON.parse(content.slice(start, end + 1)) as Record<
			string,
			unknown
		>;
		const answer = value["answer"];
		const citations = value["citations"];
		const hold = value["hold"];
		if (
			typeof answer !== "string" ||
			!Array.isArray(citations) ||
			!citations.every((c) => typeof c === "string") ||
			typeof hold !== "boolean"
		) {
			return null;
		}
		return { text: answer, citations: citations as string[], hold };
	} catch {
		return null;
	}
}

export interface OllamaOptions {
	readonly endpoint: string;
	readonly model: string;
	readonly fetch: FetchLike;
	readonly timeoutMs?: number;
}

export function createOllamaProvider(options: OllamaOptions): Provider {
	if (!isLoopbackEndpoint(options.endpoint)) {
		throw new Error("non-local endpoint rejected");
	}
	const base = options.endpoint.replace(/\/+$/, "");
	const timeout = options.timeoutMs ?? 120_000;
	return {
		id: "ollama",
		kind: "real",
		model: options.model,
		async complete(request: ProviderRequest): Promise<ProviderOutput> {
			const messages: Message[] = [
				{ role: "user", content: buildPrompt(request) },
			];
			let inputTokens = 0;
			let outputTokens = 0;
			for (let attempt = 0; attempt <= MAX_CORRECTIONS; attempt += 1) {
				const plan = planContext(messages);
				const response = await options.fetch(`${base}/api/chat`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					redirect: "error",
					signal: AbortSignal.timeout(timeout),
					body: JSON.stringify({
						model: options.model,
						stream: false,
						format: "json",
						messages,
						options: {
							seed: request.settings.seed,
							temperature: request.settings.temperature,
							num_ctx: plan.numCtx,
							num_predict: NUM_PREDICT,
						},
					}),
				});
				if (!response.ok) throw new Error(`provider http ${response.status}`);
				const body = (await response.json()) as {
					message?: { content?: string };
					prompt_eval_count?: number;
					eval_count?: number;
				};
				const promptTokens = body.prompt_eval_count;
				// Ollama silently truncates the prompt to num_ctx. If the measured
				// prompt leaves no room for the answer, the cell is incomplete.
				if (
					promptTokens !== undefined &&
					promptTokens + NUM_PREDICT > plan.numCtx
				) {
					throw new Error(
						`context truncated: prompt_eval_count ${promptTokens} + num_predict ${NUM_PREDICT} exceeds num_ctx ${plan.numCtx}`,
					);
				}
				inputTokens += promptTokens ?? plan.estimatedPromptTokens;
				outputTokens += body.eval_count ?? 0;
				const content = body.message?.content ?? "";
				const parsed = parseModelJson(content);
				if (parsed !== null) {
					return {
						text: parsed.text,
						citations: parsed.citations,
						hold: parsed.hold,
						corrections: attempt,
						inputTokens,
						outputTokens,
					};
				}
				// A new request: the invalid reply and a corrective instruction are
				// appended, so the retry is not an identical seeded request.
				messages.push(
					{ role: "assistant", content },
					{ role: "user", content: CORRECTION_MESSAGE },
				);
			}
			throw new Error(
				`model output was not valid JSON after ${MAX_CORRECTIONS} correction(s)`,
			);
		},
	};
}

/** Returns true only if the local server answers and lists the model. */
export async function isProviderAvailable(
	options: OllamaOptions,
): Promise<boolean> {
	if (!isLoopbackEndpoint(options.endpoint)) return false;
	try {
		const response = await options.fetch(
			`${options.endpoint.replace(/\/+$/, "")}/api/tags`,
			{
				redirect: "error",
				signal: AbortSignal.timeout(options.timeoutMs ?? 3_000),
			},
		);
		if (!response.ok) return false;
		const body = (await response.json()) as {
			models?: { name?: string; model?: string }[];
		};
		return (body.models ?? []).some(
			(m) => m.name === options.model || m.model === options.model,
		);
	} catch {
		return false;
	}
}
