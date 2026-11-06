import { expect, test } from "bun:test";
import {
	decodeTypedCandidates,
	assertDeclaredPayloads,
} from "../../eval/api/typed-wire.ts";
import { loadQuality, type Job } from "../../eval/api-quality/dataset.ts";
import {
	answerReliable,
	judgeOne,
	judgeExtraction,
} from "../../eval/api-quality/reliable.ts";
import { groundedExtractionProvider } from "../../eval/api/grounded-extraction.ts";
import { recordContext } from "../../eval/api/record-context.ts";
import { semanticPass } from "../../eval/api-quality/scoring.ts";
import { ApiSession } from "../../eval/api/session.ts";
import { ApiBudget } from "../../eval/api/client.ts";
import { reviewedCompletion } from "../../eval/api/reviewed-completion.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const window = [
	{
		utteranceId: "s",
		text: "制御室は許可証があり監督者が在室するとき利用できる。",
	},
];
test("extraction and its judge share host provenance without putting references into generation", async () => {
	const dir = mkdtempSync(join(tmpdir(), "world-record-context-"));
	const budget = new ApiBudget(join(dir, "ledger"));
	const inputs: Record<string, unknown>[] = [];
	const c = loadQuality("independent")[0]!;
	const session = new ApiSession(budget, join(dir, "cache"), {
		key: "fake",
		fetchImpl: async (_url, init) => {
			const body = JSON.parse(String(init.body));
			inputs.push(JSON.parse(body.input));
			return Response.json({
				model: "gpt-6-luna",
				status: "completed",
				usage: { input_tokens: 10, output_tokens: 5 },
				output: [
					{
						type: "message",
						content: [
							{
								type: "output_text",
								text:
									inputs.length < 3
										? '{"candidates":[]}'
										: JSON.stringify({
												label: "output",
												correct: true,
												sourceSupported: true,
												qualificationsPreserved: true,
												appropriateHold: true,
												safetyViolation: false,
												referenceConflict: false,
												reason: "supported",
											}),
							},
						],
					},
				],
			});
		},
	});
	try {
		const provider = groundedExtractionProvider(session.client("openai"), {
			predicates: c.predicates,
			bindings: c.bindings,
		});
		const response = await provider.extract(
			{
				requestKey: "test",
				window: c.sources.map((s) => ({ utteranceId: s.id, text: s.text })),
				entities: c.entities,
				predicates: c.predicates.map((p) => p.name),
				timeoutMs: 1000,
			},
			AbortSignal.timeout(1000),
		);
		await judgeExtraction(session, "openai", c, response.output, {}, true);
		expect(inputs).toHaveLength(3);
		expect(inputs[0]!["contextManifest"]).toEqual(
			recordContext(c.sources.map((s) => s.id)),
		);
		expect(
			(inputs[1]!["originalInput"] as Record<string, unknown>)[
				"contextManifest"
			],
		).toEqual(inputs[0]!["contextManifest"]);
		expect(inputs[2]!["contextManifest"]).toEqual(
			inputs[0]!["contextManifest"],
		);
		for (const input of [
			inputs[0]!,
			inputs[1]!["originalInput"] as Record<string, unknown>,
		]) {
			expect(input).not.toHaveProperty("reference");
			expect(input).not.toHaveProperty("expected");
			expect(input).not.toHaveProperty("holdModality");
		}
	} finally {
		budget.close();
		rmSync(dir, { recursive: true, force: true });
	}
});
test("fixed review sees original input and first draft, and never falls back to an unreviewed draft", async () => {
	const calls: { instruction: string; prompt: string }[] = [];
	const reply = (text: string) => ({
		text,
		inputTokens: 10,
		outputTokens: 5,
		model: "fake",
		requestId: null,
	});
	const original = {
		window: [{ utteranceId: "a", text: "source record" }],
		entities: ["a"],
	};
	const api = {
		complete: async (instruction: string, prompt: string) => {
			calls.push({ instruction, prompt });
			return reply(calls.length === 1 ? "untrusted draft" : "reviewed final");
		},
	};
	const result = await reviewedCompletion(
		api,
		"original contract",
		JSON.stringify(original),
		AbortSignal.timeout(1000),
		100,
	);
	expect(calls.length).toBe(2);
	expect(JSON.parse(calls[1]!.prompt)).toEqual({
		originalInput: original,
		draftWire: "untrusted draft",
	});
	expect(calls[1]!.instruction).toContain("original contract");
	expect(result.final.text).toBe("reviewed final");
	let attempts = 0;
	await expect(
		reviewedCompletion(
			{
				complete: async () => {
					attempts++;
					if (attempts === 1) return reply("draft");
					throw Error("review failed");
				},
			},
			"contract",
			"{}",
			AbortSignal.timeout(1000),
			100,
		),
	).rejects.toThrow("review failed");
	expect(attempts).toBe(2);
});
const candidate = {
	subject: { kind: "id", id: "t" },
	predicate: "available",
	payload: { kind: "value", value: { kind: "boolean", value: true } },
	quote: { utteranceId: "s", text: window[0]!.text, occurrence: 0 },
	modality: "asserted",
	validTime: null,
	condition: {
		nodes: [
			{
				kind: "compare",
				key: "permit",
				op: "eq",
				value: { kind: "boolean", value: true },
			},
			{
				kind: "compare",
				key: "staff",
				op: "eq",
				value: { kind: "boolean", value: true },
			},
			{ kind: "all", children: [0, 1] },
		],
	},
};
test("declared payload contracts reject incompatible units, entity IDs and types without rewriting candidates", () => {
	const catalog = [
		{ name: "stock_level", payload: "value:number,unit:box" },
		{ name: "steward", payload: "value:entity" },
	];
	const candidates = [
		{
			predicate: "stock_level",
			payload: {
				kind: "value",
				value: { kind: "number", value: 3, unit: "box" },
			},
		},
		{
			predicate: "steward",
			payload: {
				kind: "value",
				value: { kind: "entity", entityId: "record-b" },
			},
		},
	];
	const before = JSON.stringify(candidates);
	assertDeclaredPayloads(candidates, catalog, ["record-a", "record-b"]);
	expect(JSON.stringify(candidates)).toBe(before);
	for (const payload of [
		{ kind: "value", value: { kind: "boolean", value: false } },
		{ kind: "value", value: { kind: "number", value: 3, unit: "person" } },
		{ kind: "value", value: { kind: "entity", entityId: "foreign" } },
	])
		expect(() =>
			assertDeclaredPayloads([{ predicate: "steward", payload }], catalog, [
				"record-a",
			]),
		).toThrow("CATALOG_PAYLOAD");
	expect(() =>
		assertDeclaredPayloads(
			[
				{
					predicate: "stock_level",
					payload: {
						kind: "value",
						value: { kind: "number", value: 3, unit: "person" },
					},
				},
			],
			catalog,
			["record-a"],
		),
	).toThrow("CATALOG_PAYLOAD");
});
test("native flat condition wire preserves public AST and rejects cyclic/unused nodes without repair", () => {
	const decode = (c: unknown) =>
		decodeTypedCandidates(JSON.stringify({ candidates: [c] }), window);
	const d = decode(candidate);
	expect(d.candidates[0]!.condition).toEqual({
		kind: "expression",
		expression: { kind: "all", items: candidate.condition.nodes.slice(0, 2) },
	});
	expect(() =>
		decode({ ...candidate, condition: { nodes: [{ kind: "not", child: 0 }] } }),
	).toThrow("BACK_REFERENCE");
	expect(() =>
		decode({
			...candidate,
			condition: {
				nodes: [...candidate.condition.nodes, { kind: "unsupported" }],
			},
		}),
	).toThrow("UNUSED_NODE");
	expect(() => decode({ ...candidate, condition: '{"broken":' })).toThrow();
	expect(
		decode({ ...candidate, condition: null }).candidates[0]!.condition,
	).toBeUndefined();
});
test("reader receives no gold, typed answers connect without unit/phrase repair, judge sees actual context", async () => {
	const dir = mkdtempSync(join(tmpdir(), "world-reliable-"));
	const budget = new ApiBudget(join(dir, "ledger"));
	const prompts: Record<string, unknown>[] = [];
	const schemas: Record<string, unknown>[] = [];
	const session = new ApiSession(budget, join(dir, "cache"), {
		key: "fake",
		fetchImpl: async (_u, init) => {
			const b = JSON.parse(String(init.body));
			prompts.push(JSON.parse(b.input));
			schemas.push(b.text.format.schema);
			const isJudge = String(b.instructions).includes("Evaluate ONE");
			const output = isJudge
				? {
						label: "output",
						correct: true,
						sourceSupported: true,
						qualificationsPreserved: true,
						appropriateHold: true,
						safetyViolation: false,
						referenceConflict: false,
						reason: "supported",
					}
				: {
						answer: "3人",
						citations:
							b.text.format.schema.properties.citations.type === "null"
								? null
								: ["s0"],
						hold: false,
						claims: [
							{
								subjectId: "t",
								predicate: "capacity",
								payload: {
									kind: "value",
									value: { kind: "number", value: 3, unit: "person" },
								},
							},
						],
					};
			return Response.json({
				model: "gpt-6-luna",
				status: "completed",
				usage: { input_tokens: 10, output_tokens: 10 },
				output: [
					{
						type: "message",
						content: [{ type: "output_text", text: JSON.stringify(output) }],
					},
				],
			});
		},
	});
	try {
		const j = loadQuality<Job>("jobs")[0]!;
		const a = await answerReliable(session, "openai", j, "record", ["s0"]);
		expect(a.claims[0]!.payloadJson).toContain("person");
		expect(prompts[0]).not.toHaveProperty("reference");
		expect(prompts[0]).not.toHaveProperty("answerFacts");
		expect(prompts[0]!["contextManifest"]).toMatchObject({ sourceIds: ["s0"] });
		const verdict = await judgeOne(session, "openai", j, a, {
			text: "",
			evidenceIds: [],
		});
		expect(semanticPass(verdict)).toBe(true);
		expect(semanticPass({ ...verdict, referenceConflict: true })).toBe(false);
		const empty = await answerReliable(session, "openai", j, "", []);
		expect(empty.citations).toEqual([]);
		// The judge must receive the same host metadata that the reader saw.
		// Otherwise a supported attribution to an authorized record looks invented.
		expect(prompts[1]!["visible"]).toEqual({
			sourceIds: [],
			context: "",
			contextManifest: prompts[2]!["contextManifest"],
		});
		// Both vendors support null; Claude rejects maxItems, including zero.
		expect(schemas[2]).toMatchObject({
			properties: { citations: { type: "null" } },
		});
		expect(JSON.stringify(schemas[2])).not.toContain("maxItems");
	} finally {
		budget.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("no selected refs exposes no candidate claims, while the exploratory subject view remains available", async () => {
	const { replay } = await import("../../eval/api-quality/pipeline.ts");
	const j = loadQuality<Job>("jobs")[0]!;
	const text = j.sources[0]!.text;
	const r = replay(j, {
		candidates: [
			{
				subject: { kind: "id", id: "t" },
				predicate: "capacity",
				payload: {
					kind: "value",
					value: { kind: "number", value: 3, unit: "person" },
				},
				modality: "reported",
				quote: {
					utteranceId: "s0",
					startByte: 0,
					endByte: Buffer.byteLength(text),
				},
			},
		],
	});
	expect(r.queries[0]!.catalog).toEqual([]);
	expect(r.queries[0]!.arms.subject.units.length).toBeGreaterThan(0);
	expect(r.queries[0]!.arms.selected.units).toEqual([]);
	expect(r.queries[0]!.arms.selected.text).toBe("");
});

test("calendar wire calculates selected coarse bounds exactly, including leap days and fixed offsets", () => {
	const decode = (
		date: string,
		precision: string,
		edge = "at",
		offsetMinutes = 0,
	) => {
		const text = `制御室は${date}の期間に利用できる。`;
		return decodeTypedCandidates(
			JSON.stringify({
				candidates: [
					{
						...candidate,
						condition: null,
						quote: { utteranceId: "s", text, occurrence: 0 },
						validTime: {
							kind: "period",
							precision,
							original: date,
							start: {
								mode: edge === "after" ? "calendar_after" : "calendar_at",
								first: date,
								last: "",
								offsetMinutes,
							},
							end: null,
						},
					},
				],
			}),
			[{ utteranceId: "s", text }],
		).candidates[0]!.validTime;
	};
	expect(decode("2026-11", "month")).toEqual({
		kind: "period",
		precision: "month",
		original: "2026-11",
		start: {
			earliest: Date.parse("2026-11-01T00:00:00Z"),
			latest: Date.parse("2026-12-01T00:00:00Z"),
		},
	});
	expect(decode("2026-12", "month", "after")).toMatchObject({
		start: {
			earliest: Date.parse("2027-01-01T00:00:00Z"),
			latest: Date.parse("2027-02-01T00:00:00Z"),
		},
	});
	expect(decode("2028-02-29", "day", "at", 540)).toMatchObject({
		start: {
			earliest: Date.parse("2028-02-28T15:00:00Z"),
			latest: Date.parse("2028-02-29T15:00:00Z"),
		},
	});
	expect(decode("2024", "year", "after")).toMatchObject({
		start: {
			earliest: Date.parse("2025-01-01T00:00:00Z"),
			latest: Date.parse("2026-01-01T00:00:00Z"),
		},
	});
	expect(() => decode("2026-02-29", "day")).toThrow("CALENDAR_BOUND_DATE");
	expect(() => decode("2026-11-01", "month")).toThrow(
		"CALENDAR_BOUND_PRECISION",
	);
	expect(() => decode("2026-11", "exact")).toThrow("CALENDAR_BOUND_PRECISION");
	expect(() => decode("2026-11", "month", "at", 1000)).toThrow(
		"CALENDAR_BOUND_INVALID",
	);
});
