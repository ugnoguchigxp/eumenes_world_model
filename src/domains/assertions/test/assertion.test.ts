import { describe, expect, test } from "bun:test";
import { validateAssertion, assessFreshness } from "../index.ts";
import {
	A,
	B,
	content,
	draft,
	entities,
	evidence,
	freeze,
	hex,
	input,
	ref,
	sha256,
	state,
} from "./helpers.ts";

const validate = (i: unknown) => validateAssertion(freeze(i), sha256);
/** Reason codes of a semantic rejection; [] when the draft is valid. */
const rejected = (i: unknown) => {
	const r = validate(i);
	if (!r.ok) throw new Error(`structural:${r.code}:${r.path}`);
	return r.value.status === "rejected" ? r.value.reasonCodes : [];
};

describe("A08 origin and lifecycle", () => {
	test("valid user_report starts as candidate with roots", () => {
		const r = validate(input());
		expect(r.ok && r.value.status).toBe("valid");
		if (r.ok && r.value.status === "valid") {
			expect(r.value.assertion.lifecycle).toBe("candidate");
			expect(r.value.assertion.origin).toBe("user_report");
			expect(r.value.assertion.rootEvidenceIds).toEqual(["root-1"]);
			expect(r.value.assertion.inputManifest).toHaveLength(1);
		}
	});
	test("same content, four origins: origin kept, active never produced", () => {
		const kinds: Record<string, string> = {
			user_report: "user_statement",
			document_claim: "document",
			runtime_observation: "runtime_measurement",
			model_hypothesis: "assistant_summary",
		};
		for (const [origin, kind] of Object.entries(kinds)) {
			const r = validate(
				input(
					draft({
						origin,
						observedAt: 1791499999000,
						evidence: [evidence({ kind })],
					}),
				),
			);
			expect(r.ok && r.value.status).toBe("valid");
			if (r.ok && r.value.status === "valid") {
				expect(r.value.assertion.origin as string).toBe(origin);
				expect(r.value.assertion.lifecycle).toBe("candidate");
			}
		}
	});
	test("model_hypothesis may not start active; lifecycle other than candidate is refused", () => {
		for (const lifecycle of ["active", "disputed", "superseded"]) {
			const r = validate(
				input(draft({ origin: "model_hypothesis", lifecycle })),
			);
			expect(r.ok).toBe(false);
		}
	});
	test("report is not promoted to measurement; summary cannot back observation", () => {
		expect(
			rejected(
				input(
					draft({
						origin: "runtime_observation",
						observedAt: 1,
						evidence: [evidence({ kind: "user_statement" })],
					}),
				),
			),
		).toEqual(["ORIGIN_EVIDENCE_MISMATCH"]);
		expect(
			rejected(
				input(
					draft({
						origin: "document_claim",
						evidence: [evidence({ kind: "assistant_summary" })],
					}),
				),
			),
		).toEqual(["ORIGIN_EVIDENCE_MISMATCH"]);
		expect(
			rejected(
				input(
					draft({
						origin: "runtime_observation",
						evidence: [evidence({ kind: "runtime_measurement" })],
					}),
				),
			),
		).toEqual(["MISSING_OBSERVED_AT"]);
	});
	test("confidence / unknown fields are refused, not dropped", () => {
		for (const key of ["confidence", "score", "active"]) {
			expect(validate(input(draft({ [key]: 0.99 }))).ok).toBe(false);
		}
	});
	test("freshness is separate from lifecycle", () => {
		const policy = { maxAgeMs: 1000 };
		expect(assessFreshness(100, policy, 1100)).toBe("fresh");
		expect(assessFreshness(100, policy, 1101)).toBe("stale");
		expect(assessFreshness(100, policy, 99)).toBe("unknown");
		expect(assessFreshness(undefined, policy, 99)).toBe("unknown");
	});
});

