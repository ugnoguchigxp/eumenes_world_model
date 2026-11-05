/** Direct evaluation-only APIs. No SDK retries, tools, inherited sessions or .env. */
import {
	appendFileSync,
	closeSync,
	existsSync,
	fsyncSync,
	openSync,
	readFileSync,
	unlinkSync,
} from "node:fs";
export type ApiFetch = (url: string, init: RequestInit) => Promise<Response>;
export type ApiService = "claude" | "openai";
export type ApiEffort = "medium" | "high";
export const apiModels = {
	claude: "claude-haiku-5-5",
	openai: "gpt-6-luna",
} as const;
const NANO = 1_000_000_000;
export class ApiBudget {
	private readonly lock: number;
	private reserved = new Map<number, number>();
	private charged = 0;
	private sequence = 0;
	private closed = false;
	private unsafeReservation = false;
	constructor(
		readonly path: string,
		readonly limitUsd = 10,
	) {
		if (!Number.isFinite(limitUsd) || limitUsd <= 0 || limitUsd > 10)
			throw new Error("API budget must be within (0,10] USD");
		this.lock = openSync(`${path}.lock`, "wx");
		try {
			if (existsSync(path))
				for (const line of readFileSync(path, "utf8")
					.trim()
					.split("\n")
					.filter(Boolean)) {
					const e = JSON.parse(line) as {
						type: string;
						id: number;
						reserveNano: number;
						chargeNano: number;
					};
					if (e.type === "reserve") {
						if (
							!Number.isSafeInteger(e.id) ||
							e.id !== this.sequence + 1 ||
							!Number.isSafeInteger(e.reserveNano) ||
							e.reserveNano < 0 ||
							this.reserved.has(e.id)
						)
							throw new Error("invalid budget journal");
						this.sequence = Math.max(this.sequence, e.id);
						this.reserved.set(e.id, e.reserveNano);
					} else if (e.type === "settle") {
						const held = this.reserved.get(e.id);
						if (
							held === undefined ||
							!Number.isSafeInteger(e.chargeNano) ||
							e.chargeNano < 0
						)
							throw new Error("invalid budget settlement");
						this.reserved.delete(e.id);
						this.charged += e.chargeNano;
						if (e.chargeNano > held) this.unsafeReservation = true;
					} else throw new Error("unknown budget event");
				}
		} catch (error) {
			closeSync(this.lock);
			unlinkSync(`${path}.lock`);
			throw error;
		}
	}
	private append(event: unknown) {
		const fd = openSync(this.path, "a");
		try {
			appendFileSync(fd, `${JSON.stringify(event)}\n`);
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
	}
	get summary() {
		const pending = [...this.reserved.values()].reduce((a, b) => a + b, 0);
		return {
			limitUsd: this.limitUsd,
			chargedUpperBoundUsd: this.charged / NANO,
			pendingUpperBoundUsd: pending / NANO,
			totalUpperBoundUsd: (pending + this.charged) / NANO,
			requests: this.sequence,
		};
	}
	reserve(service: ApiService, bodyBytes: number, maxOutput: number) {
		if (this.closed) throw new Error("API budget closed");
		if (this.unsafeReservation)
			throw new Error("API_BUDGET_UNSAFE_RESERVATION");
		if (
			!Number.isSafeInteger(bodyBytes) ||
			bodyBytes < 0 ||
			!Number.isSafeInteger(maxOutput) ||
			maxOutput < 1 ||
			maxOutput > 8192
		)
			throw new Error("invalid request budget");
		// Tokens cannot outnumber UTF-8 bytes in the text; include 8192 tokens of protocol/schema slack.
		// Reserve the highest short-input cache-write rate ($.25/M), not the cheaper base input rate.
		const reserveNano = (bodyBytes + 8192) * 250 + maxOutput * 600;
		if (
			this.charged +
				[...this.reserved.values()].reduce((a, b) => a + b, 0) +
				reserveNano >
				Math.floor(this.limitUsd * NANO) ||
			this.sequence >= 12000
		)
			throw new Error("API_BUDGET_EXHAUSTED");
		const id = this.sequence + 1;
		this.append({
			type: "reserve",
			id,
			service,
			model: apiModels[service],
			reserveNano,
			at: new Date().toISOString(),
		});
		this.sequence = id;
		this.reserved.set(id, reserveNano);
		return id;
	}
	settle(
		id: number,
		input: number,
		output: number,
		receipt?: { model: unknown; requestId: string | null },
		cacheCreationInput?: number,
	) {
		if (this.closed) throw new Error("API budget closed");
		if (
			!Number.isSafeInteger(input) ||
			input < 0 ||
			!Number.isSafeInteger(output) ||
			output < 0
		)
			throw new Error("invalid API usage");
		const held = this.reserved.get(id);
		if (held === undefined) throw new Error("missing reservation");
		if (
			cacheCreationInput !== undefined &&
			(!Number.isSafeInteger(cacheCreationInput) ||
				cacheCreationInput < 0 ||
				cacheCreationInput > input ||
				input > 100000)
		)
			throw new Error("unsupported API billing usage");
		// Preserve old journal charges. New known short-context usage uses
		// $.15/M ordinary/read input, $.25/M cache writes and $.60/M output:
		// each exceeds the verified Standard prices, including a regional margin.
		const chargeNano =
			cacheCreationInput === undefined
				? input * 250 + output * 500
				: input * 150 + cacheCreationInput * 100 + output * 600;
		// A success without durable usage is not a settled request. Never drop an uncertain reservation.
		this.append({
			type: "settle",
			id,
			inputTokens: input,
			outputTokens: output,
			chargeNano,
			...(cacheCreationInput === undefined
				? {}
				: { costPolicy: "short-standard-buffered/2", cacheCreationInput }),
			...(receipt ? { receipt } : {}),
		});
		this.reserved.delete(id);
		this.charged += chargeNano;
		if (chargeNano > held) {
			this.unsafeReservation = true;
			throw new Error("API_USAGE_EXCEEDED_RESERVATION");
		}
	}
	close() {
		if (this.closed) return;
		this.closed = true;
		closeSync(this.lock);
		unlinkSync(`${this.path}.lock`);
	}
}
const object = (v: unknown): Record<string, unknown> =>
	v !== null && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: {};
export interface ApiReply {
	text: string;
	inputTokens: number;
	outputTokens: number;
	model: string;
	requestId: string | null;
}
export class EvaluationApi {
	private stopped = false;
	constructor(
		readonly service: ApiService,
		private readonly budget: ApiBudget,
		private readonly options: {
			key?: string;
			fetchImpl?: ApiFetch;
			effort?: ApiEffort;
		} = {},
	) {}
	get effort(): ApiEffort {
		return this.options.effort ?? "medium";
	}
	async complete(
		system: string,
		prompt: string,
		signal: AbortSignal,
		maxOutput = 2048,
		schema?: Record<string, unknown>,
	): Promise<ApiReply> {
		if (this.stopped) throw new Error("API_RUN_STOPPED");
		const key =
			this.options.key ??
			(this.service === "openai"
				? (process.env["OPENAI_API_KEY"] ?? process.env["OPEN_AI_API_KEY"])
				: (process.env["ANTHROPIC_API_KEY"] ?? process.env["CLAUDE_API_KEY"]));
		if (!key) throw new Error(`API_KEY_MISSING:${this.service}`);
		const model = apiModels[this.service];
		const payload =
			this.service === "openai"
				? {
						model,
						service_tier: "default",
						store: false,
						reasoning: { effort: this.effort },
						max_output_tokens: maxOutput,
						instructions: system,
						input: prompt,
						...(schema
							? {
									text: {
										format: {
											type: "json_schema",
											name: "evaluation",
											strict: true,
											schema,
										},
									},
								}
							: {}),
					}
				: {
						model,
						service_tier: "standard_only",
						max_tokens: maxOutput,
						system,
						messages: [{ role: "user", content: prompt }],
						output_config: {
							effort: this.effort,
							...(schema ? { format: { type: "json_schema", schema } } : {}),
						},
					};
		const body = JSON.stringify(payload);
		if (Buffer.byteLength(body) > 80_000)
			throw new Error("API_INPUT_TOO_LARGE");
		const id = this.budget.reserve(
			this.service,
			Buffer.byteLength(body),
			maxOutput,
		);
		try {
			const r = await (this.options.fetchImpl ?? fetch)(
				this.service === "openai"
					? "https://api.openai.com/v1/responses"
					: "https://api.anthropic.com/v1/messages",
				{
					method: "POST",
					redirect: "error",
					signal,
					headers: {
						"content-type": "application/json",
						...(this.service === "openai"
							? { Authorization: `Bearer ${key}` }
							: { "x-api-key": key, "anthropic-version": "2023-06-01" }),
					},
					body,
				},
			);
			if (!r.ok) throw new Error(`API_HTTP_${r.status}:${this.service}`);
			const b = object(await r.json());
			const usage = object(b["usage"]);
			const input = usage["input_tokens"];
			const output = usage["output_tokens"];
			if (typeof input !== "number" || typeof output !== "number")
				throw new Error("API_USAGE_MISSING");
			// Count cache-read/write input too. Upper-bound all input at the largest short-context write price.
			if (
				(usage["cache_read_input_tokens"] !== undefined &&
					typeof usage["cache_read_input_tokens"] !== "number") ||
				(usage["cache_creation_input_tokens"] !== undefined &&
					typeof usage["cache_creation_input_tokens"] !== "number")
			)
				throw new Error("API_USAGE_INVALID");
			const cacheRead =
				typeof usage["cache_read_input_tokens"] === "number"
					? usage["cache_read_input_tokens"]
					: 0;
			const cacheWrite =
				typeof usage["cache_creation_input_tokens"] === "number"
					? usage["cache_creation_input_tokens"]
					: 0;
			if (
				![input, output, cacheRead, cacheWrite].every(
					(n) => Number.isSafeInteger(n) && n >= 0,
				)
			)
				throw new Error("API_USAGE_INVALID");
			if (b["model"] !== model) throw new Error("API_MODEL_MISMATCH");
			const requestId =
				r.headers.get("request-id") ?? r.headers.get("x-request-id");
			this.budget.settle(
				id,
				input + cacheRead + cacheWrite,
				output,
				{ model: b["model"], requestId },
				cacheWrite,
			);
			const blocks = this.service === "claude" ? b["content"] : b["output"];
			const chunks: Array<string> = [];
			if (Array.isArray(blocks))
				for (const raw of blocks) {
					const block = object(raw);
					if (
						this.service === "claude" &&
						block["type"] === "text" &&
						typeof block["text"] === "string"
					)
						chunks.push(block["text"]);
					if (
						this.service === "openai" &&
						block["type"] === "message" &&
						Array.isArray(block["content"])
					)
						for (const rawPart of block["content"]) {
							const part = object(rawPart);
							if (
								part["type"] === "output_text" &&
								typeof part["text"] === "string"
							)
								chunks.push(part["text"]);
						}
				}
			if (
				(this.service === "openai" && b["status"] !== "completed") ||
				(this.service === "claude" && b["stop_reason"] !== "end_turn") ||
				chunks.length === 0
			)
				throw new Error("API_INCOMPLETE_OUTPUT");
			return {
				text: chunks.join(""),
				inputTokens: input + cacheRead + cacheWrite,
				outputTokens: output,
				model,
				requestId,
			};
		} catch (error) {
			this.stopped = true;
			throw error;
		}
	}
}
