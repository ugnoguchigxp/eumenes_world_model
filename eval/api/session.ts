/** Two live POSTs at most; exact-request reuse is explicit and content-addressed. */
import { createHash } from "node:crypto";
import {
	appendFileSync,
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	ApiBudget,
	EvaluationApi,
	apiModels,
	type ApiReply,
	type ApiService,
} from "./client.ts";
export const digest = (v: unknown) =>
	createHash("sha256").update(JSON.stringify(v)).digest("hex");
interface Cached {
	key: string;
	event?: string;
	retain?: boolean;
	reply?: ApiReply;
	error?: string;
}
export class ApiSession {
	private active = 0;
	private waiters: Array<() => void> = [];
	private cache = new Map<
		string,
		{ retain: boolean; reply: Promise<ApiReply> }
	>();
	private stopped = new Map<ApiService, string>();
	readonly counts = { requests: 0, reused: 0, failed: 0, maxConcurrent: 0 };
	constructor(
		readonly budget: ApiBudget,
		readonly output: string,
		private readonly options: NonNullable<
			ConstructorParameters<typeof EvaluationApi>[2]
		> = {},
	) {
		mkdirSync(output, { recursive: true });
	}
	private append(file: string, event: unknown) {
		const fd = openSync(file, "a");
		try {
			appendFileSync(fd, JSON.stringify(event) + "\n");
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
	}
	private async enter() {
		if (this.active >= 2)
			await new Promise<void>((resolve) => this.waiters.push(resolve));
		else this.active++;
		this.counts.maxConcurrent = Math.max(
			this.active,
			this.counts.maxConcurrent,
		);
	}
	private leave() {
		const next = this.waiters.shift();
		if (next) next();
		else this.active--;
	}
	client(
		service: ApiService,
		retain = true,
	): Pick<EvaluationApi, "service" | "complete" | "effort"> {
		return {
			service,
			effort: this.options.effort ?? "medium",
			complete: (system, prompt, signal, maxOutput = 2048, schema) =>
				this.complete(
					service,
					system,
					prompt,
					maxOutput,
					schema,
					retain,
					signal,
				),
		};
	}
	async complete(
		service: ApiService,
		system: string,
		prompt: string,
		maxOutput = 2048,
		schema?: Record<string, unknown>,
		retain = true,
		externalSignal?: AbortSignal,
	): Promise<ApiReply> {
		const key = digest({
			model: apiModels[service],
			system,
			prompt,
			maxOutput,
			schema,
			effort: this.options.effort ?? "medium",
			tier: "standard",
		});
		const file = join(this.output, `${key}.jsonl`);
		const existing = this.cache.get(key);
		if (existing) {
			if (existing.retain !== retain)
				throw new Error("API_CACHE_RETENTION_MISMATCH");
			this.counts.reused++;
			return existing.reply;
		}
		if (existsSync(file)) {
			const lines = readFileSync(file, "utf8")
				.trim()
				.split("\n")
				.map((x) => JSON.parse(x) as Cached);
			const saved = lines.at(-1)!;
			if (saved.key !== key) throw new Error("API_CACHE_KEY_MISMATCH");
			const start = lines.find((line) => line.event === "start");
			// Retention is a local policy, never a new request identity: changing
			// it must neither expose retained text nor regenerate a first response.
			const savedRetention = start?.retain ?? (saved.reply ? true : undefined);
			if (savedRetention !== undefined && savedRetention !== retain)
				throw new Error("API_CACHE_RETENTION_MISMATCH");
			if (!saved.reply && !saved.error)
				throw new Error("API_CACHE_INCOMPLETE_DO_NOT_RETRY");
			// Older runs wrote service-stop errors even for keys never sent.
			// Their first actual attempt is still allowed; real failed attempts
			// always have a start event and remain permanently cached failures.
			const blockedBeforeStart =
				saved.error &&
				!lines.some((line) => line.event === "start") &&
				(/^API_HTTP_40[013]:/.test(saved.error) ||
					saved.error.includes("BUDGET_EXHAUSTED"));
			if (!blockedBeforeStart) {
				this.counts.reused++;
				if (saved.error) throw new Error(saved.error);
				return saved.reply!;
			}
		}
		const pending = (async () => {
			await this.enter();
			let started = false;
			try {
				const permanent = this.stopped.get(service);
				if (permanent) throw new Error(permanent);
				// The in-memory map only coordinates one session. Keep an exclusive
				// claim on disk as well, including after an interrupted first attempt.
				try {
					closeSync(openSync(file + ".claim", "wx"));
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "EEXIST")
						throw new Error("API_CACHE_REQUEST_ALREADY_CLAIMED_DO_NOT_RETRY");
					throw error;
				}
				this.append(file, {
					key,
					event: "start",
					service,
					retain,
					inputBytes: Buffer.byteLength(system + prompt),
				});
				const directory = openSync(this.output, "r");
				try {
					fsyncSync(directory);
				} finally {
					closeSync(directory);
				}
				started = true;
				externalSignal?.throwIfAborted();
				this.counts.requests++;
				// A new independent request may follow a transient failure. The failed
				// request itself is cached as failure and is never regenerated.
				const reply = await new EvaluationApi(
					service,
					this.budget,
					this.options,
				).complete(
					system,
					prompt,
					externalSignal
						? AbortSignal.any([externalSignal, AbortSignal.timeout(120000)])
						: AbortSignal.timeout(120000),
					maxOutput,
					schema,
				);
				this.append(
					file,
					retain
						? { key, reply }
						: {
								key,
								event: "complete",
								model: reply.model,
								requestId: reply.requestId,
								inputTokens: reply.inputTokens,
								outputTokens: reply.outputTokens,
								outputDigest: digest(reply.text),
							},
				);
				return reply;
			} catch (e) {
				this.counts.failed++;
				const message = e instanceof Error ? e.message : "API_ERROR";
				if (started) this.append(file, { key, error: message });
				if (
					/API_HTTP_40[013]/.test(message) ||
					message.includes("BUDGET_EXHAUSTED")
				)
					this.stopped.set(service, message);
				throw e;
			} finally {
				this.leave();
			}
		})();
		this.cache.set(key, { retain, reply: pending });
		return pending;
	}
}
