import { describe, expect, test } from "bun:test";
import {
	buildWorldSlice,
	toSliceReceipt,
	validateSliceUsage,
	type WorldSlice,
} from "../index.ts";
import { A, B, rec, sha256, sliceInput, state } from "./helpers.ts";

const jp = (id: string, n: number, extra: Record<string, unknown> = {}) =>
	rec(id, {
		payload: {
			kind: "value",
			value: { kind: "string", value: "あ".repeat(n) },
		},
		...extra,
	});
const build = (
	assertions: Record<string, unknown>[],
	request: Record<string, unknown> = {},
	extra: Record<string, unknown> = {},
): WorldSlice => {
	const r = buildWorldSlice(sliceInput(assertions, request, extra), sha256);
	if (!r.ok) throw new Error(`${r.code}@${r.path}`);
	return r.value;
};
const utf8 = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;
/** The budgeted presentation: units + assertionVersions + sourceVersions. */
const presentation = (slice: WorldSlice) =>
	utf8(slice.units) +
	utf8(slice.assertionVersions) +
	utf8(slice.sourceVersions);

describe("A13 byte budget", () => {
	test("units are counted in UTF-8 bytes of the units JSON, not characters", () => {
		const slice = build([jp("c1", 1000)]);
		expect(slice.status).toBe("ready");
		expect(slice.budget.usedBytes).toBe(presentation(slice));
		expect(slice.budget.usedBytes).toBeGreaterThan(3000);
		// 1000 characters but > 3000 bytes: a character-count budget would pass.
		const tight = build([jp("c1", 1000)], { maxBytes: 1500 });
		expect(tight.status).toBe("overflow");
	});
	test("exact boundary: fits at the limit, partial when one byte short", () => {
		const two = [jp("c1", 700), jp("c2", 700)];
		const full = build(two);
		expect(full.status).toBe("ready");
		const used = full.budget.usedBytes;
		expect(build(two, { maxBytes: used }).status).toBe("ready");
		const short = build(two, { maxBytes: used - 1 });
		expect(short.status).toBe("partial");
		expect(short.reasonCodes).toEqual(["UNITS_OMITTED_BY_BUDGET"]);
		expect(short.completeness).toEqual({ complete: false, omittedUnits: 1 });
		expect(short.units.length).toBe(1);
		expect(presentation(short)).toBeLessThanOrEqual(used - 1);
	});
	test("default budget is 8192 bytes and a host budget cannot raise it", () => {
		const many = Array.from({ length: 6 }, (_, i) => jp(`c${i}`, 700));
		const slice = build(many, { maxBytes: 1_000_000 });
		expect(slice.budget.maxBytes).toBe(8192);
		expect(slice.budget.usedBytes).toBeLessThanOrEqual(8192);
		expect(slice.status).toBe("partial");
		expect(slice.units.length + slice.completeness.omittedUnits).toBe(6);
	});
	test("a mandatory unit that cannot fit is overflow, with no partial unit", () => {
		const slice = build([jp("big", 1300), jp("small", 5)], {
			focusSubjectIds: ["svc-big"],
			maxBytes: 3000,
		});
		expect(slice.status).toBe("overflow");
		expect(slice.reasonCodes).toEqual(["REQUIRED_UNIT_EXCEEDS_BUDGET"]);
		expect(slice.units).toEqual([]);
	});
	test("units are whole: condition and refutation are never dropped alone", () => {
		const condition = {
			kind: "expression",
			expression: {
				kind: "compare",
				op: "eq",
				key: "mode",
				value: { kind: "string", value: "night" },
			},
		};
		const slice = build(
			[
				jp("c1", 40, { condition, lifecycle: "disputed" }),
				jp("c2", 40, { contradicts: [{ id: "c1", revision: 1 }] }),
			],
			{ focusSubjectIds: ["svc-c1"] },
		);
		const unit = slice.units.find((u) => u.assertionId === "c1")!;
		expect(unit.condition as unknown).toEqual(condition);
		expect(unit.refutations).toEqual([{ id: "c2", revision: 1 }]);
		expect(unit.sources.length).toBe(1);
		for (const u of slice.units) {
			expect(u).toHaveProperty("conclusion");
			expect(u).toHaveProperty("condition");
			expect(u).toHaveProperty("refutations");
			expect(u).toHaveProperty("sources");
		}
		// shrinking the budget drops whole units only
		const first = build([jp("c1", 40, { lifecycle: "disputed" })]);
		const one = build([jp("c1", 40, { lifecycle: "disputed" }), jp("c2", 40)], {
			maxBytes: first.budget.usedBytes,
		});
		expect(one.units.length).toBe(1);
		for (const u of one.units) expect(u).toHaveProperty("condition");
	});
	test("priority: disabled > blocked > overflow > partial > ready", () => {
		const base = [jp("big", 1300)];
		const request = { focusSubjectIds: ["svc-big"], maxBytes: 3000 };
		expect(build(base, request).status).toBe("overflow");
		expect(build(base, request, { complete: false }).status).toBe("blocked");
		expect(
			build(base, request, { complete: false, worldEnabled: false }).status,
		).toBe("disabled");
		expect(build([]).status).toBe("partial");
		expect(build([]).reasonCodes).toEqual(["NO_ELIGIBLE_UNITS"]);
	});
});

