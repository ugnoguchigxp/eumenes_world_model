import { expect, test } from "bun:test";
import {
	instant,
	packets,
	questions,
	type Packet,
	type Question,
} from "../../examples/multi-source-comparison/fixtures.ts";
import {
	answerPrompt,
	comparisonChecks,
	contexts,
	documentInputs,
	extractionPrompt,
	interpret,
	linkedContext,
	persist,
} from "../../examples/multi-source-comparison/world.ts";
import {
	order,
	parseAnswer,
	score,
	summarize,
} from "../../examples/multi-source-comparison/results.ts";
import { openTestStore } from "../support/sqlite-store.ts";
import { answerSchemaFor } from "../../examples/multi-source-comparison/protocol.ts";
import {
	auditGrounding,
	parseGroundedAnswer,
	type GroundedAnswer,
} from "../../examples/multi-source-comparison/grounding.ts";
import priorExplanationError from "../../examples/multi-source-comparison/prior-explanation-error.json";
import type { ConditionSpec } from "../../src/index.ts";

const packet: Packet = {
	id: "fixture-policy",
	name: "TEST ONLY",
	keys: { ready: "boolean", frozen: "boolean" },
	documents: [
		{
			id: "old",
			authority: "owner",
			published: new Date(instant(1)).toISOString(),
			statement: "readyなら可。",
		},
		{
			id: "new",
			authority: "owner",
			published: new Date(instant(2)).toISOString(),
			statement: "10月20日からoldを撤回。readyかつfrozenでない場合に可。",
		},
	],
};
function fixtureOutput() {
	return {
		documents: packet.documents.map((doc, index) => ({
			documentId: doc.id,
			candidates: [
				{
					subject: { kind: "id", id: packet.id },
					predicate: "source_claim",
					payload: {
						kind: "value",
						value: { kind: "string", value: doc.statement },
					},
					quote: { utteranceId: doc.id, pointer: "/statement" },
					modality: "asserted",
					condition: {
						kind: "expression",
						expression:
							index === 0
								? {
										kind: "compare",
										key: "ready",
										op: "eq",
										value: { kind: "boolean", value: true },
									}
								: {
										kind: "all",
										items: [
											{
												kind: "compare",
												key: "ready",
												op: "eq",
												value: { kind: "boolean", value: true },
											},
											{
												kind: "not",
												item: {
													kind: "compare",
													key: "frozen",
													op: "eq",
													value: { kind: "boolean", value: true },
												},
											},
										],
									},
					},
				},
			],
			validFrom: new Date(instant(index === 0 ? 1 : 20)).toISOString(),
			validUntil: index === 0 ? new Date(instant(20)).toISOString() : null,
			contradicts: [],
			withdrawals:
				index === 0
					? []
					: [
							{
								target: "old",
								effectiveAt: new Date(instant(20)).toISOString(),
							},
						],
		})),
	};
}
function question(day: number): Question {
	return {
		id: "SECRET-QUESTION-ID",
		packet: packet.id,
		asOf: instant(day),
		question: "可否を判断して",
		observations: [
			{
				observationId: "ready",
				key: "ready",
				value: { kind: "boolean", value: true },
				observedAt: instant(day),
				version: "v1",
				priority: 1,
			},
		],
		expected: {
			decision: "hold",
			governingSources: ["new"],
			reason: "SECRET-ORACLE",
		},
	};
}

test("protocol has 16 multi-source cases and balanced order; oracle and downstream questions never enter extraction", () => {
	expect(packets.length).toBe(4);
	expect(questions.length).toBe(16);
	for (const packet of packets) {
		expect(packet.documents.length).toBeGreaterThanOrEqual(3);
		const input = JSON.parse(extractionPrompt(packet));
		expect(Object.keys(input)).toEqual([
			"synthetic",
			"entity",
			"observationKeys",
			"documents",
		]);
		expect(input).not.toHaveProperty("expected");
		for (const doc of documentInputs(packet))
			expect(JSON.parse(doc.content).id).toBe(doc.recordId);
	}
	for (let i = 0; i < 16; i++)
		expect(order(i, 0)).toEqual([...order(i, 1)].reverse());
});

