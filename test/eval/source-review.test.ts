import { expect, test } from "bun:test";
import {
	regressions,
	questions,
	packets,
	unseenQuestions,
	validateFixtureIdentity,
} from "../../examples/source-review-comparison/fixtures.ts";
import {
	inspect,
	review,
	reviewPrompt,
	type Response,
} from "../../examples/source-review-comparison/review.ts";
import {
	instructions,
	selectionSupplement,
	schemaFor,
	design,
	order,
} from "../../examples/source-review-comparison/protocol.ts";
import { assess } from "../../examples/source-review-comparison/results.ts";
import {
	answerInstructions,
	answerSchemaFor,
} from "../../examples/multi-source-comparison/protocol.ts";
import { instructions as previous } from "../../examples/audit-repair-comparison/protocol.ts";
import { review as gatedReview } from "../../examples/audit-repair-comparison/review.ts";
const response = (raw: string): Response => ({
	raw,
	inputTokens: 10,
	outputTokens: 2,
	latencyMs: 3,
});
test("frozen missed selection passes old audit and old gated review; v5 remains exact", async () => {
	expect(instructions.initial).toBe(answerInstructions);
	expect(instructions.control).toBe(previous.revision);
	expect(instructions.selection).toBe(
		instructions.control + selectionSupplement,
	);
	expect(regressions).toHaveLength(2);
	for (const r of regressions) {
		expect(inspect(r.seedRaw, r.context).passed).toBe(true);
		expect(
			assess(r.question, r.context, "baseline", r.seedRaw).primaryCorrect,
		).toBe(r.expectedCorrect);
		const old = await gatedReview(
			r.question,
			r.context,
			response(r.seedRaw),
			"audit",
			async () => {
				throw new Error("must not call");
			},
		);
		expect(old.raw).toBe(r.seedRaw);
		expect(old.repairAttempted).toBe(false);
		expect(schemaFor(r.context)).toEqual(
			answerSchemaFor(
				r.context.sources.map((s) => s.id),
				r.context.derivedView!.slice.units.map((u) => u.assertionId),
			),
		);
	}
});
test("both review arms run once even after audit pass; audit failure or transport failure cannot be silently accepted", async () => {
	const r = regressions[0]!;
	const initial = response(r.seedRaw);
	const baseline = await review(
		r.question,
		r.context,
		initial,
		"baseline",
		async () => {
			throw new Error("must not call");
		},
	);
	expect(baseline.raw).toBe(initial.raw);
	const seen: unknown[] = [];
	for (const arm of ["control", "selection"] as const) {
		let calls = 0;
		const output = await review(
			r.question,
			r.context,
			initial,
			arm,
			async (prompt, schema) => {
				calls++;
				seen.push({ prompt, schema });
				return response(r.seedRaw);
			},
		);
		expect(calls).toBe(1);
		expect(output.repairAttempted).toBe(true);
		expect(output.accepted).toBe(true);
		expect(assess(r.question, r.context, arm, output.raw).primaryCorrect).toBe(
			false,
		);
		expect(output.inputTokens).toBe(20);
		let failedCalls = 0;
		const failed = await review(
			r.question,
			r.context,
			initial,
			arm,
			async () => {
				failedCalls++;
				return response("{}");
			},
		);
		expect(failedCalls).toBe(1);
		expect(failed.outcome).toBe("rejected");
		expect(failed.accepted).toBe(false);
		expect(failed.raw).toBe("{}");
		await expect(
			review(r.question, r.context, initial, arm, async () => {
				throw new Error("transport failure");
			}),
		).rejects.toThrow("transport failure");
	}
	expect(seen[0]).toEqual(seen[1]);
});
test("review receives original evidence and audit but not oracle; balanced order and planned denominators", () => {
	const r = regressions[0]!;
	const prompt = reviewPrompt(r.question, r.context, r.seedRaw);
	const changed = {
		...r.question,
		expected: {
			decision: "hold" as const,
			governingSources: ["ORACLE_ONLY"],
			reason: "ORACLE_ONLY",
		},
		expectedAssessments: { ORACLE_ONLY: "unknown" as const },
		retiredOnlySources: ["ORACLE_ONLY"],
	};
	expect(reviewPrompt(changed, r.context, r.seedRaw)).toBe(prompt);
	expect(prompt).not.toContain("ORACLE_ONLY");
	const p = JSON.parse(prompt);
	expect(p.previousAnswer).toBe(r.seedRaw);
	expect(p.structuralAudit).toEqual(inspect(r.seedRaw, r.context));
	expect(p.originalInput.context.sources).toEqual(r.context.sources);
	expect(order(0, 0)).toEqual([...order(0, 1)].reverse());
	expect(packets).toHaveLength(4);
	expect(unseenQuestions).toHaveLength(16);
	expect(questions.length * design.repeats * 3).toBe(design.plannedEndpoints);
	expect(
		packets.length + unseenQuestions.length * 2 + questions.length * 4,
	).toBe(design.maxCalls);
	const ids = packets.flatMap((p) => p.documents.map((d) => d.id));
	expect(new Set(ids).size).toBe(ids.length);
	for (const q of unseenQuestions) {
		const docs = packets
			.find((p) => p.id === q.packet)!
			.documents.map((d) => d.id);
		for (const id of [
			...q.expected.governingSources,
			...Object.keys(q.expectedAssessments),
		])
			expect(docs).toContain(id);
	}
});

test("historical and unseen packet identities cannot mix or duplicate endpoints", () => {
	const ids = packets.map((p) => p.id);
	const known = regressions.map((r) => r.question);
	expect(() => validateFixtureIdentity(ids, questions, known)).not.toThrow();
	expect(() =>
		validateFixtureIdentity([...ids, known[0]!.packet], questions, known),
	).toThrow("historical_packet_collision");
	expect(() =>
		validateFixtureIdentity(ids, [...questions, questions[0]!], known),
	).toThrow("duplicate_experiment_identity");
	expect(() =>
		validateFixtureIdentity([...ids, ids[0]!], questions, known),
	).toThrow("duplicate_experiment_identity");
	expect(() => validateFixtureIdentity([], questions, known)).toThrow(
		"unknown_unseen_packet",
	);
});
