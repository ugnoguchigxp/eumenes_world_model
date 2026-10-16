import { expect, test } from "bun:test";
import { parseGroundedAnswer } from "../../examples/multi-source-comparison/grounding.ts";
import { answerInstructions } from "../../examples/multi-source-comparison/protocol.ts";
import { auditValidity } from "../../examples/validity-audit-comparison/validity.ts";
import {
	regressions,
	packets,
	questions,
} from "../../examples/source-role-audit-comparison/fixtures.ts";
import {
	auditPrompt,
	validateAudit,
	type RoleAudit,
} from "../../examples/source-role-audit-comparison/audit.ts";
import {
	review,
	inspect,
	reviewPrompt,
} from "../../examples/source-role-audit-comparison/review.ts";
import {
	instructions,
	design,
	order,
} from "../../examples/source-role-audit-comparison/protocol.ts";
import { assess } from "../../examples/source-role-audit-comparison/results.ts";
import { adoption } from "../../examples/source-role-audit-comparison/adoption.ts";
const seed = regressions[0]!;
const response = (raw: string) => ({
	raw,
	inputTokens: 10,
	outputTokens: 2,
	latencyMs: 3,
});
function judgement(raw = seed.seedRaw, ctx = seed.context, excluded = ["DT2"]) {
	return JSON.stringify({
		reviews: parseGroundedAnswer(raw).governingSources.map((sourceId) => ({
			sourceId,
			verdict: excluded.includes(sourceId) ? "inapplicable" : "applicable",
			role: "fixture judgement",
			reason: "Stubbed LLM verdict; not an efficacy test",
			evidence: [
				{
					sourceId,
					quote: JSON.parse(ctx.sources.find((s) => s.id === sourceId)!.text)
						.statement,
				},
			],
		})),
	});
}
test("DT04 remains a real miss of both prior auditors; legitimate observation source is not required to have a permission assessment", () => {
	expect(instructions.initial).toBe(answerInstructions);
	expect(inspect(seed.seedRaw, seed.context).passed).toBe(true);
	expect(auditValidity(seed.seedRaw, seed.context).passed).toBe(true);
	expect(
		assess(seed.question, seed.context, "baseline", seed.seedRaw)
			.primaryCorrect,
	).toBe(false);
	for (const r of regressions.slice(1))
		expect(
			assess(r.question, r.context, "baseline", r.seedRaw).primaryCorrect,
		).toBe(true);
	const measurement = regressions[2]!;
	const a = parseGroundedAnswer(measurement.seedRaw);
	expect(a.governingSources.length).toBeGreaterThan(a.assessments.length);
	expect(
		validateAudit(
			judgement(measurement.seedRaw, measurement.context, []),
			measurement.seedRaw,
			measurement.context,
		).passed,
	).toBe(true);
});
test("auditor gets original evidence and listed IDs only; oracle and answer rationale cannot steer it", () => {
	const p = JSON.parse(auditPrompt(seed.question, seed.context, seed.seedRaw));
	expect(Object.keys(p).sort()).toEqual(["listedSourceIds", "originalInput"]);
	expect(p.originalInput.context.sources).toEqual(seed.context.sources);
	const changed = JSON.stringify({
		...parseGroundedAnswer(seed.seedRaw),
		explanation: "INJECTED_RATIONALE",
		decision: "deny",
		assessments: [],
	});
	expect(auditPrompt(seed.question, seed.context, changed)).toBe(
		auditPrompt(seed.question, seed.context, seed.seedRaw),
	);
	const q = {
		...seed.question,
		expected: {
			decision: "allow" as const,
			governingSources: ["ORACLE"],
			reason: "ORACLE",
		},
		expectedAssessments: {},
	};
	expect(auditPrompt(q, seed.context, seed.seedRaw)).toBe(
		auditPrompt(seed.question, seed.context, seed.seedRaw),
	);
});
test("coverage and literal citations are enforced, but code cannot establish a model verdict's semantic truth", () => {
	const good = judgement();
	expect(validateAudit(good, seed.seedRaw, seed.context).passed).toBe(false);
	const falsePass = judgement(seed.seedRaw, seed.context, []);
	expect(validateAudit(falsePass, seed.seedRaw, seed.context).passed).toBe(
		true,
	);
	for (const mutation of [
		(x: { reviews: RoleAudit["reviews"] }) => x.reviews.pop(),
		(x: { reviews: RoleAudit["reviews"] }) => x.reviews.push(x.reviews[0]!),
		(x: { reviews: RoleAudit["reviews"] }) => {
			x.reviews[0]!.sourceId = "unlisted";
		},
		(x: { reviews: RoleAudit["reviews"] }) => {
			x.reviews[0]!.evidence[0]!.quote = "not in evidence";
		},
		(x: { reviews: RoleAudit["reviews"] }) => {
			x.reviews[0]!.evidence = [];
		},
	]) {
		const x = JSON.parse(good);
		mutation(x);
		expect(() =>
			validateAudit(JSON.stringify(x), seed.seedRaw, seed.context),
		).toThrow();
	}
	const uncertain = JSON.parse(good);
	uncertain.reviews[0].verdict = "uncertain";
	uncertain.reviews[0].evidence = [];
	expect(
		validateAudit(JSON.stringify(uncertain), seed.seedRaw, seed.context).passed,
	).toBe(false);
});
test("equal gates, feedback-only requests, one repair and final audit; passing answer unchanged and errors never silently pass", async () => {
	const audit = validateAudit(judgement(), seed.seedRaw, seed.context);
	const { sourceRoleAudit, ...rest } = JSON.parse(
		reviewPrompt(seed.question, seed.context, seed.seedRaw, "role", audit),
	);
	expect(rest).toEqual(
		JSON.parse(
			reviewPrompt(seed.question, seed.context, seed.seedRaw, "control", audit),
		),
	);
	expect(sourceRoleAudit).toEqual(audit);
	for (const arm of ["control", "role"] as const) {
		const stages: string[] = [];
		let repairs = 0;
		const out = await review(
			seed.question,
			seed.context,
			response(seed.seedRaw),
			arm,
			async (stage) => {
				stages.push(stage);
				return response(judgement());
			},
			async () => {
				repairs++;
				return response(seed.seedRaw);
			},
		);
		expect(stages).toEqual(["initial", "final"]);
		expect(repairs).toBe(1);
		expect(out.accepted).toBe(arm === "control");
		expect(out.inputTokens).toBe(40);
		await expect(
			review(
				seed.question,
				seed.context,
				response(seed.seedRaw),
				arm,
				async () => {
					throw new Error("audit_failed");
				},
				async () => response(seed.seedRaw),
			),
		).rejects.toThrow("audit_failed");
		const r = regressions[2]!;
		const pass = await review(
			r.question,
			r.context,
			response(r.seedRaw),
			arm,
			async () => response(judgement(r.seedRaw, r.context, [])),
			async () => {
				throw new Error("must_not_repair");
			},
		);
		expect(pass.raw).toBe(r.seedRaw);
		expect(pass.repairAttempted).toBe(false);
	}
	expect(questions.length * 2 * 3).toBe(design.plannedEndpoints);
	expect(packets.length + 24 + questions.length * 2 * 5).toBe(design.maxCalls);
	expect(order(0, 0)).toEqual([...order(0, 1)].reverse());
	expect(adoption([]).guardRetained).toBe(false);
});
