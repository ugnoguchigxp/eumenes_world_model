import { expect, test } from "bun:test";
import { parseGroundedAnswer } from "../../examples/multi-source-comparison/grounding.ts";
import saved from "../../examples/operative-sources-comparison/measured-pairs.json";
import { assess } from "../../examples/operative-sources-comparison/results.ts";
import type { SourceQuestion } from "../../examples/operative-sources-comparison/fixtures.ts";
import type { AnswerContext } from "../../examples/multi-source-comparison/world.ts";
const cases = saved as unknown as {
	question: SourceQuestion;
	context: AnswerContext;
	baseline: string;
	operative: string;
}[];
test("measured instruction-only recovery removes historical citation without changing the permission assessment", () => {
	const c = cases.find((c) => c.question.id === "DS02")!;
	const a = assess(c.question, c.context, "baseline", c.baseline),
		b = assess(c.question, c.context, "operative", c.operative);
	expect(a.retiredSourceLeak).toBe(true);
	expect(a.primaryCorrect).toBe(false);
	expect(b.retiredSourceLeak).toBe(false);
	expect(b.primaryCorrect).toBe(true);
	expect(parseGroundedAnswer(c.baseline).assessments).toEqual(
		parseGroundedAnswer(c.operative).assessments,
	);
});
test("deleting every source with a retired permission claim breaks retained observation policy", () => {
	const c = cases.find((c) => c.question.id === "SP02")!;
	expect(
		assess(c.question, c.context, "operative", c.operative).primaryCorrect,
	).toBe(true);
	expect(
		c.context.derivedView?.slice.units.some((u) =>
			u.sources.some((s) => s.id === "SP2"),
		),
	).toBe(false);
	const wronglyFiltered = JSON.parse(c.operative);
	wronglyFiltered.governingSources = wronglyFiltered.governingSources.filter(
		(id: string) => id !== "SP2",
	);
	const s = assess(
		c.question,
		c.context,
		"operative",
		JSON.stringify(wronglyFiltered),
	);
	expect(s.grounding?.passed).toBe(true);
	expect(s.governingSourcesCorrect).toBe(false);
	expect(s.primaryCorrect).toBe(false);
});
