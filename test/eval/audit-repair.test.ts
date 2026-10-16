import { expect, test } from "bun:test";
import {
	inspect,
	review,
	reviewPrompt,
	type Response,
} from "../../examples/audit-repair-comparison/review.ts";
import {
	instructions,
	schemaFor,
	order,
	design,
} from "../../examples/audit-repair-comparison/protocol.ts";
import {
	packets,
	questions,
	regressions,
	unseenQuestions,
} from "../../examples/audit-repair-comparison/fixtures.ts";
import {
	answerInstructions,
	answerSchemaFor,
} from "../../examples/multi-source-comparison/protocol.ts";
import {
	assess,
	type Cell,
} from "../../examples/audit-repair-comparison/results.ts";
import { adoption } from "../../examples/audit-repair-comparison/adoption.ts";
const response = (raw: string): Response => ({
	raw,
	inputTokens: 10,
	outputTokens: 2,
	latencyMs: 3,
});
test("historical disagreement failures trigger existing audit, while its false negative remains explicit", () => {
	expect(instructions.initial).toBe(answerInstructions);
	expect(regressions).toHaveLength(8);
	for (const r of regressions) {
		expect(inspect(r.seedRaw, r.context).passed).toBe(!r.expectedTrigger);
		expect(schemaFor(r.context)).toEqual(
			answerSchemaFor(
				r.context.sources.map((s) => s.id),
				r.context.derivedView!.slice.units.map((u) => u.assertionId),
			),
		);
	}
	const missed = regressions.find((r) => r.question.id === "KR07")!;
	expect(
		assess(missed.question, missed.context, "baseline", missed.seedRaw)
			.primaryCorrect,
	).toBe(false);
	expect(inspect(missed.seedRaw, missed.context).passed).toBe(true);
});
test("repair uses at most one shared-evidence revision, accepts only a passing re-audit and never substitutes a failed call", async () => {
	const r = regressions[0]!;
	const good = JSON.stringify({
		governingSources: ["SD3"],
		assessments: [
			{
				sourceId: "SD3",
				result: "satisfied",
				assertionId: "SD3:claim:0",
				overrideReason: null,
			},
		],
		explanation: "SD3が有効で点検完了かつ航程300 m以下。観測250 m。",
		decision: "allow",
	});
	let calls = 0;
	const result = await review(
		r.question,
		r.context,
		response(r.seedRaw),
		"audit",
		async () => {
			calls++;
			return response(good);
		},
	);
	expect(calls).toBe(1);
	expect(result.outcome).toBe("repaired");
	expect(result.accepted).toBe(true);
	expect(result.inputTokens).toBe(20);
	expect(
		assess(r.question, r.context, "audit", result.raw).primaryCorrect,
	).toBe(true);
	const rejected = await review(
		r.question,
		r.context,
		response(r.seedRaw),
		"audit",
		async () => {
			calls++;
			return response(r.seedRaw);
		},
	);
	expect(calls).toBe(2);
	expect(rejected.outcome).toBe("rejected");
	expect(rejected.accepted).toBe(false);
	await expect(
		review(r.question, r.context, response(r.seedRaw), "audit", async () => {
			throw new Error("transport_failure");
		}),
	).rejects.toThrow("transport_failure");
	expect(inspect("not JSON", r.context).passed).toBe(false);
	for (const p of regressions.filter((r) => !r.expectedTrigger))
		for (const arm of ["control", "audit"] as const) {
			const unchanged = await review(
				p.question,
				p.context,
				response(p.seedRaw),
				arm,
				async () => {
					throw new Error("must_not_call");
				},
			);
			expect(unchanged.raw).toBe(p.seedRaw);
			expect(unchanged.repairAttempted).toBe(false);
		}
});
test("control and audit differ only in feedback; oracle and historical origin do not leak into revision input", () => {
	for (const r of regressions) {
		const audit = JSON.parse(
			reviewPrompt(r.question, r.context, r.seedRaw, "audit"),
		);
		const { structuralAudit, ...rest } = audit;
		expect(structuralAudit).toEqual(inspect(r.seedRaw, r.context));
		expect(rest).toEqual(
			JSON.parse(reviewPrompt(r.question, r.context, r.seedRaw, "control")),
		);
		const altered: typeof r.question = {
			...r.question,
			expected: { decision: "deny", governingSources: [], reason: "HIDDEN" },
			expectedAssessments: {},
			retiredOnlySources: ["HIDDEN"],
		};
		expect(reviewPrompt(altered, r.context, r.seedRaw, "audit")).toBe(
			reviewPrompt(r.question, r.context, r.seedRaw, "audit"),
		);
	}
	expect(packets).toHaveLength(4);
	expect(packets.flatMap((p) => p.documents)).toHaveLength(14);
	expect(unseenQuestions).toHaveLength(16);
	expect(questions).toHaveLength(24);
	expect(design.plannedEndpoints).toBe(144);
	expect(design.maxCalls).toBe(124);
	for (let i = 0; i < 24; i++)
		expect(order(i, 0)).toEqual([...order(i, 1)].reverse());
});
test("retention requires unseen gains and preservation; feedback preference needs superiority over equal-budget review", () => {
	expect(adoption([]).retained).toBe(false);
	const cells: Cell[] = questions.flatMap((q) =>
		[0, 1].flatMap((repeat) =>
			(["baseline", "control", "audit"] as const).map((arm) => ({
				questionId: q.id,
				packet: q.packet,
				suite: q.suite,
				repeat,
				arm,
				status: "answered",
				raw: regressions.find((r) => r.question.id === q.id)?.seedRaw ?? "",
				inputTokens: 0,
				outputTokens: 0,
				latencyMs: 0,
				score: {
					primaryCorrect: true,
					decisionCorrect: true,
					governingSourcesCorrect: true,
					assessmentsCorrect: true,
					jointCorrect: true,
					falseAllow: false,
					retiredSourceLeak: false,
				},
			})),
		),
	);
	expect(adoption(cells).retained).toBe(false);
	for (const id of ["CM01", "OS01"])
		cells.find(
			(c) => c.questionId === id && c.repeat === 0 && c.arm === "baseline",
		)!.score!.primaryCorrect = false;
	expect(adoption(cells).retained).toBe(true);
	expect(adoption(cells).preferred).toBe(false);
	cells.find(
		(c) => c.questionId === "CM01" && c.repeat === 0 && c.arm === "control",
	)!.score!.primaryCorrect = false;
	expect(adoption(cells).preferred).toBe(true);
	cells.find(
		(c) => c.questionId === "FL01" && c.repeat === 0 && c.arm === "audit",
	)!.score!.decisionCorrect = false;
	expect(adoption(cells).retained).toBe(false);
});
