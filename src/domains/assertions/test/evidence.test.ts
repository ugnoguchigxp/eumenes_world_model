import { describe, expect, test } from "bun:test";
import { groupEvidenceRoots, validateAssertion } from "../index.ts";
import {
	content,
	draft,
	evidence,
	freeze,
	hex,
	input,
	ref,
	sha256,
	state,
} from "./helpers.ts";

const summaries = (n: number, root = "root-1") =>
	Array.from({ length: n }, (_, i) =>
		evidence({
			evidenceId: `${root}-sum-${i}`,
			kind: "assistant_summary",
			rootEvidenceId: root,
			// one underlying source per root: the same source under two roots is
			// an inconsistent labelling and is rejected
			source: ref({ id: `src-${root}` }),
		}),
	);

describe("A09 evidence roots", () => {
	test("ten summaries of one root count as 1; a second root makes 2", () => {
		const one = groupEvidenceRoots({
			contractVersion: 1,
			evidence: summaries(10),
		});
		expect(one.ok && one.value.rootCount).toBe(1);
		const two = groupEvidenceRoots({
			contractVersion: 1,
			evidence: [...summaries(10), ...summaries(1, "root-2")],
		});
		expect(two.ok && two.value.rootCount).toBe(2);
		// summaries alone never back a claim: counted as roots, not as supporting
		expect(two.ok && two.value.roots.map((r) => r.summaryOnly)).toEqual([
			true,
			true,
		]);
		expect(two.ok && two.value.supportingRootCount).toBe(0);
		if (two.ok) {
			expect(two.value.roots[0]?.evidenceIds).toHaveLength(10);
			// A count, never a probability or independence claim.
			expect(Object.keys(two.value)).toEqual([
				"roots",
				"rootCount",
				"supportingRootCount",
				"refutingRootCount",
				"inputs",
			]);
		}
	});
	test("all input dependencies stay even when roots merge", () => {
		const list = [
			evidence({ evidenceId: "e1", source: ref({ id: "src-a" }) }),
			evidence({ evidenceId: "e2", source: ref({ id: "src-b" }) }),
			evidence({
				evidenceId: "e3",
				source: ref({ id: "src-b", revision: "rev-2" }),
			}),
		];
		const r = groupEvidenceRoots(
			freeze({ contractVersion: 1, evidence: list }),
		);
		expect(r.ok && r.value.rootCount).toBe(1);
		expect(r.ok && r.value.inputs.map((i) => `${i.id}/${i.revision}`)).toEqual([
			"src-a/rev-1",
			"src-b/rev-1",
			"src-b/rev-2",
		]);
	});
	test("supporting and refuting roots are separated; series ids are kept", () => {
		const r = groupEvidenceRoots({
			contractVersion: 1,
			evidence: [
				evidence({ evidenceId: "e1", seriesId: "exp-1" }),
				evidence({
					evidenceId: "e2",
					rootEvidenceId: "root-2",
					stance: "refutes",
					seriesId: "exp-1",
					source: ref({ id: "src-2" }),
				}),
			],
		});
		expect(r.ok && r.value.supportingRootCount).toBe(1);
		expect(r.ok && r.value.refutingRootCount).toBe(1);
		expect(r.ok && r.value.roots.map((x) => x.seriesIds)).toEqual([
			["exp-1"],
			["exp-1"],
		]);
	});
	test("order of evidence does not change the result; duplicates and junk fail", () => {
		const a = evidence({ evidenceId: "a", rootEvidenceId: "r2" });
		const b = evidence({ evidenceId: "b", rootEvidenceId: "r1" });
		expect(
			groupEvidenceRoots({ contractVersion: 1, evidence: [a, b] }),
		).toEqual(groupEvidenceRoots({ contractVersion: 1, evidence: [b, a] }));
		expect(
			groupEvidenceRoots({ contractVersion: 1, evidence: [a, a] }).ok,
		).toBe(false);
		expect(
			groupEvidenceRoots({
				contractVersion: 1,
				evidence: [{ ...a, confidence: 1 }],
			}).ok,
		).toBe(false);
		expect(groupEvidenceRoots(null).ok).toBe(false);
	});
});