describe("Slice stability", () => {
	const ledger = () => [
		jp("c1", 20),
		jp("c2", 20, {
			lifecycle: "disputed",
			contradicts: [{ id: "c3", revision: 1 }],
		}),
		jp("c3", 20, {
			evidence: [],
			origin: "model_hypothesis",
			lifecycle: "candidate",
		}),
	];
	test("input order permutations give the same units, order and digest", () => {
		const a = build(ledger());
		const b = build([...ledger()].reverse());
		const c = build(
			ledger(),
			{},
			{ sources: [state(), state({ id: "src-9", digest: "d9" })] },
		);
		expect(b).toEqual(a);
		expect(b.digest).toBe(a.digest);
		expect(c.digest).toBe(a.digest); // unrelated source state is not part of the Slice
		expect(a.units.map((u) => u.assertionId)).toEqual(["c1", "c2", "c3"]);
		expect(a.units[2]?.stance).toBe("hypothesis");
	});
	test("digest changes with any version or epoch", () => {
		const a = build(ledger());
		expect(build(ledger(), {}, { scopeEpoch: 8 }).digest).not.toBe(a.digest);
		expect(build(ledger(), {}, { policyRevision: "policy-2" }).digest).not.toBe(
			a.digest,
		);
		expect(
			build(ledger(), { goalRef: { id: "g1", revision: 1 } }).digest,
		).not.toBe(a.digest);
	});
	test("focus subjects come first and inputs are never mutated", () => {
		const input = sliceInput(ledger(), { focusSubjectIds: ["svc-c3"] });
		const before = JSON.stringify(input);
		const r = buildWorldSlice(input, sha256);
		expect(r.ok && r.value.units[0]?.assertionId).toBe("c3");
		expect(JSON.stringify(input)).toBe(before);
	});
	test("strict request validation", () => {
		for (const request of [
			{ maxBytes: 0 },
			{ maxBytes: 1.5 },
			{ focusSubjectIds: [""] },
			{ goalRef: { id: "g" } },
			{ unknown: true },
		])
			expect(buildWorldSlice(sliceInput([], request), sha256).ok).toBe(false);
		expect(
			buildWorldSlice({ ...sliceInput([]), contractVersion: 2 }, sha256),
		).toMatchObject({
			ok: false,
			code: "UNSUPPORTED_CONTRACT_VERSION",
		});
	});
});

