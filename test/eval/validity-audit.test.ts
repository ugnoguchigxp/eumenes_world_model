import { expect, test } from "bun:test";
import { evaluateConditions } from "../../src/index.ts";
import { parseGroundedAnswer } from "../../examples/multi-source-comparison/grounding.ts";
import { answerInstructions } from "../../examples/multi-source-comparison/protocol.ts";
import {
	regressions,
	packets,
	questions,
	unseenQuestions,
} from "../../examples/validity-audit-comparison/fixtures.ts";
import { auditValidity } from "../../examples/validity-audit-comparison/validity.ts";
import {
	inspect,
	review,
	reviewPrompt,
	type Response,
} from "../../examples/validity-audit-comparison/review.ts";
import {
	instructions,
	design,
	order,
	schemaFor,
} from "../../examples/validity-audit-comparison/protocol.ts";
import { assess } from "../../examples/validity-audit-comparison/results.ts";
import { adoption } from "../../examples/validity-audit-comparison/adoption.ts";
const response = (raw: string): Response => ({
	raw,
	inputTokens: 10,
	outputTokens: 2,
	latencyMs: 3,
});
test("old auditor misses all four temporal seeds; native validity catches them without classifying explanation or measurement sources", () => {
	expect(instructions.initial).toBe(answerInstructions);
	expect(regressions).toHaveLength(6);
	for (const r of regressions) {
		expect(inspect(r.seedRaw, r.context).passed).toBe(true);
		const v = auditValidity(r.seedRaw, r.context);
		expect(v.invalidClaims.length > 0).toBe(r.expectedInvalid);
		expect(v.passed).toBe(!r.expectedInvalid);
		expect(
			assess(r.question, r.context, "baseline", r.seedRaw).primaryCorrect,
		).toBe(!r.expectedInvalid);
	}
	// VT05 cites a retained measurement chapter, VT06 has prose-only false date wording.
	// Neither is a selected permission assessment with a CLAIM_NOT_VALID calculation.
	for (const r of regressions.slice(4))
		expect(auditValidity(r.seedRaw, r.context).passed).toBe(true);
});
test("native inclusive start and exclusive end checks work under opaque ID renaming, while unknown validity is not falsely treated as out of period", () => {
	const r = regressions[0]!;
	const ctx = structuredClone(r.context);
	const a = parseGroundedAnswer(r.seedRaw).assessments[0]!;
	const unit = ctx.derivedView!.slice.units.find(
		(u) => u.assertionId === a.assertionId,
	)!;
	const times = [999, 1000, 1999, 2000, 2001];
	const period = {
		kind: "period",
		precision: "exact",
		original: "test period",
		start: { earliest: 1000, latest: 1000 },
		end: { earliest: 2000, latest: 2000 },
	};
	for (const asOf of times) {
		const e = evaluateConditions({
			contractVersion: 1,
			asOf,
			authorized: true,
			maxAgeMs: 3600000,
			condition: { kind: "unspecified" },
			validTime: period,
			observations: [],
		});
		if (!e.ok) throw new Error("unexpected_invalid_native_input");
		ctx.derivedView!.evaluations = [
			{ assertionId: unit.assertionId, ...e.value },
		];
		const raw = JSON.stringify({
			governingSources: [a.sourceId],
			assessments: [{ ...a, result: e.value.result }],
			explanation: "Opaque boundary check",
			decision: e.value.result === "violated" ? "deny" : "hold",
		});
		expect(inspect(raw, ctx).passed).toBe(true);
		expect(auditValidity(raw, ctx).invalidClaims.length > 0).toBe(
			asOf < 1000 || asOf >= 2000,
		);
	}
	const renamed = structuredClone(r.context);
	const id = "opaque-selected-claim";
	const source = "opaque-document";
	renamed.sources = renamed.sources.map((s) =>
		s.id === a.sourceId ? { ...s, id: source } : s,
	);
	renamed.derivedView!.slice = {
		...renamed.derivedView!.slice,
		units: renamed.derivedView!.slice.units.map((u) =>
			u.assertionId === a.assertionId
				? {
						...u,
						assertionId: id,
						sources: u.sources.map((s) =>
							s.id === a.sourceId ? { ...s, id: source } : s,
						),
					}
				: u,
		),
	};
	renamed.derivedView!.evaluations = renamed.derivedView!.evaluations.map(
		(e) => (e.assertionId === a.assertionId ? { ...e, assertionId: id } : e),
	);
	const raw = JSON.stringify({
		...parseGroundedAnswer(r.seedRaw),
		governingSources: [source],
		assessments: [{ ...a, sourceId: source, assertionId: id }],
	});
	expect(auditValidity(raw, renamed).invalidClaims).toEqual([
		{ sourceId: source, assertionId: id, reason: "CLAIM_NOT_VALID" },
	]);
	const uncertain = evaluateConditions({
		contractVersion: 1,
		asOf: 1000,
		authorized: true,
		maxAgeMs: 3600000,
		condition: { kind: "unspecified" },
		validTime: {
			...period,
			precision: "day",
			start: { earliest: 900, latest: 1100 },
			end: { earliest: 1900, latest: 2100 },
		},
		observations: [],
	});
	if (!uncertain.ok) throw new Error("invalid_uncertain_period");
	ctx.derivedView!.evaluations = [
		{ assertionId: unit.assertionId, ...uncertain.value },
	];
	expect(uncertain.value.reasons).toContain("CLAIM_VALIDITY_UNKNOWN");
	expect(
		auditValidity(
			JSON.stringify({
				governingSources: [a.sourceId],
				assessments: [{ ...a, result: uncertain.value.result }],
				explanation: "Unknown",
				decision: "hold",
			}),
			ctx,
		).invalidClaims,
	).toHaveLength(0);
});
test("bad bindings and malformed output remain rejected; unrelated invalid claims and prose do not trigger the new check", () => {
	const r = regressions[0]!;
	const parsed = parseGroundedAnswer(r.seedRaw);
	const a = parsed.assessments[0]!;
	const wrong = JSON.stringify({
		...parsed,
		assessments: [{ ...a, sourceId: "missing-source" }],
	});
	expect(auditValidity(wrong, r.context).passed).toBe(false);
	expect(auditValidity(wrong, r.context).invalidClaims).toHaveLength(0);
	expect(auditValidity("{}", r.context).passed).toBe(false);
	const correct = JSON.stringify({
		governingSources: r.question.expected.governingSources,
		assessments: Object.entries(r.question.expectedAssessments).map(
			([sourceId, result]) => ({
				sourceId,
				result,
				assertionId: r.context.derivedView!.slice.units.find((u) =>
					u.sources.some((s) => s.id === sourceId),
				)!.assertionId,
				overrideReason: null,
			}),
		),
		explanation:
			"Intentionally arbitrary date wording: this auditor does not parse prose.",
		decision: r.question.expected.decision,
	});
	expect(auditValidity(correct, r.context).passed).toBe(true);
	expect(auditValidity(correct, r.context).invalidClaims).toHaveLength(0);
});
test("shared gate, feedback-only prompt difference, one revision ceiling, post-gate rejection and no fallback", async () => {
	const r = regressions[0]!;
	const initial = response(r.seedRaw);
	for (const arm of ["control", "validity"] as const) {
		let calls = 0;
		const out = await review(r.question, r.context, initial, arm, async () => {
			calls++;
			return response(r.seedRaw);
		});
		expect(calls).toBe(1);
		expect(out.repairAttempted).toBe(true);
		expect(out.accepted).toBe(arm === "control");
		expect(out.finalValidity.passed).toBe(false);
		expect(out.inputTokens).toBe(20);
		await expect(
			review(r.question, r.context, initial, arm, async () => {
				throw new Error("transport_failure");
			}),
		).rejects.toThrow("transport_failure");
		const p = regressions[4]!;
		const pass = await review(
			p.question,
			p.context,
			response(p.seedRaw),
			arm,
			async () => {
				throw new Error("must not call");
			},
		);
		expect(pass.raw).toBe(p.seedRaw);
		expect(pass.repairAttempted).toBe(false);
	}
	const { validityAudit, ...rest } = JSON.parse(
		reviewPrompt(r.question, r.context, r.seedRaw, "validity"),
	);
	expect(rest).toEqual(
		JSON.parse(reviewPrompt(r.question, r.context, r.seedRaw, "control")),
	);
	expect(validityAudit.invalidClaims).toHaveLength(1);
	const changed = {
		...r.question,
		expected: {
			decision: "hold" as const,
			governingSources: ["ORACLE_ONLY"],
			reason: "ORACLE_ONLY",
		},
		expectedAssessments: { ORACLE_ONLY: "unknown" as const },
	};
	expect(reviewPrompt(changed, r.context, r.seedRaw, "validity")).toBe(
		reviewPrompt(r.question, r.context, r.seedRaw, "validity"),
	);
	expect(
		JSON.parse(reviewPrompt(r.question, r.context, r.seedRaw, "validity"))
			.originalInput.context.sources,
	).toEqual(r.context.sources);
	expect(schemaFor(r.context).properties.decision.enum).toEqual([
		"allow",
		"deny",
		"hold",
	]);
	expect(order(0, 0)).toEqual([...order(0, 1)].reverse());
	expect(questions.length * 2 * 3).toBe(design.plannedEndpoints);
	expect(
		packets.length + unseenQuestions.length * 2 + questions.length * 4,
	).toBe(design.maxCalls);
	expect(adoption([]).guardRetained).toBe(false);
	expect(adoption([]).repairRetained).toBe(false);
});