describe("A09 citation ranges", () => {
	const start = 0;
	const end = 18; // 音声サービス = 6 chars * 3 bytes
	const quoted = new TextEncoder().encode(content).slice(start, end);
	const quoteDigest = sha256(quoted);
	const withRange = (range: unknown, qd: string | null = quoteDigest) =>
		input(
			draft({
				evidence: [
					evidence({
						source: ref({ range }),
						...(qd === null ? {} : { quoteDigest: qd }),
					}),
				],
			}),
		);
	const codes = (i: unknown) => {
		const r = validateAssertion(freeze(i), sha256);
		if (!r.ok) throw new Error(r.code);
		return r.value.status === "rejected" ? r.value.reasonCodes : [];
	};
	test("Japanese byte range with matching digest is accepted", () => {
		expect(codes(withRange({ startByte: start, endByte: end }))).toEqual([]);
	});
	test("out of range, mid-character, wrong digest, missing digest are rejected", () => {
		const total = new TextEncoder().encode(content).length;
		expect(codes(withRange({ startByte: 0, endByte: total + 1 }))).toEqual([
			"QUOTE_OUT_OF_RANGE",
		]);
		expect(codes(withRange({ startByte: 1, endByte: end }))).toEqual([
			"QUOTE_OUT_OF_RANGE",
		]);
		expect(
			codes(withRange({ startByte: start, endByte: end }, hex("other"))),
		).toEqual(["QUOTE_DIGEST_MISMATCH"]);
		expect(codes(withRange({ startByte: start, endByte: end }, null))).toEqual([
			"QUOTE_DIGEST_MISSING",
		]);
	});
	test("a quote cannot be verified without source content", () => {
		const i = withRange({ startByte: start, endByte: end });
		const noContent = {
			...i,
			sources: {
				states: [
					(({ content: _c, ...rest }) => rest)(
						state() as Record<string, unknown> & { content: string },
					),
				],
			},
		};
		expect(codes(noContent)).toEqual(["QUOTE_UNVERIFIABLE"]);
	});
	test("state whose content disagrees with its digest is not trusted", () => {
		const i = withRange({ startByte: start, endByte: end });
		const bad = { ...i, sources: { states: [state({ content: "別の本文" })] } };
		expect(codes(bad)).toContain("SOURCE_DIGEST_MISMATCH");
	});
});

describe("review fixes: root labels and strict input", () => {
	test("the same source under two different roots is rejected (no inflated count)", () => {
		const a = evidence({ evidenceId: "a", rootEvidenceId: "r1" });
		const b = evidence({ evidenceId: "b", rootEvidenceId: "r2" });
		const r = groupEvidenceRoots({ contractVersion: 1, evidence: [a, b] });
		expect(r.ok).toBe(false);
		const v = validateAssertion(input(draft({ evidence: [a, b] })), sha256);
		expect(v.ok && v.value).toEqual({
			status: "rejected",
			reasonCodes: ["ROOT_LABEL_CONFLICT"],
		});
	});
	test("a user root still supports; a summary-only root is flagged and excluded", () => {
		const r = groupEvidenceRoots({
			contractVersion: 1,
			evidence: [
				evidence({ evidenceId: "u" }),
				evidence({
					evidenceId: "s",
					kind: "assistant_summary",
					rootEvidenceId: "root-s",
					source: ref({ id: "src-s" }),
				}),
			],
		});
		expect(r.ok && r.value.rootCount).toBe(2);
		expect(r.ok && r.value.supportingRootCount).toBe(1);
	});
	test("groupEvidenceRoots is strict: version, unknown keys, array-with-props", () => {
		const e = [evidence()];
		expect(groupEvidenceRoots({ evidence: e }).ok).toBe(false);
		expect(groupEvidenceRoots({ contractVersion: 2, evidence: e }).ok).toBe(
			false,
		);
		expect(
			groupEvidenceRoots({ contractVersion: 1, evidence: e, confidence: 0.9 })
				.ok,
		).toBe(false);
		expect(groupEvidenceRoots([]).ok).toBe(false);
		expect(groupEvidenceRoots({ contractVersion: 1, evidence: [] }).ok).toBe(
			true,
		);
	});
});
