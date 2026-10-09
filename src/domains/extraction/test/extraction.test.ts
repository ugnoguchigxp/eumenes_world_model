import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { CanonicalHasher } from "../../../contracts/index.ts";
import {
	prepareExtraction,
	validateCandidate,
	validateCandidates,
} from "../index.ts";

const sha256: CanonicalHasher = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
const hex = (text: string) => sha256(new TextEncoder().encode(text));
const A = { principal: "p-a", scopeKey: "scope-a" };
const B = { principal: "p-a", scopeKey: "scope-b" };

const text = "音声サービスは9月から使える。";
const stateOf = (id: string, content = text, scope = A) => ({
	namespace: "conversation",
	kind: "message",
	id,
	revision: "rev-1",
	digest: hex(content),
	principal: scope.principal,
	scopeKey: scope.scopeKey,
	status: "available",
	content,
});
const refOf = (id: string, content = text) => ({
	namespace: "conversation",
	kind: "message",
	id,
	revision: "rev-1",
	digest: hex(content),
});
const utt = (
	n: number,
	extra: Record<string, unknown> = {},
	content = text,
) => ({
	utteranceId: `u-${n}`,
	source: refOf(`m-${n}`, content),
	confirmed: true,
	origin: "user_report",
	rootEvidenceId: `root-${n}`,
	...extra,
});
const entities = [
	{
		id: "svc-1",
		scope: A,
		revision: 1,
		displayName: "音声サービス",
		aliases: ["音声サービス"],
		externalRefs: [],
	},
	{
		id: "svc-2",
		scope: A,
		revision: 1,
		displayName: "ダブり",
		aliases: ["同名"],
		externalRefs: [],
	},
	{
		id: "svc-3",
		scope: A,
		revision: 1,
		displayName: "ダブり2",
		aliases: ["同名"],
		externalRefs: [],
	},
	{
		id: "other-scope",
		scope: B,
		revision: 1,
		displayName: "他",
		aliases: ["他Scope名"],
		externalRefs: [],
	},
];
const prep = (utterances: unknown[], states: unknown[], extra = {}) =>
	prepareExtraction({
		contractVersion: 1,
		scope: A,
		utterances,
		sources: { states },
		...extra,
	});
const deepFreeze = <T>(value: T): T => {
	if (typeof value === "object" && value !== null) {
		for (const v of Object.values(value)) deepFreeze(v);
		Object.freeze(value);
	}
	return value;
};

