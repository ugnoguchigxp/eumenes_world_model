import { expect, test } from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	appendFileSync,
	writeFileSync,
	existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ApiBudget,
	EvaluationApi,
	apiModels,
	type ApiFetch,
} from "../../eval/api/client.ts";
function rig() {
	const path = mkdtempSync(join(tmpdir(), "world-api-"));
	const budget = new ApiBudget(join(path, "usage.jsonl"));
	return {
		path,
		budget,
		close() {
			budget.close();
			rmSync(path, { recursive: true, force: true });
		},
	};
}
test("journal IDs cannot be malformed, skipped or reused after settlement", () => {
	const r = rig();
	r.budget.close();
	try {
		const path = join(r.path, "usage.jsonl");
		const reserve = { type: "reserve", id: 1, reserveNano: 3000000 };
		for (const events of [
			[{ ...reserve, id: null }],
			[{ ...reserve, id: 0 }],
			[{ ...reserve, id: 1.5 }],
			[{ ...reserve, id: 2 }],
			[reserve, { type: "settle", id: 1, chargeNano: 1000 }, reserve],
		]) {
			writeFileSync(
				path,
				events.map((e) => JSON.stringify(e)).join("\n") + "\n",
			);
			let resumed: ApiBudget | undefined;
			try {
				expect(() => {
					resumed = new ApiBudget(path);
				}).toThrow("invalid budget journal");
			} finally {
				resumed?.close();
			}
			expect(existsSync(path + ".lock")).toBe(false);
		}
	} finally {
		r.close();
	}
});

test("usage above its reservation is charged durably and blocks new spend across restarts", () => {
	const r = rig();
	let resumed: ApiBudget | undefined;
	try {
		const id = r.budget.reserve("openai", 0, 1);
		expect(() => r.budget.settle(id, 10000, 0)).toThrow(
			"API_USAGE_EXCEEDED_RESERVATION",
		);
		expect(r.budget.summary.chargedUpperBoundUsd).toBe(0.0025);
		expect(() => r.budget.reserve("claude", 0, 1)).toThrow(
			"API_BUDGET_UNSAFE_RESERVATION",
		);
		r.budget.close();
		resumed = new ApiBudget(join(r.path, "usage.jsonl"));
		expect(resumed.summary).toEqual(r.budget.summary);
		expect(() => resumed!.reserve("openai", 0, 1)).toThrow(
			"API_BUDGET_UNSAFE_RESERVATION",
		);
	} finally {
		resumed?.close();
		r.close();
	}
});

test("a closed budget cannot append settlements after releasing its writer lock", () => {
	const r = rig();
	try {
		const id = r.budget.reserve("claude", 100, 100);
		r.budget.close();
		const before = readFileSync(join(r.path, "usage.jsonl"), "utf8");
		expect(() => r.budget.settle(id, 10, 10)).toThrow("API budget closed");
		expect(readFileSync(join(r.path, "usage.jsonl"), "utf8")).toBe(before);
	} finally {
		r.close();
	}
});
test("durable reservations survive restart, prevent concurrent writers and enforce cumulative ten-dollar cap", () => {
	const r = rig();
	try {
		r.budget.reserve("claude", 1000, 100);
		expect(() => new ApiBudget(join(r.path, "usage.jsonl"))).toThrow();
		const before = r.budget.summary;
		r.budget.close();
		const resumed = new ApiBudget(join(r.path, "usage.jsonl"));
		expect(resumed.summary).toEqual(before);
		resumed.close();
		expect(() => new ApiBudget(join(r.path, "other"), 10.01)).toThrow();
		const tiny = new ApiBudget(join(r.path, "tiny"), 0.001);
		expect(() => tiny.reserve("openai", 100, 100)).toThrow(
			"API_BUDGET_EXHAUSTED",
		);
		expect(tiny.summary.requests).toBe(0);
		tiny.close();
	} finally {
		r.close();
	}
});
for (const service of ["openai", "claude"] as const)
	test(`${service}: exact model, verbatim output and measured usage, no leaked key`, async () => {
		const r = rig();
		try {
			let sent: Record<string, unknown> = {};
			const api = new EvaluationApi(service, r.budget, {
				key: "test-private-key",
				effort: "high",
				fetchImpl: (async (_url, init) => {
					sent = JSON.parse(String(init?.body));
					return Response.json(
						service === "openai"
							? {
									model: apiModels[service],
									status: "completed",
									usage: { input_tokens: 10, output_tokens: 20 },
									output: [
										{
											type: "message",
											content: [{ type: "output_text", text: '{"ok":true}' }],
										},
									],
								}
							: {
									model: apiModels[service],
									stop_reason: "end_turn",
									usage: {
										input_tokens: 10,
										output_tokens: 20,
										cache_read_input_tokens: 5,
									},
									content: [{ type: "text", text: '{"ok":true}' }],
								},
					);
				}) as ApiFetch,
			});
			expect(
				(
					await api.complete(
						"instructions",
						"source",
						AbortSignal.timeout(1000),
					)
				).text,
			).toBe('{"ok":true}');
			expect(sent["model"]).toBe(apiModels[service]);
			expect(
				service === "openai" ? sent["reasoning"] : sent["output_config"],
			).toMatchObject({ effort: "high" });
			expect(r.budget.summary.pendingUpperBoundUsd).toBe(0);
			expect(readFileSync(join(r.path, "usage.jsonl"), "utf8")).not.toContain(
				"test-private-key",
			);
		} finally {
			r.close();
		}
	});
