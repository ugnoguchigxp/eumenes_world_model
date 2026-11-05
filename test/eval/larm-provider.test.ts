import { expect, test } from "bun:test";
import {
	providerFromRegisteredPort,
	type RegisteredPort,
} from "../../eval/extraction/larm-provider.ts";
import { HISTORY_INSTRUCTION } from "../../eval/extraction/providers.ts";
import { main, type MainIo } from "../../eval/extraction/main.ts";

function fake() {
	let model = "fixed-model";
	let calls = 0;
	let closes = 0;
	let messages: { role: string; content: string }[] = [];
	let signal: AbortSignal | undefined;
	const port: RegisteredPort = {
		async connect() {},
		async close() {
			closes++;
		},
		inspect: () => ({
			profile: "unrelated-label",
			providers: [{ name: "llm", model, protocol: "wire-v1" }],
		}),
		async answer(input, abort) {
			messages = input;
			signal = abort;
			calls++;
			return '{"candidates":[]}';
		},
	};
	return {
		port,
		setModel: (value: string) => {
			model = value;
		},
		stats: () => ({ calls, closes, messages, signal }),
	};
}

test("registered adapter checks exact model, forwards purpose and abort, returns verbatim and releases once", async () => {
	const f = fake();
	const provider = await providerFromRegisteredPort(
		f.port,
		"fixed-model",
		"operator-version-1",
		"history",
	);
	const abort = new AbortController();
	const response = await provider.extract(
		{
			requestKey: "opaque",
			window: [],
			entities: [],
			predicates: [],
			timeoutMs: 10,
		},
		abort.signal,
	);
	expect(response.output).toBe('{"candidates":[]}');
	expect(f.stats().messages[0]!.content).toBe(HISTORY_INSTRUCTION);
	expect(f.stats().messages[1]!.content).not.toContain("opaque");
	expect(f.stats().signal).toBe(abort.signal);
	await provider.close?.();
	await provider.close?.();
	expect(f.stats().closes).toBe(1);
});

test("a profile label never substitutes for exact model/version binding or permits a changed model", async () => {
	const mismatch = fake();
	await expect(
		providerFromRegisteredPort(mismatch.port, "other-model", "1"),
	).rejects.toThrow("does not match");
	expect(mismatch.stats().calls).toBe(0);
	expect(mismatch.stats().closes).toBe(1);
	const f = fake();
	await expect(
		providerFromRegisteredPort(f.port, "fixed-model", ""),
	).rejects.toThrow("version");
	const provider = await providerFromRegisteredPort(f.port, "fixed-model", "1");
	f.setModel("changed");
	await expect(
		provider.extract(
			{
				requestKey: "k",
				window: [],
				entities: [],
				predicates: [],
				timeoutMs: 10,
			},
			new AbortController().signal,
		),
	).rejects.toThrow("changed");
	expect(f.stats().calls).toBe(0);
	await provider.close?.();
});

test("the CLI releases an acquired provider even when validation stops before inference", async () => {
	let closed = 0;
	let kind = "local";
	let cleanupFails = false;
	const io: MainIo = {
		out() {},
		err() {},
		async importModule() {
			return {
				createProvider: () => ({
					info: {
						kind,
						modelId: "fixed",
						modelVersion: "1",
						config: {},
					},
					async extract() {
						return { output: { candidates: [] } };
					},
					async close() {
						closed++;
						if (cleanupFails) throw new Error("release failed");
					},
				}),
			};
		},
		now: () => 0,
		writeFile() {},
		writeNewFile: () => true,
		appendLine() {},
		holdoutLogPath: "/unused",
	};
	expect(
		await main(["--provider-module", "fixed", "--split", "dev"], {}, io),
	).toBe(64);
	expect(closed).toBe(1);
	kind = "remote";
	expect(
		await main(["--provider-module", "fixed", "--split", "dev"], {}, io),
	).toBe(2);
	expect(closed).toBe(2);
	kind = "local";
	cleanupFails = true;
	expect(
		await main(
			[
				"--provider-module",
				"fixed",
				"--split",
				"dev",
				"--prompt-version",
				"frozen",
			],
			{},
			io,
		),
	).toBe(2);
	expect(closed).toBe(3);
});