describe("A20 prepareExtraction limits", () => {
	const many = (n: number) => {
		const utterances = Array.from({ length: n }, (_, i) => utt(i + 1));
		const states = utterances.map((u, i) => stateOf(`m-${i + 1}`));
		return { utterances, states };
	};
	test("12 utterances fit, the 13th waits for the next window", () => {
		const { utterances, states } = many(13);
		const r = prep(utterances, states);
		expect(r.ok && r.value.window.length).toBe(12);
		expect(r.ok && r.value.deferred).toEqual([
			{ utteranceId: "u-13", reasonCode: "WINDOW_FULL" },
		]);
		const exact = many(12);
		const e = prep(exact.utterances, exact.states);
		expect(e.ok && e.value.window.length).toBe(12);
		expect(e.ok && e.value.deferred.length).toBe(0);
	});
	test("32KiB byte limit counts UTF-8 bytes, not characters", () => {
		const half = "あ".repeat(5461); // 16383 bytes
		const u = [utt(1, {}, half), utt(2, {}, half), utt(3, {}, "x")];
		const s = u.map((x, i) => stateOf(`m-${i + 1}`, [half, half, "x"][i]));
		const r = prep(u, s);
		expect(r.ok && r.value.window.map((w) => w.utteranceId)).toEqual([
			"u-1",
			"u-2",
			"u-3",
		]);
		expect(r.ok && r.value.windowBytes).toBe(16383 * 2 + 1);
		const over = [...u, utt(4, {}, "yy")];
		const o = prep(over, [...s, stateOf("m-4", "yy")]);
		expect(o.ok && o.value.window.length).toBe(3);
		expect(o.ok && o.value.deferred[0]?.reasonCode).toBe("WINDOW_FULL");
		// 32768 bytes exactly is allowed; 32769 is held without splitting.
		const exactText = "a".repeat(32768);
		const ok1 = prep([utt(1, {}, exactText)], [stateOf("m-1", exactText)]);
		expect(ok1.ok && ok1.value.status).toBe("prepared");
		const big = "a".repeat(32769);
		const held = prep([utt(1, {}, big)], [stateOf("m-1", big)]);
		expect(held.ok && held.value.status).toBe("held");
		expect(held.ok && held.value.deferred).toEqual([
			{ utteranceId: "u-1", reasonCode: "UTTERANCE_TOO_LARGE" },
		]);
	});
	test("unique dependency limit: 32 accepted, 33rd held; extras counted", () => {
		const extra = (i: number) => ({
			namespace: "goal",
			kind: "goal",
			id: `g-${i}`,
			revision: "1",
			digest: "d",
		});
		const extraState = (i: number) => ({
			...extra(i),
			principal: A.principal,
			scopeKey: A.scopeKey,
			status: "available",
		});
		const extras = (n: number) =>
			Array.from({ length: n }, (_, i) => extraState(i));
		const { utterances, states: baseStates } = many(12);
		const states = [...baseStates, ...extras(40)];
		const some = prep(utterances, states, {
			extraDependencies: Array.from({ length: 20 }, (_, i) => extra(i)),
		});
		expect(some.ok && some.value.manifest.dependencies.length).toBe(32);
		const tooMany = prep(utterances, states, {
			extraDependencies: Array.from({ length: 21 }, (_, i) => extra(i)),
		});
		expect(tooMany.ok && tooMany.value.window.length).toBe(11);
		expect(tooMany.ok && tooMany.value.deferred[0]?.reasonCode).toBe(
			"DEPENDENCY_LIMIT",
		);
		const all = prep([], states, {
			extraDependencies: Array.from({ length: 33 }, (_, i) => extra(i)),
		});
		expect(all.ok && all.value).toMatchObject({
			status: "held",
			holdReason: "DEPENDENCY_LIMIT",
		});
		// Duplicates are counted once.
		const dup = prep([], states, {
			extraDependencies: Array.from({ length: 40 }, () => extra(1)),
		});
		expect(dup.ok && dup.value.manifest.dependencies.length).toBe(1);
	});
	test("manifest lists non-cited inputs; unconfirmed/other-scope are held", () => {
		const r = prep(
			[utt(1), utt(2, { confirmed: false }), utt(3), utt(4)],
			[stateOf("m-1"), stateOf("m-2"), stateOf("m-3", text, B)],
			{},
		);
		expect(r.ok && r.value.window.map((w) => w.utteranceId)).toEqual(["u-1"]);
		expect(r.ok && r.value.deferred).toEqual([
			{ utteranceId: "u-2", reasonCode: "UNCONFIRMED_UTTERANCE" },
			{ utteranceId: "u-3", reasonCode: "SOURCE_UNAVAILABLE" },
			{ utteranceId: "u-4", reasonCode: "SOURCE_UNAVAILABLE" },
		]);
		expect(r.ok && r.value.manifest.dependencies.map((d) => d.id)).toEqual([
			"m-1",
		]);
	});
	test("strict input; inputs are not mutated; deterministic", () => {
		const { utterances, states } = many(3);
		const input = deepFreeze({
			contractVersion: 1,
			scope: A,
			utterances,
			sources: { states },
		});
		expect(prepareExtraction(input)).toEqual(prepareExtraction(input));
		expect(prepareExtraction({ ...input, extra: 1 }).ok).toBe(false);
		expect(prepareExtraction({ ...input, contractVersion: 2 }).ok).toBe(false);
		expect(
			prepareExtraction({
				...input,
				utterances: [utterances[0], utterances[0]],
			}).ok,
		).toBe(false);
	});
});