describe("A24 usage re-validation (pure)", () => {
	const slice = build([jp("claim-1", 10)]);
	const receipt = toSliceReceipt(slice);
	const current = (extra: Record<string, unknown> = {}) => ({
		scope: A,
		authorized: true,
		worldEnabled: true,
		scopeEpoch: 7,
		policyRevision: "policy-1",
		forgetEpoch: "forget-1",
		restoreEpoch: "restore-1",
		interpretationVersion: "interp-1",
		assertions: [{ id: "claim-1", revision: 1, lifecycle: "active" }],
		sources: [state()],
		...extra,
	});
	const check = (c: Record<string, unknown>, r: unknown = receipt): unknown => {
		const result = validateSliceUsage({
			contractVersion: 1,
			receipt: r,
			current: c,
		});
		return result.ok ? result.value : result;
	};
	test("unchanged facts are valid", () => {
		expect(check(current())).toEqual({ status: "valid" });
		expect(receipt.status).toBe("ready");
	});
	test.each([
		["scope epoch", { scopeEpoch: 8 }, "SCOPE_EPOCH_CHANGED"],
		["policy", { policyRevision: "policy-2" }, "POLICY_CHANGED"],
		["forget epoch", { forgetEpoch: "forget-2" }, "FORGET_EPOCH_CHANGED"],
		["restore epoch", { restoreEpoch: "restore-2" }, "RESTORE_EPOCH_CHANGED"],
		[
			"interpretation",
			{ interpretationVersion: "interp-2" },
			"INTERPRETATION_CHANGED",
		],
		[
			"revision",
			{ assertions: [{ id: "claim-1", revision: 2, lifecycle: "active" }] },
			"ASSERTION_CHANGED",
		],
		[
			"lifecycle",
			{ assertions: [{ id: "claim-1", revision: 1, lifecycle: "disputed" }] },
			"ASSERTION_CHANGED",
		],
		["assertion gone", { assertions: [] }, "ASSERTION_CHANGED"],
		[
			"source revision",
			{ sources: [state({ revision: "rev-2" })] },
			"SOURCE_CHANGED",
		],
		[
			"source forgotten",
			{ sources: [state({ status: "forgotten" })] },
			"SOURCE_CHANGED",
		],
		["source missing", { sources: [] }, "SOURCE_CHANGED"],
		["not authorized", { authorized: false }, "ACCESS_DENIED"],
		["World OFF", { worldEnabled: false }, "WORLD_DISABLED"],
	])("%s change blocks the old Slice", (_name, extra, code) => {
		expect(check(current(extra))).toEqual({
			status: "blocked",
			reasonCode: code,
		});
	});
	test("another Scope's source state cannot keep the Slice valid", () => {
		const foreign = state({ principal: "p-zzz", scopeKey: "other" });
		expect(check(current({ sources: [foreign] }))).toEqual({
			status: "blocked",
			reasonCode: "SOURCE_CHANGED",
		});
		// ...and a foreign twin next to the real state does not break or mask it.
		expect(check(current({ sources: [foreign, state()] }))).toEqual({
			status: "valid",
		});
		expect(
			check(current({ sources: [foreign, state({ status: "forgotten" })] })),
		).toEqual({ status: "blocked", reasonCode: "SOURCE_CHANGED" });
	});
	test("duplicate current entries are rejected, not resolved by array order", () => {
		const dupSources = [state({ revision: "rev-2" }), state()];
		for (const sources of [dupSources, [...dupSources].reverse()])
			expect(check(current({ sources }))).toMatchObject({
				ok: false,
				code: "INVALID_INPUT",
			});
		expect(
			check(
				current({
					assertions: [
						{ id: "claim-1", revision: 1, lifecycle: "active" },
						{ id: "claim-1", revision: 1, lifecycle: "disputed" },
					],
				}),
			),
		).toMatchObject({ ok: false, code: "INVALID_INPUT" });
	});
	test("matching assertion IDs alone are not enough (epoch moved, same claim)", () => {
		expect(check(current({ scopeEpoch: 8 }))).toMatchObject({
			status: "blocked",
		});
	});
	test("an update in another Scope does not invalidate this Slice", () => {
		// Scope B moved to epoch 99; Scope A's current facts are unchanged.
		const otherScopeCurrent = current({ scope: B, scopeEpoch: 99 });
		expect(check(otherScopeCurrent)).toEqual({
			status: "blocked",
			reasonCode: "ACCESS_DENIED",
		});
		expect(check(current())).toEqual({ status: "valid" });
	});
	test("overflow/blocked/disabled Slices are not usable", () => {
		for (const status of ["overflow", "blocked", "disabled"])
			expect(check(current(), { ...receipt, status })).toEqual({
				status: "blocked",
				reasonCode: "SLICE_NOT_USABLE",
			});
	});
	test("strict receipt/current validation", () => {
		expect(check(current(), { ...receipt, extra: 1 })).toMatchObject({
			ok: false,
		});
		expect(check({ ...current(), extra: 1 })).toMatchObject({ ok: false });
		expect(
			validateSliceUsage({ contractVersion: 2, receipt, current: current() }),
		).toMatchObject({
			ok: false,
			code: "UNSUPPORTED_CONTRACT_VERSION",
		});
		expect(validateSliceUsage(null).ok).toBe(false);
	});
});

