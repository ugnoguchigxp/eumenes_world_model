import { expect, test } from "bun:test";
import {
	type SourceQuestion,
	packets,
	questions,
	regressions,
	unseenQuestions,
} from "../../examples/operative-sources-comparison/fixtures.ts";
import {
	instructions,
	presentation,
	schemaFor,
	order,
	design,
} from "../../examples/operative-sources-comparison/protocol.ts";
import {
	assess,
	summarize,
} from "../../examples/operative-sources-comparison/results.ts";
import saved from "../../examples/operative-sources-comparison/regressions.json";
import { answerInstructions } from "../../examples/multi-source-comparison/protocol.ts";
import { extractionPrompt } from "../../examples/multi-source-comparison/world.ts";
test("saved retired-source contamination is reproduced even though the calculation audit passes", () => {
	expect(saved.observedFailures).toHaveLength(4);
	for (const f of saved.observedFailures) {
		const c = regressions.find((c) => c.question.id === f.questionId)!;
		const s = assess(c.question, c.context, "baseline", f.raw);
		expect(s.decisionCorrect).toBe(true);
		expect(s.assessmentsCorrect).toBe(true);
		expect(s.grounding?.passed).toBe(true);
		expect(s.retiredSourceLeak).toBe(true);
		expect(s.primaryCorrect).toBe(false);
	}
});
test("candidate changes only instructions; identical schema and evidence retain historical IDs", () => {
	expect(instructions.baseline).toBe(answerInstructions);
	expect(instructions.operative.startsWith(answerInstructions)).toBe(true);
	for (const c of regressions) {
		expect(schemaFor(c.context, "baseline")).toEqual(
			schemaFor(c.context, "operative"),
		);
		const p = presentation(c.question, c.context);
		const altered: SourceQuestion = {
			...c.question,
			retiredOnlySources: ["SENTINEL"],
			expectedAssessments: {},
			expected: {
				decision: "hold",
				governingSources: [],
				reason: "SENTINEL",
			},
		};
		expect(p).toBe(presentation(altered, c.context));
		expect(Object.keys(JSON.parse(p)).sort()).toEqual([
			"asOf",
			"asOfEpochMs",
			"context",
			"observationAvailability",
			"observations",
			"question",
			"synthetic",
		]);
	}
	const c = regressions.find((c) => c.question.id === "DS02")!;
	expect(
		schemaFor(c.context, "operative").properties.governingSources.items.enum,
	).toContain("DS1");
	expect(
		c.context.derivedView?.slice.units.some((u) =>
			u.sources.some((s) => s.id === "DS1"),
		),
	).toBe(false);
});
test("held-out corpus covers effect boundaries, chains, independent old rules and retained policy provisions", () => {
	expect(packets).toHaveLength(4);
	expect(unseenQuestions).toHaveLength(16);
	expect(regressions).toHaveLength(8);
	expect(new Set(questions.map((q) => q.id)).size).toBe(24);
	expect(design.plannedAnswers).toBe(questions.length * 4);
	for (const p of packets) {
		expect(unseenQuestions.filter((q) => q.packet === p.id)).toHaveLength(4);
		expect(Object.keys(JSON.parse(extractionPrompt(p))).sort()).toEqual([
			"documents",
			"entity",
			"observationKeys",
			"synthetic",
		]);
	}
	for (const q of questions) {
		expect(
			q.retiredOnlySources.some((id) =>
				q.expected.governingSources.includes(id),
			),
		).toBe(false);
		expect(
			Object.keys(q.expectedAssessments).every((id) =>
				q.expected.governingSources.includes(id),
			),
		).toBe(true);
	}
	for (const id of ["SP02", "SP03", "SP04"]) {
		const q = questions.find((q) => q.id === id)!;
		expect(q.expected.governingSources).toContain("SP2");
		expect(q.expectedAssessments).not.toHaveProperty("SP2");
	}
	expect(
		questions.find((q) => q.id === "KB04")!.expected.governingSources,
	).toContain("KB8");
	expect(questions.find((q) => q.id === "FL01")!.expectedAssessments).toEqual({
		FL3: "satisfied",
		FL5: "violated",
	});
});
test("missing answers remain in denominators and paired order reverses", () => {
	const summary = summarize([], questions);
	for (const arm of ["baseline", "operative"] as const) {
		expect(summary.all.byArm[arm]!.planned).toBe(48);
		expect(summary.all.byArm[arm]!.answered).toBe(0);
		expect(summary.unseen.byArm[arm]!.planned).toBe(32);
	}
	for (let i = 0; i < questions.length; i++)
		expect(order(i, 0)).toEqual([...order(i, 1)].reverse());
	expect(summary.all.pairs.unanswered).toBe(48);
});

test("real SQLite rebuilds the observed failure inputs with retired claims absent and original sources preserved", async () => {
	const { interpret, persist, contexts } =
		await import("../../examples/multi-source-comparison/world.ts");
	const { openTestStore } = await import("../support/sqlite-store.ts");
	for (const input of saved.rebuildInputs) {
		const material = interpret(input.packet, input.raw);
		for (const id of input.questionIds) {
			const fixture = regressions.find((c) => c.question.id === id)!;
			const store = openTestStore();
			try {
				store.write((db) => persist(db, material, fixture.question.asOf));
				const context = store.read(
					(db) => contexts(db, material, fixture.question).world,
				);
				expect(fixture.context).toEqual(context);
				expect(context.sources.some((s) => s.id === "DS1")).toBe(true);
				expect(
					context.derivedView.slice.units.some((u) =>
						u.sources.some((s) => s.id === "DS1"),
					),
				).toBe(false);
			} finally {
				store.close();
			}
		}
	}
});