describe("structure and scope", () => {
	test("unknown version, bad payload, both value and relation are refused", () => {
		const r = validate({ ...input(), contractVersion: 2 });
		expect(!r.ok && r.code).toBe("UNSUPPORTED_CONTRACT_VERSION");
		expect(
			validate(
				input(
					draft({
						payload: {
							kind: "value",
							value: { kind: "boolean", value: true },
							relation: "causes",
						},
					}),
				),
			).ok,
		).toBe(false);
		expect(
			validate(
				input(
					draft({
						payload: {
							kind: "value",
							value: { kind: "number", value: Number.NaN, unit: "ms" },
						},
					}),
				),
			).ok,
		).toBe(false);
		expect(validate(input(draft({ predicate: "" }))).ok).toBe(false);
	});
	test("relation payload resolves both ends inside the Scope", () => {
		const relation = {
			kind: "relation",
			relation: "causes",
			objectId: "svc-2",
		};
		expect(rejected(input(draft({ payload: relation })))).toEqual([]);
		expect(
			rejected(input(draft({ payload: { ...relation, objectId: "svc-x" } }))),
		).toEqual(["OBJECT_NOT_RESOLVED"]);
	});
	test("scope mismatch and other-Scope sources reveal nothing", () => {
		expect(rejected(input(draft({ scope: B })))).toEqual([
			"SCOPE_NOT_PERMITTED",
		]);
		expect(
			rejected(
				input(draft(), {
					sources: { states: [state({ scopeKey: B.scopeKey })] },
				}),
			),
		).toEqual(["SOURCE_NOT_AVAILABLE"]);
		expect(rejected(input(draft(), { sources: { states: [] } }))).toEqual([
			"SOURCE_NOT_AVAILABLE",
		]);
	});
	test("unresolved or other-Scope subject is rejected", () => {
		expect(rejected(input(draft({ subjectId: "svc-x" })))).toEqual([
			"SUBJECT_NOT_RESOLVED",
		]);
		expect(rejected(input(draft(), { entities: [] }))).toEqual([
			"SUBJECT_NOT_RESOLVED",
		]);
		expect(
			rejected(
				input(draft(), {
					entities: entities.map((e) => ({ ...e, scope: B })),
				}),
			),
		).toEqual(["SUBJECT_NOT_RESOLVED"]);
	});
	test("source version and digest are checked", () => {
		expect(
			rejected(
				input(draft(), {
					sources: { states: [state({ revision: "rev-2" })] },
				}),
			),
		).toEqual(["SOURCE_VERSION_MISMATCH"]);
		expect(
			rejected(
				input(draft(), {
					sources: { states: [state({ status: "forgotten" })] },
				}),
			),
		).toEqual(["SOURCE_NOT_AVAILABLE"]);
		expect(
			rejected(
				input(
					draft({ evidence: [evidence({ source: ref({ digest: "x" }) })] }),
				),
			),
		).toContain("SOURCE_DIGEST_MISMATCH");
	});
	test("manifest merges evidence sources and caps at 32", () => {
		const many = Array.from({ length: 33 }, (_, i) =>
			ref({ id: `s-${i}`, revision: "r" }),
		);
		// 33 UNIQUE sources: a semantic rejection, the same rule as the merged list
		expect(rejected(input(draft({ inputManifest: many })))).toContain(
			"MANIFEST_LIMIT_EXCEEDED",
		);
		// 40 raw entries but a single unique source behaves the same as one entry
		const dupes = Array.from({ length: 40 }, () =>
			ref({ id: "s-0", revision: "r" }),
		);
		expect(
			rejected(
				input(draft({ inputManifest: dupes }), {
					sources: { states: [state(), state({ id: "s-0", revision: "r" })] },
				}),
			),
		).toEqual([]);
		const huge = Array.from({ length: 1025 }, () =>
			ref({ id: "s-0", revision: "r" }),
		);
		const r = validate(input(draft({ inputManifest: huge })));
		expect(!r.ok && r.code).toBe("LIMIT_EXCEEDED");
		const extra = Array.from({ length: 32 }, (_, i) =>
			ref({ id: `s-${i}`, revision: "r" }),
		);
		const states = [
			state(),
			...extra.map((e) => state({ id: e.id, revision: "r" })),
		];
		expect(
			rejected(input(draft({ inputManifest: extra }), { sources: { states } })),
		).toContain("MANIFEST_LIMIT_EXCEEDED");
	});
	test("explicit unconditional needs supporting adoption evidence", () => {
		const unconditional = {
			kind: "explicitly_unconditional",
			adoptionEvidenceId: "ev-1",
		};
		expect(rejected(input(draft({ condition: unconditional })))).toEqual([]);
		expect(
			rejected(
				input(
					draft({
						condition: { ...unconditional, adoptionEvidenceId: "ev-9" },
					}),
				),
			),
		).toEqual(["UNCONDITIONAL_WITHOUT_EVIDENCE"]);
		expect(
			rejected(
				input(
					draft({
						condition: unconditional,
						evidence: [
							evidence({ stance: "refutes" }),
							evidence({ evidenceId: "ev-2" }),
						],
					}),
				),
			),
		).toEqual(["UNCONDITIONAL_WITHOUT_EVIDENCE"]);
	});
	test("supersedes must point to an older revision of the same id", () => {
		expect(
			rejected(
				input(
					draft({ revision: 2, supersedes: [{ id: "claim-1", revision: 1 }] }),
				),
			),
		).toEqual([]);
		expect(
			rejected(
				input(
					draft({ revision: 2, supersedes: [{ id: "claim-1", revision: 2 }] }),
				),
			),
		).toEqual(["INVALID_SUPERSEDES"]);
	});
	test("inputs are not mutated and results are deterministic", () => {
		const i = freeze(input());
		expect(validateAssertion(i, sha256)).toEqual(validateAssertion(i, sha256));
		expect(content.length).toBeGreaterThan(0);
		expect(hex("")).toHaveLength(64);
		expect(A.principal).toBe("p-a");
	});
});