test("failed HTTP and missing usage keep reservations and stop further inference", async () => {
	for (const response of [
		Response.json({}, { status: 429 }),
		Response.json({ model: "gpt-6-luna", status: "completed" }),
	]) {
		const r = rig();
		try {
			let calls = 0;
			const api = new EvaluationApi("openai", r.budget, {
				key: "test",
				fetchImpl: (async () => {
					calls++;
					return response;
				}) as ApiFetch,
			});
			await expect(
				api.complete("s", "p", AbortSignal.timeout(1000)),
			).rejects.toThrow();
			await expect(
				api.complete("s", "p", AbortSignal.timeout(1000)),
			).rejects.toThrow("API_RUN_STOPPED");
			expect(calls).toBe(1);
			expect(r.budget.summary.pendingUpperBoundUsd).toBeGreaterThan(0);
		} finally {
			r.close();
		}
	}
});
test("truncated journals fail closed rather than refunding uncertain spend", () => {
	const r = rig();
	r.budget.close();
	try {
		appendFileSync(join(r.path, "usage.jsonl"), '{"type":');
		expect(() => new ApiBudget(join(r.path, "usage.jsonl"))).toThrow();
	} finally {
		r.close();
	}
});

test("known usage uses buffered component prices; old settlements and uncertain reservations are never repriced", async () => {
	const r = rig();
	try {
		const old = r.budget.reserve("claude", 1000, 100);
		r.budget.settle(old, 100, 20);
		const before = r.budget.summary.chargedUpperBoundUsd;
		const api = new EvaluationApi("claude", r.budget, {
			key: "fake",
			fetchImpl: async () =>
				Response.json({
					model: "claude-haiku-5-5",
					stop_reason: "end_turn",
					usage: {
						input_tokens: 10,
						cache_creation_input_tokens: 5,
						cache_read_input_tokens: 7,
						output_tokens: 20,
					},
					content: [{ type: "text", text: "ok" }],
				}),
		});
		await api.complete("contract", "input", AbortSignal.timeout(1000));
		expect(r.budget.summary.chargedUpperBoundUsd).toBeCloseTo(
			before + 15800 / 1e9,
			12,
		);
		const lines = readFileSync(join(r.path, "usage.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((s) => JSON.parse(s));
		expect(
			lines.find((e) => e.type === "settle" && e.id === old).chargeNano,
		).toBe(35000);
		expect(lines.at(-1).costPolicy).toBe("short-standard-buffered/2");
		const wrong = new EvaluationApi("openai", r.budget, {
			key: "fake",
			fetchImpl: async () =>
				Response.json({
					model: "other-model",
					status: "completed",
					usage: { input_tokens: 10, output_tokens: 5 },
				}),
		});
		await expect(
			wrong.complete("s", "p", AbortSignal.timeout(1000)),
		).rejects.toThrow("API_MODEL_MISMATCH");
		expect(r.budget.summary.pendingUpperBoundUsd).toBeGreaterThan(0);
	} finally {
		r.close();
	}
});