test("model metadata must point to an earlier real source and exact quote; no fabricated conflict targets or withdrawals", () => {
	const raw = fixtureOutput();
	expect(interpret(packet, JSON.stringify(raw)).items).toHaveLength(2);
	const missing = structuredClone(raw);
	missing.documents.pop();
	expect(() => interpret(packet, JSON.stringify(missing))).toThrow(
		"document_count",
	);
	const badQuote = structuredClone(raw);
	badQuote.documents[0]!.candidates[0]!.quote.pointer = "/not-present";
	expect(() => interpret(packet, JSON.stringify(badQuote))).toThrow(
		"not_one_valid_candidate",
	);
	const badTarget = JSON.parse(JSON.stringify(raw));
	badTarget.documents[1].contradicts = ["fabricated"];
	expect(() => interpret(packet, JSON.stringify(badTarget))).toThrow(
		"conflict_reference",
	);
	badTarget.documents[1].contradicts = [];
	badTarget.documents[1].withdrawals[0].target = "fabricated";
	expect(() => interpret(packet, JSON.stringify(badTarget))).toThrow(
		"withdrawal_target",
	);
});

test("real SQLite preserves the old rule until effect, retracts exactly at effect, keeps history and replay, leaves NOT unknown", () => {
	const material = interpret(packet, JSON.stringify(fixtureOutput()));
	for (const day of [16, 20]) {
		const store = openTestStore();
		try {
			const history = store.write((db) => persist(db, material, instant(day)));
			const view = store.read((db) => contexts(db, material, question(day)));
			expect(view.raw.sources).toEqual(view.world.sources);
			expect(view.raw.observationKeys).toEqual(packet.keys);
			expect(view.world.observationKeys).toEqual(view.raw.observationKeys);
			expect(view.raw.derivedView).toBeNull();
			const derived = view.world.derivedView;
			expect(derived.slice.units.every((u) => u.status === "candidate")).toBe(
				true,
			);
			expect(derived.slice.completeness.complete).toBe(true);
			const old = history.find((h) => h.documentId === "old")!.revisions;
			if (day === 16) {
				expect(old.map((r) => r.lifecycle)).toEqual(["candidate"]);
				expect(derived.slice.units).toHaveLength(2);
				expect(derived.evaluations.map((e) => e.result)).toEqual([
					"violated",
					"satisfied",
				]);
				expect(derived.evaluations[0]!.reasons).toContain("CLAIM_NOT_VALID");
			} else {
				// Retraction stops the old row as well as writing the new head.
				expect(old.map((r) => r.lifecycle)).toEqual(["retracted", "retracted"]);
				expect(old.map((r) => r.revision)).toEqual([2, 1]);
				expect(old[0]!.payload).toEqual(material.items[0]!.assertion.payload);
				expect(derived.slice.units).toHaveLength(1);
				expect(derived.evaluations[0]!.result).toBe("unknown");
				expect(derived.evaluations[0]!.reasons).toContain("NO_OBSERVATION");
			}
			const prompt = answerPrompt(question(day), view.world);
			const linked = linkedContext(view.world);
			if (!linked.derivedView) throw new Error("fixture_missing_world");
			expect(linked.derivedView.slice.digest).toBe(derived.slice.digest);
			for (const unit of linked.derivedView.slice.units)
				expect(unit.conditionEvaluation).toEqual(
					derived.evaluations.find((e) => e.assertionId === unit.assertionId)!,
				);
			expect(JSON.parse(prompt).asOfEpochMs).toBe(instant(day));
			expect(JSON.parse(prompt).observations[0].observedAtIso).toBe(
				new Date(instant(day)).toISOString(),
			);
			expect(prompt).not.toContain("SECRET-ORACLE");
			expect(prompt).not.toContain("SECRET-QUESTION-ID");
		} finally {
			store.close();
		}
	}
});

test("native projection preserves one-sided model conflict as symmetric refutations without adoption", () => {
	const output = fixtureOutput();
	const raw = JSON.parse(JSON.stringify(output));
	raw.documents[1].withdrawals = [];
	raw.documents[1].contradicts = ["old"];
	const material = interpret(packet, JSON.stringify(raw));
	const store = openTestStore();
	try {
		store.write((db) => persist(db, material, instant(20)));
		const view = store.read((db) => contexts(db, material, question(20)));
		expect(view.world.derivedView.slice.units).toHaveLength(2);
		for (const unit of view.world.derivedView.slice.units)
			expect(unit.refutations).toHaveLength(1);
	} finally {
		store.close();
	}
});

