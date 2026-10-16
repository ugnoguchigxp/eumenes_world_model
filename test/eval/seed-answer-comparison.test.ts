import { expect, test } from "bun:test";
import {
	answerPrompt,
	contexts,
} from "../../examples/seed-answer-comparison/material.ts";
import {
	arms,
	type Question,
} from "../../examples/seed-answer-comparison/protocol.ts";
import {
	judgeMapping,
	order,
	parseAnswer,
	parseJudgement,
	summarize,
	type Grade,
	type Judgement,
} from "../../examples/seed-answer-comparison/results.ts";
import { hash, seedScope, type SeedDocument } from "../../eval/seed/corpus.ts";
import {
	persistCandidates,
	validateOutput,
} from "../../examples/seed-luna/pipeline.ts";
import { openTestStore } from "../support/sqlite-store.ts";
import type { Entity } from "../../src/index.ts";

test("answer call order is balanced and judge labels independently cover all three arms", () => {
	const first: Record<string, number> = {};
	for (let repeat = 0; repeat < 2; repeat++)
		for (let index = 0; index < 12; index++) {
			const sequence = order(index, repeat);
			expect([...sequence].sort()).toEqual([...arms].sort());
			first[sequence[0]!] = (first[sequence[0]!] ?? 0) + 1;
			const mapping = judgeMapping(index, repeat);
			expect(Object.keys(mapping)).toEqual(["A", "B", "C"]);
			expect(Object.values(mapping).sort()).toEqual([...arms].sort());
		}
	expect(Object.values(first)).toEqual([8, 8, 8]);
});

const grade = (extra: Partial<Grade> = {}): Grade => ({
	accuracy: 2,
	completeness: 2,
	scope: 2,
	calibration: 2,
	rationale: "fixture",
	uncertain: false,
	...extra,
});
test("blind labels are decoded without changing scores; malformed or duplicate labels fail", () => {
	const mapping = { A: "world-seed", B: "no-seed", C: "raw-seed" } as const;
	const assessment = [
		{ label: "A", ...grade() },
		{ label: "B", ...grade({ completeness: 0 }) },
		{ label: "C", ...grade({ scope: 1 }) },
	];
	const result = parseJudgement(
		JSON.stringify({ assessments: assessment }),
		mapping,
	);
	expect(result["no-seed"].completeness).toBe(0);
	expect(result["world-seed"].scope).toBe(2);
	expect(() =>
		parseJudgement(
			JSON.stringify({
				assessments: [assessment[0], assessment[0], assessment[2]],
			}),
			mapping,
		),
	).toThrow();
	expect(() =>
		parseJudgement(
			JSON.stringify({
				assessments: [
					{ ...assessment[0], accuracy: 3 },
					assessment[1],
					assessment[2],
				],
			}),
			mapping,
		),
	).toThrow();
});

test("an axis regression is worse despite a higher total; uncertainty excludes a pair", () => {
	const records: Judgement[] = [
		{
			questionId: "q1",
			repeat: 0,
			mapping: {},
			grades: {
				"no-seed": grade({ completeness: 0 }),
				"raw-seed": grade(),
				"world-seed": grade({ scope: 1 }),
			},
		},
		{
			questionId: "q2",
			repeat: 0,
			mapping: {},
			grades: {
				"no-seed": grade(),
				"raw-seed": grade(),
				"world-seed": grade({ uncertain: true }),
			},
		},
	];
	const result = summarize([], records);
	const pair = result.comparisons.find(
		(item) => item.from === "no-seed" && item.to === "world-seed",
	)!;
	expect(pair.worse).toBe(1);
	expect(pair.incomparable).toBe(1);
	expect(pair.meanDeltaOutOf8).toBe(1);
	expect(result.byArm["world-seed"]?.scored).toBe(1);
});

test("no citations in a prior-knowledge answer do not change the semantic score", () => {
	const record: Judgement = {
		questionId: "q",
		repeat: 0,
		mapping: {},
		grades: { "no-seed": grade(), "raw-seed": grade(), "world-seed": grade() },
	};
	const result = summarize(
		[
			{
				questionId: "q",
				repeat: 0,
				arm: "no-seed",
				answer: { answer: "回答", citations: [], needsMoreInformation: false },
				latencyMs: 1,
				inputTokens: 1,
				outputTokens: 1,
				citationsValid: true,
			},
		],
		[record],
	);
	expect(result.byArm["no-seed"]?.meanScoreOutOf8).toBe(8);
	expect(result.byArm["no-seed"]?.answersWithCitations).toBe(0);
	expect(() =>
		parseAnswer('{"answer":"","citations":[],"needsMoreInformation":false}'),
	).toThrow();
});

test("real SQLite World context keeps raw evidence identical, no-seed empty, gold hidden and candidate status intact", () => {
	const content = JSON.stringify({
		record: { claim: { source_text: "架空の資格期間は10年以上必要。" } },
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
		id: "entity",
		scope: seedScope,
		revision: 1,
		displayName: "架空資格",
		aliases: [],
		externalRefs: [],
	};
	const checked = validateOutput(
		document,
		entity,
		{
			candidates: [
				{
					subject: { kind: "id", id: entity.id },
					predicate: "source_claim",
					payload: {
						kind: "value",
						value: { kind: "string", value: "架空の資格期間は10年以上必要。" },
					},
					quote: {
						utteranceId: document.source.id,
						pointer: "/record/claim/source_text",
					},
					modality: "asserted",
					condition: {
						kind: "expression",
						expression: {
							kind: "compare",
							key: "years",
							op: "gte",
							value: { kind: "number", value: 10, unit: "year" },
						},
					},
				},
			],
		},
		0,
	);
	const question: Question = {
		id: "fixture-question",
		recordId: "fixture",
		group: "L",
		question: "8年で満たすか？",
		expected: "SECRET-GOLD",
		facts: [{ key: "years", value: 8, unit: "year" }],
	};
	const store = openTestStore();
	try {
		store.write((db) =>
			persistCandidates(db, entity, checked.state, checked.assertions, 0),
		);
		const value = store.read((db) =>
			contexts(db, question, { document, entity, checked }, 0),
		);
		const plain = JSON.parse(JSON.stringify(value["raw-seed"]));
		const world = JSON.parse(JSON.stringify(value["world-seed"]));
		expect(world.sources).toEqual(plain.sources);
		expect(value["no-seed"]).toEqual({ sources: [], derivedView: null });
		expect(world.derivedView.slice.units[0].status).toBe("candidate");
		expect(world.derivedView.conditionEvaluation[0].result).toBe("violated");
		const prompt = answerPrompt(question, value["world-seed"]);
		expect(prompt).not.toContain("SECRET-GOLD");
		expect(prompt).not.toContain("fixture-question");
		expect(Object.keys(JSON.parse(prompt))).toEqual([
			"referenceDate",
			"question",
			"scenarioFacts",
			"context",
		]);
	} finally {
		store.close();
	}
});
