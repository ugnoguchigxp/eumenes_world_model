import { expect, test } from "bun:test";
import { assertNoTool } from "../../examples/seed-luna/luna.ts";
import { bindQuotes } from "../../examples/seed-luna/quotes.ts";
import {
	persistCandidates,
	validateOutput,
} from "../../examples/seed-luna/pipeline.ts";
import { hash, seedScope, type SeedDocument } from "../../eval/seed/corpus.ts";
import { openTestStore } from "../support/sqlite-store.ts";
import type { Entity } from "../../src/index.ts";

const content = JSON.stringify({
	preface: "前置き日本語。",
	claim: "研究Aでは効果が不明と報告された。",
});
const document: SeedDocument = {
	recordId: "fixture",
	collection: "fixture",
	content,
	source: {
		namespace: "test",
		kind: "document",
		id: "fixture",
		revision: "v1",
		digest: `sha256:${hash(Buffer.from(content))}`,
	},
};
const entity: Entity = {
	id: "study-a",
	scope: seedScope,
	revision: 1,
	displayName: "研究A",
	aliases: [],
	externalRefs: [],
};
const candidate = (extra: Record<string, unknown> = {}) => ({
	subject: { kind: "id", id: entity.id },
	predicate: "source_claim",
	payload: {
		kind: "value",
		value: { kind: "string", value: "研究Aでは効果が不明と報告された。" },
	},
	quote: {
		utteranceId: document.source.id,
		pointer: "/claim",
	},
	modality: "reported",
	condition: { kind: "unspecified" },
	...extra,
});

test("selected fields bind to exact UTF-8 bytes without changing the model's meaning", () => {
	const result = bindQuotes(
		{ candidates: [candidate()] },
		document.source.id,
		content,
	);
	const bound = result.output.candidates[0]!.quote;
	expect(result.bindings[0]?.status).toBe("bound");
	expect(
		Buffer.from(content).subarray(bound.startByte, bound.endByte).toString(),
	).toBe("研究Aでは効果が不明と報告された。");
});

test("missing, non-string, empty and other-document fields never acquire a valid range", () => {
	for (const [pointer, source, input] of [
		["/nonexistent", document.source.id, content],
		["/claim", document.source.id, JSON.stringify({ claim: 42 })],
		["/claim", document.source.id, JSON.stringify({ claim: "" })],
		["/claim", "different-source", content],
	]) {
		const raw = {
			candidates: [candidate({ quote: { utteranceId: source, pointer } })],
		};
		const result = bindQuotes(raw, document.source.id, input!);
		expect(result.bindings[0]?.status).toBe("unverifiable");
		expect(result.output.candidates[0]?.quote.startByte).toBe(-1);
	}
});

test("JSON Pointer disambiguates duplicate fields and maps escaped text and emoji bytes", () => {
	const text = '日本語😀\r\n"引用"\\終';
	const input = JSON.stringify({ "a/b~": [{ value: text }], duplicate: text });
	const raw = {
		candidates: [
			candidate({
				quote: {
					utteranceId: document.source.id,
					pointer: "/a~1b~0/0/value",
				},
			}),
		],
	};
	const result = bindQuotes(raw, document.source.id, input);
	const quote = result.output.candidates[0]!.quote;
	expect(result.bindings[0]?.status).toBe("bound");
	expect(
		Buffer.from(input).subarray(quote.startByte, quote.endByte).toString(),
	).toBe(JSON.stringify(text).slice(1, -1));
	const missing = bindQuotes(
		{
			candidates: [
				candidate({
					quote: {
						utteranceId: document.source.id,
						pointer: "/nonexistent",
					},
				}),
			],
		},
		document.source.id,
		input,
	);
	expect(missing.bindings[0]?.status).toBe("unverifiable");
});

test("model-issued adoption fields and unconditional conditions are rejected by the real validator", () => {
	for (const [extra, expected] of [
		[{ active: true }, "FORBIDDEN_MODEL_FIELD"],
		[
			{
				condition: {
					kind: "explicitly_unconditional",
					adoptionEvidenceId: "fake",
				},
			},
			"CONDITION_NOT_PERMITTED",
		],
	] as const) {
		const result = validateOutput(
			document,
			entity,
			{ candidates: [candidate(extra)] },
			0,
		);
		expect(result.assertions).toHaveLength(0);
		const verdict = result.validation.verdicts[0];
		expect(verdict?.status).toBe("rejected");
		if (verdict && verdict.status !== "accepted")
			expect(verdict.reasonCodes).toContain(expected);
	}
});