describe("A19 validateCandidates", () => {
	const window = [
		{
			utteranceId: "u-1",
			source: refOf("m-1"),
			origin: "user_report",
			rootEvidenceId: "root-1",
		},
	];
	const good = (extra: Record<string, unknown> = {}) => ({
		subject: { kind: "id", id: "svc-1" },
		predicate: "available",
		payload: { kind: "value", value: { kind: "boolean", value: true } },
		quote: { utteranceId: "u-1", startByte: 0, endByte: 18 },
		modality: "asserted",
		...extra,
	});
	const items = Array.from({ length: 12 }, (_, i) => ({
		assertionId: `claim-${i}`,
		evidenceId: `ev-${i}`,
	}));
	const base = (extra: Record<string, unknown> = {}) => ({
		contractVersion: 1,
		scope: A,
		window,
		manifest: { dependencies: [refOf("m-1"), refOf("m-extra")] },
		sources: {
			states: [stateOf("m-1"), stateOf("m-extra"), stateOf("m-other", text, B)],
		},
		entities,
		assigned: {
			recordedAt: 1791500000000,
			interpretationVersion: "interp-1",
			freshnessMaxAgeMs: 86_400_000,
			items,
		},
		...extra,
	});
	const run = (candidates: unknown[], extra: Record<string, unknown> = {}) => {
		const r = validateCandidates(
			base({ modelOutput: { candidates }, ...extra }),
			sha256,
		);
		if (!r.ok) throw new Error(`${r.code}:${r.path}`);
		return r.value;
	};
	const codes = (v: ReturnType<typeof run>["verdicts"][number]) =>
		v.status === "accepted" ? ["accepted"] : v.reasonCodes;

	test("a valid asserted candidate becomes a candidate-lifecycle draft", () => {
		const r = run([good()]);
		const v = r.verdicts[0]!;
		expect(v.status).toBe("accepted");
		if (v.status !== "accepted") return;
		expect(v.treatment).toBe("asserted");
		expect(v.draft.id).toBe("claim-0");
		expect(v.draft.origin).toBe("user_report");
		expect(v.draft.lifecycle).toBeUndefined();
		expect(v.draft.evidence[0]?.source.range).toEqual({
			startByte: 0,
			endByte: 18,
		});
		// Non-cited inputs stay in the manifest.
		expect(v.draft.inputManifest.map((d) => d.id)).toEqual(["m-1", "m-extra"]);
		// Nothing is handed on without an explicit selection.
		expect(r.handoff).toEqual([]);
		expect(r.acceptedIndexes).toEqual([0]);
	});
	test("negated, hypothetical and question never become facts; reported becomes a hypothesis", () => {
		const r = run([
			good({ modality: "negated" }),
			good({ modality: "hypothetical" }),
			good({ modality: "question" }),
			good({ modality: "reported" }),
		]);
		expect(r.verdicts.map(codes)).toEqual([
			["NEGATED_NOT_FACT"],
			["HYPOTHETICAL_NOT_FACT"],
			["QUESTION_NOT_CLAIM"],
			["accepted"],
		]);
		const v = r.verdicts[3]!;
		expect(v.status === "accepted" && v.treatment).toBe("reported");
		expect(v.status === "accepted" && v.draft.origin).toBe("model_hypothesis");
	});
	test("model-issued ids, times, authorization, active status, origin are rejected", () => {
		const r = run(
			[
				"id",
				"scope",
				"authorized",
				"active",
				"recordedAt",
				"origin",
				"confidence",
			].map((key) => good({ [key]: key === "scope" ? A : 1 })),
		);
		for (const v of r.verdicts)
			expect(codes(v)).toEqual(["FORBIDDEN_MODEL_FIELD"]);
		expect(codes(run([good({ surprise: 1 })]).verdicts[0]!)).toEqual([
			"MALFORMED_CANDIDATE",
		]);
	});
	test("subjects: unknown id rejected, alias unknown/ambiguous held, other-Scope invisible", () => {
		const r = run([
			good({ subject: { kind: "id", id: "ghost" } }),
			good({ subject: { kind: "alias", text: "存在しない" } }),
			good({ subject: { kind: "alias", text: "同名" } }),
			good({ subject: { kind: "id", id: "other-scope" } }),
			good({ subject: { kind: "alias", text: "他Scope名" } }),
			good({ subject: { kind: "alias", text: "音声サービス" } }),
		]);
		expect(r.verdicts.map(codes)).toEqual([
			["UNKNOWN_SUBJECT_ID"],
			["SUBJECT_UNRESOLVED"],
			["AMBIGUOUS_SUBJECT"],
			["UNKNOWN_SUBJECT_ID"],
			["SUBJECT_UNRESOLVED"],
			["accepted"],
		]);
		// An other-Scope miss is indistinguishable from an unknown name.
		expect(r.verdicts[3]).toEqual({ ...r.verdicts[0]!, index: 3 });
		expect(r.verdicts[4]).toEqual({ ...r.verdicts[1]!, index: 4 });
	});
	test("relations resolve the object; a non-existent object is held", () => {
		const rel = (object: unknown) =>
			good({ payload: { kind: "relation", relation: "depends_on", object } });
		const r = run([
			rel({ kind: "id", id: "svc-2" }),
			rel({ kind: "id", id: "ghost" }),
		]);
		expect(r.verdicts.map(codes)).toEqual([
			["accepted"],
			["OBJECT_UNRESOLVED"],
		]);
	});
	test("citations: missing source, out of range, char split, wrong window", () => {
		const r = run([
			good({ quote: { utteranceId: "u-9", startByte: 0, endByte: 3 } }),
			good({ quote: { utteranceId: "u-1", startByte: 0, endByte: 999 } }),
			good({ quote: { utteranceId: "u-1", startByte: 1, endByte: 6 } }),
			good({ quote: { utteranceId: "u-1", startByte: 3, endByte: 3 } }),
			good({ quote: { utteranceId: "u-1", startByte: 0, endByte: 3 } }),
		]);
		expect(r.verdicts.map(codes)).toEqual([
			["QUOTE_SOURCE_NOT_IN_WINDOW"],
			["QUOTE_OUT_OF_RANGE"],
			["QUOTE_OUT_OF_RANGE"],
			["QUOTE_OUT_OF_RANGE"],
			["accepted"],
		]);
	});
	test("conditions: model cannot self-declare unconditional; bad AST rejected", () => {
		const r = run([
			good({
				condition: {
					kind: "explicitly_unconditional",
					adoptionEvidenceId: "ev-0",
				},
			}),
			good({
				condition: { kind: "expression", expression: { kind: "bogus" } },
			}),
			good({
				condition: {
					kind: "expression",
					expression: {
						kind: "compare",
						key: "k",
						op: "eq",
						value: { kind: "boolean", value: true },
					},
				},
			}),
		]);
		expect(codes(r.verdicts[0]!)).toEqual(["CONDITION_NOT_PERMITTED"]);
		expect(codes(r.verdicts[1]!)).toEqual(["CONDITION_INVALID"]);
		expect(r.verdicts[2]!.status).toBe("accepted");
	});
	test("8 candidates ok, the 9th is rejected as overflow; every candidate has a verdict", () => {
		const eight = run(Array.from({ length: 8 }, () => good()));
		expect(eight.acceptedIndexes.length).toBe(8);
		const nine = run(Array.from({ length: 9 }, () => good()));
		expect(nine.verdicts.length).toBe(9);
		expect(codes(nine.verdicts[8]!)).toEqual(["CANDIDATE_OVERFLOW"]);
		expect(nine.acceptedIndexes.length).toBe(8);
	});
	test("invalid JSON / shapes are a batch-level rejection", () => {
		for (const modelOutput of [
			"{not json",
			"[1]",
			{ candidates: "x" },
			{ candidates: [], extra: 1 },
			null,
			Array.from({ length: 65 }, () => 0),
		]) {
			const r = validateCandidates(base({ modelOutput }), sha256);
			expect(r.ok && r.value.status).toBe("rejected");
			expect(r.ok && r.value.reasonCode).toBe("MALFORMED_OUTPUT");
		}
		const json = validateCandidates(
			base({ modelOutput: JSON.stringify({ candidates: [good()] }) }),
			sha256,
		);
		expect(json.ok && json.value.acceptedIndexes).toEqual([0]);
	});
	test("a partly invalid batch is not adopted silently; only explicit accepted selection is handed on", () => {
		const batch = [good(), good({ modality: "negated" }), good()];
		const none = run(batch);
		expect(none.status).toBe("validated");
		expect(none.handoff).toEqual([]);
		const picked = run(batch, { selectedIndexes: [2] });
		expect(picked.handoff.map((h) => h.index)).toEqual([2]);
		const bad = run(batch, { selectedIndexes: [0, 1] });
		expect(bad.status).toBe("rejected");
		expect(bad.reasonCode).toBe("SELECTION_INVALID");
		expect(bad.handoff).toEqual([]);
		expect(bad.verdicts.length).toBe(3);
		expect(run(batch, { selectedIndexes: [0, 0] }).handoff).toEqual([]);
	});
	test("missing host assignment and other-Scope sources never leak or pass", () => {
		const r = validateCandidates(
			base({
				modelOutput: { candidates: [good(), good()] },
				assigned: {
					recordedAt: 1,
					interpretationVersion: "v",
					freshnessMaxAgeMs: 1,
					items: [{ assertionId: "c0", evidenceId: "e0" }],
				},
			}),
			sha256,
		);
		expect(r.ok && r.value.verdicts.map(codes)).toEqual([
			["accepted"],
			["HOST_ASSIGNMENT_MISSING"],
		]);
		// The window utterance's state lives in another Scope.
		const other = validateCandidates(
			base({
				sources: { states: [stateOf("m-1", text, B), stateOf("m-extra")] },
				modelOutput: { candidates: [good()] },
			}),
			sha256,
		);
		expect(other.ok && other.value.verdicts.map(codes)).toEqual([
			["SOURCE_NOT_AVAILABLE"],
		]);
	});
	test("single-draft check agrees with the batch verdict; inputs are not mutated", () => {
		const frozen = deepFreeze(base({ candidate: good() }));
		const single = validateCandidate(frozen, sha256);
		const batch = run([good()]);
		expect(single.ok ? single.value : undefined).toEqual(batch.verdicts[0]);
		expect(validateCandidate(base({ candidate: 5 }), sha256)).toEqual({
			ok: true,
			value: {
				index: 0,
				status: "rejected",
				reasonCodes: ["MALFORMED_CANDIDATE"],
			},
		});
		expect(validateCandidate({ ...base(), modelOutput: 1 }, sha256).ok).toBe(
			false,
		);
	});
	test("a candidate that alone overflows the draft cap is rejected alone (CANDIDATE_TOO_LARGE)", () => {
		const big = {
			kind: "expression",
			expression: {
				kind: "all",
				items: Array.from({ length: 16 }, (_, i) => ({
					kind: "compare",
					key: `k${i}`,
					op: "eq",
					value: { kind: "string", value: "x".repeat(3900) },
				})),
			},
		};
		// 31 long manifest ids make the host part of the draft large as well.
		const deps = Array.from({ length: 31 }, (_, i) =>
			refOf(`${"d".repeat(200)}-${i}`),
		);
		const r = validateCandidates(
			base({
				manifest: { dependencies: [refOf("m-1"), ...deps] },
				sources: {
					states: [stateOf("m-1"), ...deps.map((d) => stateOf(d.id))],
				},
				modelOutput: { candidates: [good(), good({ condition: big }), good()] },
			}),
			sha256,
		);
		if (!r.ok) throw new Error(`${r.code}:${r.path}`);
		expect(r.value.verdicts.map(codes)).toEqual([
			["accepted"],
			["CANDIDATE_TOO_LARGE"],
			["accepted"],
		]);
	});
	test("model output over 64KiB is refused in both string and object form", () => {
		const pad = { subject: "y".repeat(40_000), more: "z".repeat(40_000) };
		for (const modelOutput of [
			{ candidates: [good(pad)] },
			JSON.stringify({ candidates: [good(pad)] }),
		]) {
			const r = validateCandidates(base({ modelOutput }), sha256);
			expect(r.ok && r.value.reasonCode).toBe("MALFORMED_OUTPUT");
		}
	});
	test("host faults fail the whole call: window over 32KiB, duplicate utteranceId, range or >500 raw manifest entries", () => {
		const huge = "a".repeat(32769);
		const hugeWindow = [{ ...window[0]!, source: refOf("m-1", huge) }];
		const outputs = { modelOutput: { candidates: [good()] } };
		const fails = (extra: Record<string, unknown>) =>
			validateCandidates(base({ ...outputs, ...extra }), sha256);
		const tooBig = fails({
			window: hugeWindow,
			manifest: { dependencies: [refOf("m-1", huge)] },
			sources: { states: [stateOf("m-1", huge)] },
		});
		expect(!tooBig.ok && tooBig.code).toBe("LIMIT_EXCEEDED");
		const dup = fails({ window: [window[0], window[0]] });
		expect(!dup.ok && dup.code).toBe("INVALID_INPUT");
		const ranged = fails({
			manifest: {
				dependencies: [
					{ ...refOf("m-1"), range: { startByte: 0, endByte: 3 } },
					refOf("m-extra"),
				],
			},
		});
		expect(!ranged.ok && ranged.code).toBe("INVALID_INPUT");
		const raw = fails({
			manifest: {
				dependencies: Array.from({ length: 501 }, () => refOf("m-1")),
			},
		});
		expect(!raw.ok && raw.code).toBe("LIMIT_EXCEEDED");
		const dedup = fails({
			manifest: {
				dependencies: Array.from({ length: 500 }, () => refOf("m-1")),
			},
		});
		expect(dedup.ok).toBe(true);
	});
	test("a missing host assignment is a rejection (not a hold) of that candidate only", () => {
		const r = validateCandidates(
			base({
				modelOutput: { candidates: [good(), good()] },
				assigned: {
					recordedAt: 1,
					interpretationVersion: "v",
					freshnessMaxAgeMs: 1,
					items: [{ assertionId: "c0", evidenceId: "e0" }],
				},
			}),
			sha256,
		);
		expect(r.ok && r.value.verdicts[1]?.status).toBe("rejected");
	});
});