describe("review fixes: fail-closed freshness, strict entities, small gaps", () => {
	test("assessFreshness never answers fresh for NaN / non-finite / negative inputs", () => {
		const policy = { maxAgeMs: 1000 };
		expect(assessFreshness(100, policy, Number.NaN)).toBe("unknown");
		expect(assessFreshness(100, { maxAgeMs: Number.NaN }, 999_999)).toBe(
			"unknown",
		);
		expect(
			assessFreshness(100, { maxAgeMs: Number.POSITIVE_INFINITY }, 5),
		).toBe("unknown");
		expect(assessFreshness(Number.NaN, policy, 100)).toBe("unknown");
		expect(assessFreshness(100.5, policy, 200)).toBe("unknown");
		expect(assessFreshness(100, { maxAgeMs: -1 }, 100)).toBe("unknown");
		expect(assessFreshness(100, policy, 1100)).toBe("fresh");
	});
	test("malformed or oversized entity data is a structural failure, not NOT_RESOLVED", () => {
		const bad = validate(
			input(draft(), { entities: [{ ...entities[0], extra: 1 }] }),
		);
		expect(bad.ok).toBe(false);
		const dup = validate(
			input(draft(), { entities: [entities[0], entities[0]] }),
		);
		expect(dup.ok).toBe(false);
		const many = validate(
			input(draft(), {
				entities: Array.from({ length: 1001 }, (_, i) => ({
					...entities[0],
					id: `e${i}`,
				})),
			}),
		);
		expect(many.ok).toBe(false);
		// a well-formed list without the subject remains a semantic rejection
		expect(rejected(input(draft(), { entities: [] }))).toContain(
			"SUBJECT_NOT_RESOLVED",
		);
	});
	test("too many source states are refused before they are parsed", () => {
		const states = Array.from({ length: 2001 }, (_, i) =>
			state({ id: `s${i}` }),
		);
		const r = validate(input(draft(), { sources: { states } }));
		expect(!r.ok && r.code).toBe("LIMIT_EXCEEDED");
	});
	test("source content with a lone surrogate is rejected, not silently altered", () => {
		const r = validate(
			input(draft(), { sources: { states: [state({ content: "a\ud800b" })] } }),
		);
		expect(r.ok).toBe(false);
	});
	test("condition: null is rejected, absent condition is unspecified", () => {
		expect(validate(input(draft({ condition: null }))).ok).toBe(false);
		const { condition: _c, ...noCondition } = draft();
		const r = validate(input(noCondition));
		expect(r.ok && r.value.status).toBe("valid");
	});
	test("an inputManifest ref carrying a range does not demand a quote digest", () => {
		const r = rejected(
			input(
				draft({
					inputManifest: [
						ref({ id: "src-1", range: { startByte: 0, endByte: 3 } }),
					],
				}),
			),
		);
		expect(r).toEqual([]);
	});
	test("-0 is canonicalized to 0 in checked numbers", () => {
		const r = validate(input(draft({ recordedAt: -0 })));
		expect(
			r.ok &&
				r.value.status === "valid" &&
				Object.is(r.value.assertion.recordedAt, 0),
		).toBe(true);
	});
});

