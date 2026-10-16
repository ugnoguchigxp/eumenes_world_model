import { expect, test } from "bun:test";
import {
	packets,
	questions,
	at,
	observation,
} from "../../examples/linked-answer-holdout/fixtures.ts";
import {
	packets as previousPackets,
	questions as previousQuestions,
	type Packet,
} from "../../examples/multi-source-comparison/fixtures.ts";
import {
	interpret,
	persist,
	contexts,
	extractionPrompt,
} from "../../examples/multi-source-comparison/world.ts";
import {
	presentation,
	schemaFor,
	order,
} from "../../examples/linked-answer-holdout/protocol.ts";
import {
	assess,
	summarize,
	type Cell,
} from "../../examples/linked-answer-holdout/results.ts";
import { openTestStore } from "../support/sqlite-store.ts";

test("unseen fixtures have 8 distinct packets, 32 predeclared cases, disjoint materials and consistent oracle roles", () => {
	expect(packets).toHaveLength(8);
	expect(questions).toHaveLength(32);
	expect(new Set(questions.map((q) => q.id)).size).toBe(32);
	const oldSources = new Set(
		previousPackets.flatMap((p) => p.documents.map((d) => d.id)),
	);
	for (const p of packets) {
		expect(previousPackets.some((old) => old.id === p.id)).toBe(false);
		expect(questions.filter((q) => q.packet === p.id)).toHaveLength(4);
		for (const d of p.documents) expect(oldSources.has(d.id)).toBe(false);
		const prompt = JSON.parse(extractionPrompt(p));
		expect(Object.keys(prompt).sort()).toEqual([
			"documents",
			"entity",
			"observationKeys",
			"synthetic",
		]);
	}
	for (const q of questions) {
		expect(previousQuestions.some((old) => old.id === q.id)).toBe(false);
		const packet = packets.find((p) => p.id === q.packet)!;
		expect(
			q.expected.governingSources.every((s) =>
				packet.documents.some((d) => d.id === s),
			),
		).toBe(true);
		expect(
			Object.keys(q.expectedAssessments).every((s) =>
				q.expected.governingSources.includes(s),
			),
		).toBe(true);
		const rs = Object.values(q.expectedAssessments);
		const expected = rs.every((r) => r === "satisfied")
			? "allow"
			: rs.every((r) => r === "violated")
				? "deny"
				: "hold";
		expect(q.expected.decision).toBe(expected);
	}
});
function fixture() {
	const packet: Packet = {
		id: "fixture",
		name: "TEST ONLY",
		keys: { ready: "準備済み boolean" },
		documents: [
			{
				id: "TEST-RULE",
				published: new Date(at(1)).toISOString(),
				authority: "TEST ONLY",
				statement: "準備済みなら許可、それ以外は不可。",
			},
		],
	};
	const material = interpret(
		packet,
		JSON.stringify({
			documents: [
				{
					documentId: "TEST-RULE",
					validFrom: null,
					validUntil: null,
					contradicts: [],
					withdrawals: [],
					candidates: [
						{
							subject: { kind: "id", id: "fixture" },
							predicate: "source_claim",
							payload: {
								kind: "value",
								value: {
									kind: "string",
									value: packet.documents[0]!.statement,
								},
							},
							quote: { utteranceId: "TEST-RULE", pointer: "/statement" },
							modality: "asserted",
							condition: {
								kind: "expression",
								expression: {
									kind: "compare",
									key: "ready",
									op: "eq",
									value: { kind: "boolean", value: true },
								},
							},
						},
					],
				},
			],
		}),
	);
	const question = {
		...questions[0]!,
		packet: "fixture",
		id: "test-only",
		observations: [observation("ready", true)],
		expected: {
			decision: "allow" as const,
			governingSources: ["TEST-RULE"],
			reason: "ORACLE-NOT-FOR-MODEL",
		},
		expectedAssessments: { "TEST-RULE": "satisfied" as const },
	};
	const store = openTestStore();
	try {
		store.write((db) => persist(db, material, at(16)));
		return {
			question,
			context: store.read((db) => contexts(db, material, question)).world,
		};
	} finally {
		store.close();
	}
}