describe("review fixes: presentation budget, headers, focus", () => {
	const longSource = (n: number) =>
		state({ id: `src-${"x".repeat(150)}-${n}` });
	test("version arrays count toward the 8KiB budget", () => {
		// 40 assertions, each citing a distinct 150-char source id.
		const ledger = Array.from({ length: 40 }, (_, i) =>
			jp(`c${String(i).padStart(2, "0")}`, 5, {
				evidence: [
					{
						evidenceId: `ev-${i}`,
						kind: "user_statement",
						stance: "supports",
						source: {
							namespace: "conversation",
							kind: "message",
							id: `src-${"x".repeat(150)}-${i}`,
							revision: "rev-1",
							digest: state().digest,
						},
						rootEvidenceId: `root-${i}`,
					},
				],
			}),
		);
		const sources = ledger.map((_, i) => longSource(i));
		const slice = build(ledger, {}, { sources });
		expect(presentation(slice)).toBeLessThanOrEqual(8192);
		expect(slice.budget.usedBytes).toBe(presentation(slice));
		expect(slice.status).toBe("partial");
		expect(slice.reasonCodes).toContain("UNITS_OMITTED_BY_BUDGET");
		expect(slice.assertionVersions.length).toBe(slice.units.length);
	});
	test("unauthorized and disabled headers carry no Scope state", () => {
		for (const [extra, status] of [
			[
				{
					checks: {
						authorized: false,
						correctionsResolved: true,
						restoreVerified: true,
					},
				},
				"blocked",
			],
			[{ worldEnabled: false }, "disabled"],
		] as const) {
			const slice = build(
				[jp("c1", 5)],
				{},
				{
					scopeEpoch: 99,
					policyRevision: "policy-secret",
					forgetEpoch: "forget-secret",
					restoreEpoch: "restore-secret",
					interpretationVersion: "interp-secret",
					...extra,
				},
			);
			expect(slice.status).toBe(status);
			const text = JSON.stringify(slice);
			for (const leaked of [
				"policy-secret",
				"forget-secret",
				"restore-secret",
				"interp-secret",
			])
				expect(text).not.toContain(leaked);
			expect(slice.scopeEpoch).toBe(0);
			expect(slice.units).toEqual([]);
			expect(slice.assertionVersions).toEqual([]);
		}
	});
	test("unauthorized wins over disabled: the caller does not learn the setting", () => {
		const slice = build(
			[],
			{},
			{
				worldEnabled: false,
				checks: {
					authorized: false,
					correctionsResolved: true,
					restoreVerified: true,
				},
			},
		);
		expect(slice.status).toBe("blocked");
		expect(slice.reasonCodes).toEqual(["ACCESS_NOT_VERIFIED"]);
	});
	test("a focus subject without an eligible unit is partial, not ready", () => {
		const slice = build([jp("c1", 5)], {
			focusSubjectIds: ["svc-nonexistent"],
		});
		expect(slice.status).toBe("partial");
		expect(slice.reasonCodes).toContain("FOCUS_NOT_FOUND");
		const found = build([jp("c1", 5)], { focusSubjectIds: ["svc-c1"] });
		expect(found.status).toBe("ready");
		expect(found.reasonCodes).toEqual([]);
	});
	test("400+ sources: projection and Slice are built, not rejected for size", () => {
		const sources = Array.from({ length: 450 }, (_, i) =>
			state({ id: `src-${"y".repeat(120)}-${i}` }),
		);
		const slice = build([jp("c1", 5)], {}, { sources: [state(), ...sources] });
		expect(slice.status).toBe("ready");
	});
});
