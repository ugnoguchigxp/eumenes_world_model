/** Regression cases use dev only. No model calls and no gold rewriting. */
import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { validateCandidates } from "../../src/index.ts";
import {
	checkConditionSpec,
	checkValidTime,
} from "../../src/domains/conditions/contracts/index.ts";
import {
	loadDataset,
	foreignEntityIds,
	EVALUATION_VERSION,
	type EvalCase,
} from "../../eval/extraction/dataset.ts";
import { referenceCandidates } from "../../eval/extraction/fixture-provider.ts";
import { prepareEvaluationCase } from "../../eval/extraction/runner.ts";
import {
	evaluateSample,
	summarizeRawOutput,
} from "../../eval/extraction/scoring.ts";
import { compareRuns } from "../../eval/extraction/compare.ts";
import { runEvaluation } from "../../eval/extraction/runner.ts";
import { createFixtureProvider } from "../../eval/extraction/fixture-provider.ts";

const dataset = loadDataset();
const dev = dataset.cases.filter(
	(c) => c.split === "dev" && c.gold.outcome === "adopt",
);
const conditional = dev.find(
	(c) =>
		c.gold.outcome === "adopt" &&
		c.gold.candidate.condition.kind === "expression",
)!;
const dated = dev.find(
	(c) => c.gold.outcome === "adopt" && c.gold.candidate.validTime,
)!;
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function evaluate(tc: EvalCase, candidates: unknown[]) {
	const raw = { candidates };
	const checked = validateCandidates(
		prepareEvaluationCase(dataset, tc, hash)!.validationInput(raw),
		hash,
	);
	if (!checked.ok) throw new Error(checked.code);
	return {
		validation: checked.value,
		evaluation: evaluateSample(
			tc,
			{ status: "ok", validation: checked.value, raw: summarizeRawOutput(raw) },
			{ scope: dataset.scope, foreignEntityIds: foreignEntityIds(dataset) },
		),
	};
}

test("negating a source condition is a mismatch even when the public validator accepts its structure", () => {
	const candidates = referenceCandidates(conditional).map((c) => {
		const checked = checkConditionSpec(c.condition);
		if (!checked.ok || checked.value.kind !== "expression")
			throw new Error("fixture condition required");
		return {
			...c,
			condition: {
				kind: "expression",
				expression: { kind: "not", item: checked.value.expression },
			},
		};
	});
	const r = evaluate(conditional, candidates);
	expect(r.validation.verdicts[0]!.status).toBe("accepted");
	expect(r.evaluation.adoptedCorrectly).toBe(false);
	expect(r.evaluation.mismatches).toContain("CONDITION");
});

test.each([1, 365 * 86400000])(
	"shifting period endpoints by %s ms is not a correct extraction",
	(delta) => {
		const candidates = referenceCandidates(dated).map((c) => {
			const checked = checkValidTime(c.validTime);
			if (!checked.ok || checked.value.kind !== "period")
				throw new Error("fixture period required");
			const t = checked.value;
			const shift = (b: { earliest: number; latest: number }) => ({
				earliest: b.earliest + delta,
				latest: b.latest + delta,
			});
			return {
				...c,
				validTime: {
					...t,
					...(t.start ? { start: shift(t.start) } : {}),
					...(t.end ? { end: shift(t.end) } : {}),
				},
			};
		});
		const r = evaluate(dated, candidates);
		expect(r.validation.verdicts[0]!.status).toBe("accepted");
		expect(r.evaluation.adoptedCorrectly).toBe(false);
		expect(r.evaluation.mismatches).toContain("VALID_TIME");
	},
);

test("equivalent condition syntax and all unchanged dev references remain correct", () => {
	for (const tc of dev)
		expect(
			evaluate(tc, referenceCandidates(tc)).evaluation.adoptedCorrectly,
		).toBe(true);
	const candidates = referenceCandidates(conditional).map((c) => {
		const checked = checkConditionSpec(c.condition);
		if (!checked.ok || checked.value.kind !== "expression")
			throw new Error("fixture condition required");
		return {
			...c,
			condition: {
				kind: "expression",
				expression: {
					kind: "not",
					item: { kind: "not", item: checked.value.expression },
				},
			},
		};
	});
	expect(evaluate(conditional, candidates).evaluation.adoptedCorrectly).toBe(
		true,
	);
});

test("strict scoring uses a distinct evaluation version and refuses comparisons with legacy scoring", async () => {
	expect(EVALUATION_VERSION).toBe("ext-v3");
	const r = await runEvaluation({
		dataset,
		provider: createFixtureProvider(dataset, "oracle"),
		split: "dev",
		mode: "tuning",
		promptVersion: "fixture",
	});
	expect(r.score.thresholdsMet).toBe(true);
	expect(() => compareRuns(r, { ...r, evaluationVersion: "ext-v2" })).toThrow(
		"evaluation version mismatch",
	);
});