test("both arms contain exactly the same data and calculations; joining is lossless and no oracle enters requests", () => {
	const { question, context } = fixture();
	const legacy = JSON.parse(presentation(question, context, "legacy"));
	const linked = JSON.parse(presentation(question, context, "linked"));
	const expected = structuredClone(legacy.context.derivedView);
	const actual = linked.context.derivedView;
	const evaluations = actual.slice.units.map((u: Record<string, unknown>) => {
		const evaluation = u["conditionEvaluation"];
		delete u["conditionEvaluation"];
		return evaluation;
	});
	expect(actual.slice).toEqual(expected.slice);
	expect(evaluations).toEqual(expected.evaluations);
	delete legacy.context;
	delete linked.context;
	expect(legacy).toEqual(linked);
	for (const arm of ["legacy", "linked"] as const) {
		const altered = {
			...question,
			expected: {
				decision: "deny" as const,
				governingSources: ["SECRET"],
				reason: "CHANGED",
			},
			expectedAssessments: { SECRET: "violated" as const },
		};
		expect(presentation(question, context, arm)).toBe(
			presentation(altered, context, arm),
		);
		expect(presentation(question, context, arm)).not.toContain(
			"ORACLE-NOT-FOR-MODEL",
		);
		const schema = schemaFor(context, arm);
		expect(schema.properties.decision.enum).toEqual(["allow", "deny", "hold"]);
	}
});

test("assessments are checked against the frozen permission oracle, not just self-consistency", () => {
	const { question, context } = fixture();
	const good = {
		decision: "allow",
		governingSources: ["TEST-RULE"],
		explanation: "準備済み。",
		assessments: [
			{
				sourceId: "TEST-RULE",
				result: "satisfied",
				assertionId: "TEST-RULE:claim:0",
				overrideReason: null,
			},
		],
	};
	const result = assess(question, context, "linked", JSON.stringify(good));
	expect(result.assessmentsCorrect).toBe(true);
	expect(result.grounding?.passed).toBe(true);
	const missing = assess(
		question,
		context,
		"linked",
		JSON.stringify({ ...good, assessments: [] }),
	);
	expect(missing.decisionCorrect).toBe(true);
	expect(missing.assessmentsCorrect).toBe(false);
	expect(missing.grounding?.passed).toBe(false);
	const miscopied = assess(
		question,
		context,
		"linked",
		JSON.stringify({
			...good,
			decision: "deny",
			assessments: [{ ...good.assessments[0], result: "violated" }],
		}),
	);
	expect(miscopied.grounding?.decisionConsistent).toBe(true);
	expect(miscopied.grounding?.calculationMismatches).toBe(1);
	expect(miscopied.decisionCorrect).toBe(false);
});

test("balanced order swaps each pair; summaries preserve failed and missing cases in planned denominators", () => {
	for (let i = 0; i < 32; i++)
		expect(order(i, 0)).toEqual([...order(i, 1)].reverse());
	const q = questions[0]!;
	const failed: Cell = {
		questionId: q.id,
		packet: q.packet,
		repeat: 0,
		arm: "legacy",
		status: "failed",
		error: "timeout",
		decisionCorrect: false,
		governingSourcesCorrect: false,
		jointCorrect: false,
		falseAllow: false,
		inputTokens: 0,
		outputTokens: 0,
		latencyMs: 0,
	};
	const summary = summarize([failed], questions);
	expect(summary.byArm["legacy"]!.planned).toBe(64);
	expect(summary.byArm["legacy"]!.failed).toBe(1);
	expect(summary.byArm["legacy"]!.decisionCorrect).toBe(0);
	expect(summary.pairs.unanswered).toBe(64);
});