describe("review fixes: host context checks", () => {
	const window = [
		{
			utteranceId: "u-1",
			source: refOf("m-1"),
			origin: "user_report",
			rootEvidenceId: "root-1",
		},
	];
	const candidate = {
		subject: { kind: "id", id: "svc-1" },
		predicate: "available",
		payload: { kind: "value", value: { kind: "boolean", value: true } },
		quote: { utteranceId: "u-1", startByte: 0, endByte: 18 },
		modality: "asserted",
	};
	const base = (extra: Record<string, unknown> = {}) => ({
		contractVersion: 1,
		scope: A,
		window,
		manifest: { dependencies: [refOf("m-1")] },
		sources: { states: [stateOf("m-1")] },
		entities,
		assigned: {
			recordedAt: 1791500000000,
			interpretationVersion: "interp-1",
			freshnessMaxAgeMs: 86_400_000,
			items: [
				{ assertionId: "claim-0", evidenceId: "ev-0" },
				{ assertionId: "claim-1", evidenceId: "ev-1" },
			],
		},
		modelOutput: { candidates: [candidate] },
		...extra,
	});
	test("a manifest that omits a window source is rejected, never accepted with 0 inputs", () => {
		for (const manifest of [
			{ dependencies: [] },
			{ dependencies: [refOf("other")] },
		]) {
			const r = validateCandidates(base({ manifest }), sha256);
			expect(r).toMatchObject({ ok: false, code: "INVALID_INPUT" });
		}
		const ok = validateCandidates(base(), sha256);
		expect(ok.ok && ok.value.verdicts[0]?.status).toBe("accepted");
	});
	test("assigned ids must be unique so two drafts never share an id", () => {
		for (const items of [
			[
				{ assertionId: "claim-0", evidenceId: "ev-0" },
				{ assertionId: "claim-0", evidenceId: "ev-1" },
			],
			[
				{ assertionId: "claim-0", evidenceId: "ev-0" },
				{ assertionId: "claim-1", evidenceId: "ev-0" },
			],
		]) {
			const assigned = {
				recordedAt: 1791500000000,
				interpretationVersion: "interp-1",
				freshnessMaxAgeMs: 86_400_000,
				items,
			};
			expect(validateCandidates(base({ assigned }), sha256)).toMatchObject({
				ok: false,
				code: "INVALID_INPUT",
			});
		}
	});
});