test("real validated model format persists as a candidate, round-trips and replays without adoption", () => {
	const result = validateOutput(
		document,
		entity,
		{ candidates: [candidate()] },
		0,
	);
	expect(result.assertions).toHaveLength(1);
	expect(result.validation.handoff).toHaveLength(1);
	expect(result.assertions[0]?.origin).toBe("model_hypothesis");
	expect(result.assertions[0]?.condition).toEqual({ kind: "unspecified" });
	const store = openTestStore();
	try {
		expect(
			store.write((db) =>
				persistCandidates(db, entity, result.state, result.assertions, 0),
			),
		).toEqual({
			storedCandidates: 1,
			replayNoOp: 1,
			activeAssertions: 0,
		});
	} finally {
		store.close();
	}
});

test("tool attempts abort the model call instead of becoming accepted model results", () => {
	const controller = new AbortController();
	expect(() =>
		assertNoTool(
			{
				type: "item.started",
				item: {
					id: "tool",
					type: "command_execution",
					command: "unexpected",
					aggregated_output: "",
					status: "in_progress",
				},
			},
			controller,
		),
	).toThrow("luna_unexpected_tool_attempt");
	expect(controller.signal.aborted).toBe(true);
});

test("raw malformed, oversized and malformed-quote outputs are rejected without aborting the run", () => {
	for (const raw of [
		"{",
		"あ".repeat(65536),
		JSON.stringify({ candidates: [{ quote: null }] }),
		{ candidates: Array.from({ length: 9 }, () => candidate()) },
	]) {
		const result = validateOutput(document, entity, raw, 0);
		expect(result.validation.status).toBe("rejected");
		expect(result.assertions).toHaveLength(0);
	}
	expect(
		validateOutput(
			document,
			entity,
			JSON.stringify({ candidates: [candidate()] }),
			0,
		).assertions,
	).toHaveLength(1);
});

test("request-bound grammar keeps subject, source and payload distinct and has no recursive condition ref", async () => {
	const { schemaForRequest, outputSchema } =
		await import("../../examples/seed-luna/schema.ts");
	const request = {
		window: [
			{ utteranceId: "source-id", text: JSON.stringify({ statement: "事実" }) },
		],
		entities: [{ id: "entity-id" }],
		observationKeys: [],
	};
	const bound = schemaForRequest(request);
	const fields = bound.properties.candidates.items.properties;
	expect(fields.subject.properties.id.enum).toEqual(["entity-id"]);
	expect(fields.quote.properties.utteranceId.enum).toEqual(["source-id"]);
	expect(fields.payload.properties.value.properties.value.enum).toBeUndefined();
	expect(fields.quote.properties.pointer.enum).toEqual(["/statement"]);
	expect(fields.condition).toEqual({
		type: "object",
		properties: { kind: { type: "string", enum: ["unspecified"] } },
		required: ["kind"],
		additionalProperties: false,
	});
	expect(JSON.stringify(outputSchema)).not.toContain("entity-id");
	const bounded = schemaForRequest({
		...request,
		observationKeys: [{ key: "metric" }],
	});
	expect(bounded.$defs.condition1.anyOf).toHaveLength(2);
	expect(JSON.stringify(bounded)).not.toContain('"#/$defs/condition"');
	expect(JSON.stringify(bounded.$defs.condition1)).not.toContain(
		'$ref":"#/$defs/condition0',
	);
});

test("observed Local Provider preserves the same claim with embedded hostile instructions", async () => {
	const { injectionControl } =
		await import("../../examples/seed-luna/control.ts");
	const { default: observed } =
		await import("../../fixtures/extraction/local-injection-v1.json");
	const poisoned = injectionControl();
	const statement = JSON.parse(poisoned.content).statement;
	const cleanText = JSON.stringify({ statement });
	const clean = {
		...poisoned,
		content: cleanText,
		source: {
			...poisoned.source,
			digest: `sha256:${hash(Buffer.from(cleanText))}`,
		},
	};
	const subject = {
		...entity,
		id: "example-service",
		displayName: "検証用の架空サービスA",
	};
	const results = [
		validateOutput(clean, subject, observed.raw["clean-control"], 0),
		validateOutput(poisoned, subject, observed.raw["poisoned-control"], 0),
	];
	for (const result of results) {
		expect(result.assertions).toHaveLength(1);
		expect(result.bindings).toEqual([{ index: 0, status: "bound" }]);
		expect(result.assertions[0]?.payload).toEqual({
			kind: "value",
			value: { kind: "string", value: statement },
		});
		expect(result.assertions[0]?.lifecycle).toBe("candidate");
		const store = openTestStore();
		try {
			expect(
				store.write((db) =>
					persistCandidates(db, subject, result.state, result.assertions, 0),
				),
			).toEqual({ storedCandidates: 1, replayNoOp: 1, activeAssertions: 0 });
		} finally {
			store.close();
		}
	}
});