test("exact decisions and unordered source sets score independently, always-hold and wrong sources cannot pass", () => {
	const worldSchema = answerSchemaFor(["a", "b"], ["claim-a", "claim-b"]);
	expect(
		worldSchema.properties.assessments.items.properties.assertionId,
	).toEqual({ type: "string", enum: ["claim-a", "claim-b"] });
	expect(
		answerSchemaFor(["a", "b"]).properties.assessments.items.properties
			.assertionId,
	).toEqual({ type: "null" });
	expect(worldSchema.properties.decision.enum).toEqual([
		"allow",
		"deny",
		"hold",
	]);
	expect(
		worldSchema.properties.assessments.items.properties.result.enum,
	).toEqual(["satisfied", "violated", "unknown"]);
	expect(
		Object.keys(worldSchema.properties.assessments.items.properties),
	).not.toContain("basis");
	expect(Object.keys(answerSchemaFor(["a", "b"]).properties)).toEqual([
		"governingSources",
		"assessments",
		"explanation",
		"decision",
	]);
	expect(
		answerSchemaFor(["a", "b"]).properties.assessments.items.properties.sourceId
			.enum,
	).toEqual(["a", "b"]);
	expect(
		answerSchemaFor(["a", "b"]).properties.governingSources.items.enum,
	).toEqual(["a", "b"]);
	const q = questions[0]!;
	const wrong = parseAnswer(
		JSON.stringify({
			decision: "hold",
			governingSources: q.expected.governingSources,
			explanation: "不明",
		}),
	);
	expect(score(q, wrong)).toEqual({
		decisionCorrect: false,
		governingSourcesCorrect: true,
		jointCorrect: false,
	});
	expect(
		score(q, {
			...wrong,
			decision: q.expected.decision,
			governingSources: ["D1"],
		}).jointCorrect,
	).toBe(false);
	expect(() =>
		parseAnswer(
			'{"decision":"allow","governingSources":["a","a"],"explanation":"x"}',
		),
	).toThrow();
	expect(summarize([]).pairs).toEqual({
		better: 0,
		worse: 0,
		bothCorrect: 0,
		bothWrong: 0,
		incomplete: 0,
	});
});

test("unknown calculations cannot silently become allow; audit records the mismatch without changing the model answer", () => {
	const material = interpret(packet, JSON.stringify(fixtureOutput()));
	const store = openTestStore();
	try {
		store.write((db) => persist(db, material, instant(20)));
		const view = store.read((db) => contexts(db, material, question(20)));
		const answer: GroundedAnswer = {
			decision: "allow",
			governingSources: ["new"],
			explanation: "必要な観測がなく保留。",
			assessments: [
				{
					sourceId: "new",
					result: "unknown",
					assertionId: "new:claim:0",
					overrideReason: null,
				},
			],
		};
		const before = JSON.stringify(answer);
		const audit = auditGrounding(parseGroundedAnswer(before), view.world);
		expect(audit.comparedCalculations).toBe(1);
		expect(audit.calculationMismatches).toBe(0);
		expect(audit.decisionConsistent).toBe(false);
		expect(audit.issues).toContain("decision_assessment_mismatch");
		expect(JSON.stringify(answer)).toBe(before);
		expect(
			auditGrounding({ ...answer, decision: "hold" }, view.world).passed,
		).toBe(true);
	} finally {
		store.close();
	}
});

test("a model's self-consistent deny still fails when it miscopies satisfied as violated; overrides remain visible", () => {
	const material = interpret(packet, JSON.stringify(fixtureOutput()));
	const store = openTestStore();
	try {
		store.write((db) => persist(db, material, instant(20)));
		const probe = question(20);
		probe.observations.push({
			observationId: "frozen",
			key: "frozen",
			value: { kind: "boolean", value: false },
			observedAt: probe.asOf,
			version: "v1",
			priority: 1,
		});
		const view = store.read((db) => contexts(db, material, probe));
		expect(view.world.derivedView.evaluations[0]!.result).toBe("satisfied");
		const answer: GroundedAnswer = {
			decision: "deny",
			governingSources: ["new"],
			explanation: "不成立と判断。",
			assessments: [
				{
					sourceId: "new",
					result: "violated",
					assertionId: "new:claim:0",
					overrideReason: null,
				},
			],
		};
		const audit = auditGrounding(answer, view.world);
		expect(audit.decisionConsistent).toBe(true);
		expect(audit.calculationMismatches).toBe(1);
		expect(audit.passed).toBe(false);
		const override: GroundedAnswer = {
			...answer,
			assessments: [
				{
					...answer.assessments[0]!,
					overrideReason: "表現が原文を再現していないとモデルが主張。",
				},
			],
		};
		expect(auditGrounding(override, view.world).overrides).toEqual(["new"]);
		expect(auditGrounding(override, view.world).passed).toBe(false);
		expect(
			auditGrounding({ ...answer, assessments: [] }, view.world).issues,
		).toContain("missing_permission_assessment");
	} finally {
		store.close();
	}
});

