import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { validateCandidates } from "../../src/index.ts";
import {
	loadDataset,
	foreignEntityIds,
} from "../../eval/extraction/dataset.ts";
import { referenceCandidates } from "../../eval/extraction/fixture-provider.ts";
import { prepareEvaluationCase } from "../../eval/extraction/runner.ts";
import {
	evaluateSample,
	summarizeRawOutput,
} from "../../eval/extraction/scoring.ts";
import { diagnoseEvaluations } from "../../eval/extraction/diagnostics.ts";

const dataset = loadDataset();
const tc = dataset.cases.find(
	(c) => c.split === "dev" && c.gold.outcome === "adopt",
)!;
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function evaluate(candidates: unknown[]) {
	const raw = { candidates };
	const input = prepareEvaluationCase(dataset, tc, hash)!;
	const validation = validateCandidates(input.validationInput(raw), hash);
	if (!validation.ok) throw new Error(validation.code);
	return evaluateSample(
		tc,
		{
			status: "ok",
			validation: validation.value,
			raw: summarizeRawOutput(raw),
		},
		{ scope: dataset.scope, foreignEntityIds: foreignEntityIds(dataset) },
	);
}

test("all wrong candidates remain diagnosable without changing legacy first-error scoring", () => {
	const base = referenceCandidates(tc)[0]!;
	const e = evaluate([
		{ ...base, predicate: "different-predicate" },
		{
			...base,
			payload: {
				kind: "value",
				value: { kind: "string", value: "different-value" },
			},
		},
		{ ...base, quote: { ...base.quote, endByte: 999999 } },
	]);
	expect(e.wrongAdopted).toBe(2);
	expect(e.mismatches).toEqual(["PREDICATE"]);
	expect(e.diagnostics?.candidateMismatches).toEqual([
		{ index: 0, codes: ["PREDICATE"] },
		{ index: 1, codes: ["PAYLOAD"] },
	]);
	const d = diagnoseEvaluations([e]);
	expect(d.counts["MISMATCH:PAYLOAD"]).toBe(1);
	expect(d.counts["VALIDATION:QUOTE_OUT_OF_RANGE"]).toBe(1);
	expect(d.counts["MISSING_EXPECTED_ADOPTION"]).toBe(1);
	expect(d.legacySamples).toBe(0);
});

test("silence, execution failures and legacy diagnostic gaps are explicit, not semantic causes", () => {
	const silence = evaluate([]);
	const { diagnostics: _drop, ...legacy } = silence;
	const d = diagnoseEvaluations([silence, { ...legacy, status: "timeout" }]);
	expect(d.counts["MISSING_EXPECTED_ADOPTION"]).toBe(1);
	expect(d.counts["EXECUTION:timeout"]).toBe(1);
	expect(d.legacySamples).toBe(1);
	expect(JSON.stringify(d)).not.toContain(tc.caseId);
	expect(JSON.stringify(d)).not.toContain(tc.utterances[0]!.text);
});