describe("round-2 fixes", () => {
	test("duplicate source states are structural, whatever the order", () => {
		const stale = state({
			revision: "rev-0",
			digest: hex("old"),
			content: "old",
		});
		for (const states of [
			[stale, state()],
			[state(), stale],
		]) {
			const r = validate(input(draft(), { sources: { states } }));
			expect(!r.ok && r.code).toBe("INVALID_INPUT");
		}
	});
	test("a draft cannot contradict itself", () => {
		expect(
			rejected(input(draft({ contradicts: [{ id: "claim-1", revision: 1 }] }))),
		).toContain("SELF_CONTRADICTION");
		expect(
			rejected(input(draft({ contradicts: [{ id: "claim-7", revision: 1 }] }))),
		).toEqual([]);
	});
	test("an assistant summary alone cannot back an unconditional claim", () => {
		const unconditional = {
			kind: "explicitly_unconditional",
			adoptionEvidenceId: "ev-1",
		};
		expect(
			rejected(
				input(
					draft({
						origin: "model_hypothesis",
						condition: unconditional,
						evidence: [evidence({ kind: "assistant_summary" })],
					}),
				),
			),
		).toContain("UNCONDITIONAL_WITHOUT_EVIDENCE");
		expect(
			rejected(
				input(
					draft({
						origin: "model_hypothesis",
						condition: unconditional,
						evidence: [
							evidence({ evidenceId: "ev-0", kind: "assistant_summary" }),
							evidence({
								evidenceId: "ev-1",
								kind: "user_statement",
								rootEvidenceId: "root-2",
								source: ref({ id: "src-2" }),
							}),
						],
					}),
					{ sources: { states: [state(), state({ id: "src-2" })] } },
				),
			),
		).toEqual([]);
	});
	test("entity-valued payloads and condition operands must resolve", () => {
		const payload = (entityId: string) => ({
			kind: "value",
			value: { kind: "entity", entityId },
		});
		expect(rejected(input(draft({ payload: payload("svc-2") })))).toEqual([]);
		expect(rejected(input(draft({ payload: payload("nope") })))).toContain(
			"OBJECT_NOT_RESOLVED",
		);
		const cond = (entityId: string) => ({
			kind: "expression",
			expression: {
				kind: "all",
				items: [
					{
						kind: "not",
						item: {
							kind: "compare",
							key: "k",
							op: "eq",
							value: { kind: "entity", entityId },
						},
					},
				],
			},
		});
		expect(rejected(input(draft({ condition: cond("svc-2") })))).toEqual([]);
		expect(rejected(input(draft({ condition: cond("nope") })))).toContain(
			"OBJECT_NOT_RESOLVED",
		);
	});
	test("a hasher returning a non-string is a structural failure, not a crash", () => {
		const r = validateAssertion(
			freeze(input()),
			(() => 42) as unknown as typeof sha256,
		);
		expect(!r.ok && r.code).toBe("INVALID_INPUT");
	});
});