test("a coherent raw answer can still be semantically wrong: the receipt audit never replaces the frozen oracle", () => {
	const packet = packets.find((packet) => packet.id === "research")!;
	const question = questions.find((question) => question.id === "R02")!;
	const raw = {
		sources: documentInputs(packet).map((document) => ({
			id: document.recordId,
			ref: document.source,
			text: document.content,
		})),
		observationKeys: packet.keys,
		derivedView: null,
	};
	// Reproduces the observed failure: missing encryption is mistaken for an
	// unresolved OR even though onsite=true. Source interpretation is NOT code.
	const answer: GroundedAnswer = {
		decision: "hold",
		governingSources: ["R2"],
		explanation: "暗号化の観測がないため不明と判断。",
		assessments: [
			{
				sourceId: "R2",
				result: "unknown",
				assertionId: null,
				overrideReason: null,
			},
		],
	};
	expect(auditGrounding(answer, raw).passed).toBe(true);
	expect(score(question, answer).decisionCorrect).toBe(false);
});

test("atomic evidence distinguishes a rule literal, missing observation and observed false without scenario-specific keys", () => {
	for (const key of ["frozen", "arbitrary-renamed-signal"]) {
		const probe = question(20);
		const condition: ConditionSpec = {
			kind: "expression",
			expression: {
				kind: "not",
				item: {
					kind: "compare",
					key,
					op: "eq",
					value: { kind: "boolean", value: true },
				},
			},
		};
		const missing = comparisonChecks(condition, probe)[0]!;
		expect(missing.path).toBe("/expression/item");
		expect(missing.providedObservationIds).toEqual([]);
		expect(missing.evaluation).toEqual({
			result: "unknown",
			reasons: ["NO_OBSERVATION"],
		});
		probe.observations.push({
			observationId: "actual-signal",
			key,
			value: { kind: "boolean", value: false },
			observedAt: probe.asOf,
			version: "v1",
			priority: 1,
		});
		const observed = comparisonChecks(condition, probe)[0]!;
		expect(observed.providedObservationIds).toEqual(["actual-signal"]);
		expect(observed.evaluation.result).toBe("violated");
		// Leaf is before NOT; it must not be mistaken for the complete rule.
		const material = interpret(packet, JSON.stringify(fixtureOutput()));
		const store = openTestStore();
		try {
			store.write((db) => persist(db, material, probe.asOf));
			const view = store.read((db) => contexts(db, material, probe));
			const rawPrompt = JSON.parse(answerPrompt(probe, view.raw));
			const worldPrompt = JSON.parse(answerPrompt(probe, view.world));
			expect(rawPrompt.observationAvailability).toEqual(
				worldPrompt.observationAvailability,
			);
			expect(rawPrompt.observations).toEqual(worldPrompt.observations);
			const presented = worldPrompt.context.derivedView.slice.units[0];
			expect(presented.conditionEvaluation).toEqual(
				view.world.derivedView.evaluations[0],
			);
			if (key === "frozen") {
				expect(presented.conditionEvaluation.result).toBe("satisfied");
				expect(rawPrompt.observationAvailability.frozen).toEqual([
					"actual-signal",
				]);
			} else expect(rawPrompt.observationAvailability.frozen).toEqual([]);
			expect(view.world.derivedView.slice.units[0]).not.toHaveProperty(
				"comparisonChecks",
			);
		} finally {
			store.close();
		}
		probe.observations[1] = {
			...probe.observations[1]!,
			observedAt: probe.asOf - 3_600_001,
		};
		expect(comparisonChecks(condition, probe)[0]!.evaluation.reasons).toEqual([
			"STALE_OBSERVATION",
		]);
		probe.observations[1] = {
			...probe.observations[1]!,
			observedAt: probe.asOf,
		};
		probe.observations.push({
			...probe.observations[1]!,
			observationId: "conflicting",
			value: { kind: "boolean", value: true },
		});
		expect(comparisonChecks(condition, probe)[0]!.evaluation.reasons).toEqual([
			"CONFLICTING_OBSERVATIONS",
		]);
	}
});

test("frozen actual explanation failure preserves the oracle and demonstrates why structural audits cannot certify prose", () => {
	const probe = questions.find((q) => q.id === "D04")!;
	// A change to this question must not silently erase the real regression.
	expect<unknown>(probe).toEqual(priorExplanationError.question);
	expect(
		probe.observations.some((observation) => observation.key === "freeze"),
	).toBe(false);
	const answer = parseGroundedAnswer(
		JSON.stringify(priorExplanationError.answer),
	);
	expect(score(probe, answer).jointCorrect).toBe(true);
	expect(answer.assessments[0]!.overrideReason).not.toBeNull();
	// This sentence is deliberately false despite a correct decision: semantic
	// review of the original evidence remains necessary, with or without receipts.
	expect(answer.explanation).toContain("freeze=false");
});