describe("round 2: host faults fail the call; manifests are normalized", () => {
	const window = [
		{
			utteranceId: "u-1",
			source: refOf("m-1"),
			origin: "user_report",
			rootEvidenceId: "root-1",
		},
	];
	const candidate = {
		subject: { kind: "id", id: "svc-1" },
		predicate: "available",
		payload: { kind: "value", value: { kind: "boolean", value: true } },
		quote: { utteranceId: "u-1", startByte: 0, endByte: 18 },
		modality: "asserted",
	};
	const input = (extra: Record<string, unknown> = {}) => ({
		contractVersion: 1,
		scope: A,
		window,
		manifest: { dependencies: [refOf("m-1"), refOf("m-x"), refOf("m-y")] },
		sources: {
			states: [stateOf("m-1"), stateOf("m-x"), stateOf("m-y")],
		},
		entities,
		assigned: {
			recordedAt: 1791500000000,
			interpretationVersion: "interp-1",
			freshnessMaxAgeMs: 86_400_000,
			items: [{ assertionId: "claim-0", evidenceId: "ev-0" }],
		},
		modelOutput: { candidates: [candidate] },
		selectedIndexes: [0],
		...extra,
	});
	test("malformed entities / >2000 states fail the whole call, not the candidate", () => {
		const badEntities = validateCandidates(
			input({ entities: [{ bogus: 1 }] }),
			sha256,
		);
		expect(badEntities.ok).toBe(false);
		const states = Array.from({ length: 2001 }, (_, i) => stateOf(`m-${i}`));
		const tooMany = validateCandidates(input({ sources: { states } }), sha256);
		expect(tooMany.ok).toBe(false);
		expect(!tooMany.ok && tooMany.code).toBe("LIMIT_EXCEEDED");
		const prepared = prepareExtraction({
			contractVersion: 1,
			scope: A,
			utterances: [],
			sources: { states },
		});
		expect(prepared.ok).toBe(false);
	});
	test("prepare rejects extras that validate would reject; duplicate states are refused", () => {
		const prepared = prepareExtraction({
			contractVersion: 1,
			scope: A,
			utterances: [],
			sources: { states: [stateOf("m-1")] },
			extraDependencies: [refOf("absent")],
		});
		expect(!prepared.ok && prepared.path).toBe("input.extraDependencies[0]");
		for (const fn of [
			() =>
				prepareExtraction({
					contractVersion: 1,
					scope: A,
					utterances: [],
					sources: { states: [stateOf("m-1"), stateOf("m-1", "別内容")] },
				}),
			() =>
				validateCandidates(
					input({ sources: { states: [stateOf("m-1"), stateOf("m-1")] } }),
					sha256,
				),
		])
			expect(fn().ok).toBe(false);
	});
	test("prepare holds an utterance whose content does not match its digest when a hasher is injected", () => {
		const tampered = { ...stateOf("m-1"), content: "改ざんされた本文" };
		const args = {
			contractVersion: 1,
			scope: A,
			utterances: [utt(1)],
			sources: { states: [tampered] },
		};
		const withHasher = prepareExtraction(args, sha256);
		expect(withHasher.ok && withHasher.value.status).toBe("held");
		expect(withHasher.ok && withHasher.value.deferred).toEqual([
			{ utteranceId: "u-1", reasonCode: "SOURCE_UNAVAILABLE" },
		]);
	});
	test("handoff manifest is deduplicated, sorted and permutation-stable", () => {
		const forward = validateCandidates(input(), sha256);
		const shuffled = validateCandidates(
			input({
				manifest: {
					dependencies: [
						refOf("m-y"),
						refOf("m-x"),
						refOf("m-1"),
						refOf("m-x"),
					],
				},
			}),
			sha256,
		);
		expect(forward.ok && shuffled.ok).toBe(true);
		const manifestOf = (r: typeof forward) =>
			r.ok && r.value.handoff[0]?.draft.inputManifest.map((m) => m.id);
		expect(manifestOf(forward)).toEqual(["m-1", "m-x", "m-y"]);
		expect(manifestOf(shuffled)).toEqual(manifestOf(forward));
		// 33 raw entries with only 3 unique are fine; 33 unique are not.
		const dupes = Array.from({ length: 33 }, () => refOf("m-1"));
		expect(
			validateCandidates(
				input({
					manifest: { dependencies: [...dupes, refOf("m-x"), refOf("m-y")] },
				}),
				sha256,
			).ok,
		).toBe(true);
		const unique = Array.from({ length: 33 }, (_, i) => refOf(`m-u${i}`));
		const over = validateCandidates(
			input({ manifest: { dependencies: [refOf("m-1"), ...unique] } }),
			sha256,
		);
		expect(!over.ok && over.code).toBe("LIMIT_EXCEEDED");
	});
	test("an oversized model output is MALFORMED_OUTPUT (bounded before parsing)", () => {
		const big = JSON.stringify({ candidates: [], pad: "x".repeat(70_000) });
		const r = validateCandidates(input({ modelOutput: big }), sha256);
		expect(r.ok && r.value.reasonCode).toBe("MALFORMED_OUTPUT");
		const object = validateCandidates(
			input({
				modelOutput: { candidates: [candidate], pad: "あ".repeat(30_000) },
			}),
			sha256,
		);
		expect(object.ok && object.value.reasonCode).toBe("MALFORMED_OUTPUT");
	});
});
