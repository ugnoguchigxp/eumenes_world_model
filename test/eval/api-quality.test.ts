import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiBudget } from "../../eval/api/client.ts";
import { ApiSession, digest } from "../../eval/api/session.ts";
import {
	loadQuality,
	type Job,
	type QualityCase,
} from "../../eval/api-quality/dataset.ts";
import { replay } from "../../eval/api-quality/pipeline.ts";
import { sameCondition, gradeAnswer } from "../../eval/api-quality/scoring.ts";
import { plainContext, rawContext } from "../../eval/api-quality/protocol.ts";
import type { ConditionSpec } from "../../src/index.ts";
const factOutput = (c: QualityCase) => ({
	candidates: c.expected.map((f) => ({
		subject: { kind: "id", id: f.subjectId },
		predicate: f.predicate,
		payload: f.payload,
		modality: f.modality,
		quote: {
			utteranceId: f.sourceIds[0],
			startByte: 0,
			endByte: Buffer.byteLength(
				c.sources.find((s) => s.id === f.sourceIds[0])!.text,
			),
		},
		...(f.condition ? { condition: f.condition } : {}),
		...(f.validTime ? { validTime: f.validTime } : {}),
	})),
});
test("frozen sixty and forty fixtures satisfy limits and public condition/time contracts", () => {
	expect(loadQuality("independent")).toHaveLength(60);
	const jobs = loadQuality<Job>("jobs");
	expect(jobs.filter((j) => j.split === "dev")).toHaveLength(10);
	expect(jobs.filter((j) => j.split === "evaluation")).toHaveLength(30);
});
test("actual fixture-host forgetting removes adopted data and World/plain preserve exact material", () => {
	const j = loadQuality<Job>("jobs")[0]!;
	const r = replay(j, factOutput(j), [0]);
	const p = r.queries[0]!.arms.selected;
	expect(p.usage?.status).toBe("valid");
	expect(plainContext(p)).toContain("slice:");
	const erased = { ...j, eraseBeforeRead: ["s0"] };
	const f = replay(erased, factOutput(j), []);
	expect(f.queries[0]!.catalog).toHaveLength(0);
	expect(f.queries[0]!.arms.selected.evidenceIds).toEqual([]);
	expect(rawContext(erased).evidenceIds).toEqual([]);
});
test("mathematically equivalent boolean forms match and strict unit/bound differences fail", () => {
	const a: ConditionSpec = {
		kind: "expression",
		expression: {
			kind: "compare",
			key: "x",
			op: "eq",
			value: { kind: "boolean", value: false },
		},
	};
	const b: ConditionSpec = {
		kind: "expression",
		expression: {
			kind: "not",
			item: {
				kind: "compare",
				key: "x",
				op: "eq",
				value: { kind: "boolean", value: true },
			},
		},
	};
	expect(sameCondition(a, b)).toBe(true);
	expect(sameCondition(a, undefined)).toBe(false);
	const n: ConditionSpec = {
		kind: "expression",
		expression: {
			kind: "compare",
			key: "n",
			op: "lt",
			value: { kind: "number", value: 10, unit: "kg" },
		},
	};
	expect(
		sameCondition(n, {
			kind: "expression",
			expression: {
				kind: "compare",
				key: "n",
				op: "lte",
				value: { kind: "number", value: 10, unit: "kg" },
			},
		}),
	).toBe(false);
});
test("wrong/uncited/missing answers cannot pass and long raw arm loses old evidence under fixed budget", () => {
	const j = loadQuality<Job>("jobs")[0]!;
	const a = {
		answer: "3人",
		hold: false,
		citations: ["s0"],
		claims: j.answerFacts.map((f) => ({
			subjectId: f.subjectId,
			predicate: f.predicate,
			payloadJson: JSON.stringify(f.payload),
		})),
	};
	expect(gradeAnswer(j, a, ["s0"]).passed).toBe(true);
	expect(gradeAnswer(j, { ...a, citations: ["fake"] }, ["s0"]).passed).toBe(
		false,
	);
	expect(gradeAnswer(j, null, []).passed).toBe(false);
	for (const job of loadQuality<Job>("jobs").filter(
		(j) => j.group === "long",
	)) {
		expect(rawContext(job).evidenceIds).not.toContain("s0");
	}
});
test("condition equivalence covers unmentioned string/entity values and large numeric bounds", () => {
	for (const value of [
		{ kind: "string", value: "known" } as const,
		{ kind: "entity", entityId: "known" } as const,
	]) {
		const eq = { kind: "compare", key: "x", op: "eq", value } as const;
		const ne = { ...eq, op: "ne" } as const;
		expect(
			sameCondition(
				{ kind: "expression", expression: eq },
				{ kind: "expression", expression: { kind: "any", items: [eq, ne] } },
			),
		).toBe(false);
		expect(
			sameCondition(
				{ kind: "expression", expression: ne },
				{ kind: "expression", expression: { kind: "not", item: eq } },
			),
		).toBe(true);
	}
	for (const bound of [1e20, -1e20, Number.MAX_VALUE, -Number.MAX_VALUE]) {
		const compare = {
			kind: "compare",
			key: "n",
			op: "lt",
			value: { kind: "number", value: bound, unit: "kg" },
		} as const;
		expect(
			sameCondition(
				{ kind: "expression", expression: compare },
				{ kind: "expression", expression: { ...compare, op: "gt" } },
			),
		).toBe(false);
	}
});
test("session caps live requests, reuses exact responses and never retries first failures", async () => {
	const dir = mkdtempSync(join(tmpdir(), "world-api-session-"));
	const budget = new ApiBudget(join(dir, "budget.jsonl"));
	let active = 0,
		peak = 0,
		calls = 0;
	const options = {
		key: "fake",
		fetchImpl: async (_url: string, init: RequestInit) => {
			calls++;
			active++;
			peak = Math.max(active, peak);
			await new Promise((r) => setTimeout(r, 5));
			active--;
			const b = JSON.parse(String(init.body));
			if (b.input === "bad") return new Response("", { status: 503 });
			return Response.json({
				model: "gpt-6-luna",
				status: "completed",
				usage: { input_tokens: 10, output_tokens: 5 },
				output: [
					{
						type: "message",
						content: [{ type: "output_text", text: "private-response" }],
					},
				],
			});
		},
	};
	const session = new ApiSession(budget, join(dir, "cache"), options);
	try {
		await Promise.all(
			["a", "b", "a", "c", "d"].map((p) => session.complete("openai", "s", p)),
		);
		expect(peak).toBe(2);
		expect(calls).toBe(4);
		expect(session.counts.reused).toBe(1);
		await expect(session.complete("openai", "s", "bad")).rejects.toThrow(
			"API_HTTP_503",
		);
		await expect(session.complete("openai", "s", "bad")).rejects.toThrow(
			"API_HTTP_503",
		);
		expect(calls).toBe(5);
		await session.complete("openai", "s", "metadata", 100, undefined, false);
		const beforeHigh = calls;
		const high = new ApiSession(budget, join(dir, "cache"), {
			...options,
			effort: "high",
		});
		await high.complete("openai", "s", "a");
		await high.complete("openai", "s", "a");
		expect(calls).toBe(beforeHigh + 1);
		expect(high.counts.reused).toBe(1);
		expect(high.client("openai").effort).toBe("high");
		const { readdirSync } = await import("node:fs");
		const contents = readdirSync(join(dir, "cache")).map((f) =>
			readFileSync(join(dir, "cache", f), "utf8"),
		);
		expect(
			contents
				.filter((c) => c.includes('"retain":false'))
				.every((c) => !c.includes("private-response")),
		).toBe(true);
	} finally {
		budget.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("independent sessions sharing a cache cannot send the same first request twice", async () => {
	const dir = mkdtempSync(join(tmpdir(), "world-shared-cache-"));
	const budget = new ApiBudget(join(dir, "ledger"));
	let calls = 0;
	const options = {
		key: "fake",
		fetchImpl: async () => {
			calls++;
			return Response.json({
				model: "gpt-6-luna",
				status: "completed",
				usage: { input_tokens: 10, output_tokens: 5 },
				output: [
					{
						type: "message",
						content: [{ type: "output_text", text: "first" }],
					},
				],
			});
		},
	};
	try {
		const a = new ApiSession(budget, join(dir, "cache"), options);
		const b = new ApiSession(budget, join(dir, "cache"), options);
		const results = await Promise.allSettled([
			a.complete("openai", "s", "p"),
			b.complete("openai", "s", "p"),
		]);
		expect(calls).toBe(1);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const failed = results.find((r) => r.status === "rejected");
		if (failed?.status === "rejected")
			expect(failed.reason.message).toBe(
				"API_CACHE_REQUEST_ALREADY_CLAIMED_DO_NOT_RETRY",
			);
		const reopened = new ApiSession(budget, join(dir, "cache"), options);
		expect((await reopened.complete("openai", "s", "p")).text).toBe("first");
		expect(calls).toBe(1);
		// A crash/storage failure may leave the claim without its response log.
		// Losing the log must not make that paid request eligible for regeneration.
		const { readdirSync } = await import("node:fs");
		const journal = readdirSync(join(dir, "cache")).find((f) =>
			f.endsWith(".jsonl"),
		)!;
		rmSync(join(dir, "cache", journal));
		const interrupted = new ApiSession(budget, join(dir, "cache"), options);
		await expect(interrupted.complete("openai", "s", "p")).rejects.toThrow(
			"API_CACHE_REQUEST_ALREADY_CLAIMED_DO_NOT_RETRY",
		);
		expect(calls).toBe(1);
	} finally {
		budget.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("exact request reuse rejects retention policy changes in memory and on disk", async () => {
	for (const retain of [false, true]) {
		const dir = mkdtempSync(join(tmpdir(), "world-retention-"));
		const budget = new ApiBudget(join(dir, "ledger"));
		let calls = 0;
		const options = {
			key: "fake",
			fetchImpl: async () => {
				calls++;
				return Response.json({
					model: "gpt-6-luna",
					status: "completed",
					usage: { input_tokens: 10, output_tokens: 5 },
					output: [
						{
							type: "message",
							content: [{ type: "output_text", text: "private-response" }],
						},
					],
				});
			},
		};
		try {
			const session = new ApiSession(budget, join(dir, "cache"), options);
			const first = session.complete(
				"openai",
				"s",
				"p",
				100,
				undefined,
				retain,
			);
			await expect(
				session.complete("openai", "s", "p", 100, undefined, !retain),
			).rejects.toThrow("API_CACHE_RETENTION_MISMATCH");
			await first;
			expect(
				(await session.complete("openai", "s", "p", 100, undefined, retain))
					.text,
			).toBe("private-response");
			const reopened = new ApiSession(budget, join(dir, "cache"), options);
			await expect(
				reopened.complete("openai", "s", "p", 100, undefined, !retain),
			).rejects.toThrow("API_CACHE_RETENTION_MISMATCH");
			if (retain)
				expect(
					(await reopened.complete("openai", "s", "p", 100, undefined, retain))
						.text,
				).toBe("private-response");
			else
				await expect(
					reopened.complete("openai", "s", "p", 100, undefined, retain),
				).rejects.toThrow("API_CACHE_INCOMPLETE_DO_NOT_RETRY");
			expect(calls).toBe(1);
		} finally {
			budget.close();
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

test("service-stop keys without an attempt may execute once, while real failed attempts never retry", async () => {
	const dir = mkdtempSync(join(tmpdir(), "world-unsent-"));
	const budget = new ApiBudget(join(dir, "ledger"));
	let calls = 0;
	const cache = join(dir, "cache");
	const blocked = new ApiSession(budget, cache, {
		key: "fake",
		fetchImpl: async () => {
			calls++;
			return new Response("", { status: 400 });
		},
	});
	try {
		await expect(blocked.complete("openai", "s", "bad-schema")).rejects.toThrow(
			"API_HTTP_400",
		);
		await expect(blocked.complete("openai", "s", "never-sent")).rejects.toThrow(
			"API_HTTP_400",
		);
		expect(calls).toBe(1);
		const key = digest({
			model: "gpt-6-luna",
			system: "s",
			prompt: "legacy-unsent",
			maxOutput: 2048,
			schema: undefined,
			effort: "medium",
			tier: "standard",
		});
		writeFileSync(
			join(cache, key + ".jsonl"),
			JSON.stringify({ key, error: "API_HTTP_400:openai" }) + "\n",
		);
		const resumed = new ApiSession(budget, cache, {
			key: "fake",
			fetchImpl: async () => {
				calls++;
				return Response.json({
					model: "gpt-6-luna",
					status: "completed",
					usage: { input_tokens: 10, output_tokens: 5 },
					output: [
						{
							type: "message",
							content: [{ type: "output_text", text: "first-actual-response" }],
						},
					],
				});
			},
		});
		await expect(resumed.complete("openai", "s", "bad-schema")).rejects.toThrow(
			"API_HTTP_400",
		);
		expect(calls).toBe(1);
		await resumed.complete("openai", "s", "never-sent");
		expect((await resumed.complete("openai", "s", "legacy-unsent")).text).toBe(
			"first-actual-response",
		);
		await resumed.complete("openai", "s", "legacy-unsent");
		expect(calls).toBe(3);
		expect(resumed.counts.requests).toBe(2);
		expect(budget.summary.pendingUpperBoundUsd).toBeGreaterThan(0);
		expect(readFileSync(join(cache, key + ".jsonl"), "utf8")).toContain(
			'"error":"API_HTTP_400:openai"',
		);
	} finally {
		budget.close();
		rmSync(dir, { recursive: true, force: true });
	}
});
