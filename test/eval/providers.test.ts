/**
 * P4-05.b: the chat-completions provider and the "remote" contrast kind.
 * Every check runs against a fake fetch: no network, no real endpoint.
 * A remote run must never become acceptance-eligible; eligibility stays
 * local-only.
 */
import { describe, expect, test } from "bun:test";
import { loadDataset } from "../../eval/extraction/dataset.ts";
import { exitCodes, main, type MainIo } from "../../eval/extraction/main.ts";
import {
	ChatCompletionsProvider,
	EXTRACTION_INSTRUCTION,
	EXTRACTION_INSTRUCTION_VERSION,
	type FetchImpl,
} from "../../eval/extraction/providers.ts";
import {
	ProviderUnavailableError,
	runEvaluation,
	type ExtractionProvider,
	type ProviderRequest,
} from "../../eval/extraction/runner.ts";

const request: ProviderRequest = {
	requestKey: "k",
	window: [{ utteranceId: "u1", text: "田中は猫が好きだ。" }],
	entities: [{ id: "ent-a", displayName: "田中", aliases: [] }],
	predicates: ["likes"],
	timeoutMs: 1_000,
};

const okBody = (content: string) => ({
	choices: [{ message: { role: "assistant", content } }],
	usage: { prompt_tokens: 12, completion_tokens: 7 },
});

const jsonResponse = (body: unknown, status = 200) => ({
	ok: status >= 200 && status < 300,
	status,
	json: () => Promise.resolve(body),
});

const makeProvider = (fetchImpl: FetchImpl, kind: "local" | "remote") =>
	new ChatCompletionsProvider({
		endpoint: "http://127.0.0.1:9/v1/chat/completions",
		modelId: "contrast-model",
		modelVersion: "v9",
		kind,
		fetchImpl,
	});

describe("ChatCompletionsProvider", () => {
	test("sends the frozen instruction and the visible request as JSON", async () => {
		let sentBody = "";
		let sentHeaders: Readonly<Record<string, string>> = {};
		const provider = makeProvider((input, init) => {
			expect(input).toBe("http://127.0.0.1:9/v1/chat/completions");
			sentBody = init.body;
			sentHeaders = init.headers;
			return Promise.resolve(jsonResponse(okBody('{"candidates": []}')));
		}, "remote");
		const response = await provider.extract(
			request,
			new AbortController().signal,
		);
		// The content is passed through verbatim for the validator.
		expect(response.output).toBe('{"candidates": []}');
		expect(response.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
		const body = JSON.parse(sentBody) as {
			model: string;
			temperature: number;
			messages: { role: string; content: string }[];
		};
		expect(body.model).toBe("contrast-model");
		expect(body.temperature).toBe(0);
		expect(body.messages[0]).toEqual({
			role: "system",
			content: EXTRACTION_INSTRUCTION,
		});
		expect(JSON.parse(body.messages[1]!.content)).toEqual({
			window: request.window,
			entities: request.entities,
			predicates: request.predicates,
		});
		// No key was configured, so no authorization header is sent.
		expect(sentHeaders["authorization"]).toBeUndefined();
		expect(provider.info).toEqual({
			kind: "remote",
			modelId: "contrast-model",
			modelVersion: "v9",
			config: {
				instructionVersion: EXTRACTION_INSTRUCTION_VERSION,
				temperature: 0,
			},
		});
		expect(EXTRACTION_INSTRUCTION_VERSION).toBe("eval-extract-instruction-2");
	});

	test("a non-2xx answer is a provider-unavailable error", async () => {
		const provider = makeProvider(
			() => Promise.resolve(jsonResponse({}, 503)),
			"remote",
		);
		await expect(
			provider.extract(request, new AbortController().signal),
		).rejects.toBeInstanceOf(ProviderUnavailableError);
	});

	test("a connection failure is a provider-unavailable error", async () => {
		const provider = makeProvider(
			() => Promise.reject(new TypeError("fetch failed")),
			"local",
		);
		await expect(
			provider.extract(request, new AbortController().signal),
		).rejects.toBeInstanceOf(ProviderUnavailableError);
	});

	test("a malformed response body is a provider-unavailable error", async () => {
		const notJson = makeProvider(
			() =>
				Promise.resolve({
					ok: true,
					status: 200,
					json: () => Promise.reject(new Error("bad json")),
				}),
			"remote",
		);
		await expect(
			notJson.extract(request, new AbortController().signal),
		).rejects.toBeInstanceOf(ProviderUnavailableError);
		const noContent = makeProvider(
			() => Promise.resolve(jsonResponse({ choices: [] })),
			"remote",
		);
		await expect(
			noContent.extract(request, new AbortController().signal),
		).rejects.toBeInstanceOf(ProviderUnavailableError);
	});

	test("an abort propagates unchanged, never as unavailability", async () => {
		const controller = new AbortController();
		const abortError = new DOMException("aborted", "AbortError");
		const provider = makeProvider((_input, init) => {
			if (init.signal.aborted) return Promise.reject(abortError);
			return Promise.resolve(jsonResponse(okBody("{}")));
		}, "remote");
		controller.abort();
		await expect(provider.extract(request, controller.signal)).rejects.toBe(
			abortError,
		);
	});
});

describe("remote runs are never acceptance-eligible", () => {
	test("holdout + acceptance mode + kind remote stays ineligible", async () => {
		const stub: ExtractionProvider = {
			info: {
				kind: "remote",
				modelId: "contrast-model",
				modelVersion: "v9",
				config: {},
			},
			extract: () => Promise.resolve({ output: { candidates: [] } }),
		};
		const report = await runEvaluation({
			dataset: loadDataset(),
			provider: stub,
			split: "holdout",
			mode: "acceptance",
			promptVersion: "contrast-1",
		});
		expect(report.provider.kind).toBe("remote");
		expect(report.acceptance.eligible).toBe(false);
		expect(report.acceptance.modelAccepted).toBe(false);
	});
});

describe("CLI --remote fails closed", () => {
	const io = (): { mainIo: MainIo; err: string[] } => {
		const err: string[] = [];
		return {
			err,
			mainIo: {
				out: () => {},
				err: (line) => void err.push(line),
				importModule: () => Promise.reject(new Error("must not import")),
				now: () => 0,
				writeFile: () => {},
				writeNewFile: () => false,
				appendLine: () => {},
				holdoutLogPath: "/audit/holdout-runs.jsonl",
			},
		};
	};

	test("no endpoint: usage error before anything runs", async () => {
		const { mainIo, err } = io();
		const code = await main(["--remote"], {}, mainIo);
		expect(code).toBe(exitCodes.usage);
		expect(err.join("\n")).toContain("--endpoint");
	});

	test("endpoint without a model id: usage error", async () => {
		const { mainIo, err } = io();
		const code = await main(
			["--remote", "--endpoint", "http://127.0.0.1:9/v1"],
			{},
			mainIo,
		);
		expect(code).toBe(exitCodes.usage);
		expect(err.join("\n")).toContain("--model-id");
	});

	test("endpoint flags without --remote: usage error", async () => {
		const { mainIo, err } = io();
		const code = await main(
			["--endpoint", "http://127.0.0.1:9/v1"],
			{},
			mainIo,
		);
		expect(code).toBe(exitCodes.usage);
		expect(err.join("\n")).toContain("--remote");
	});
});
