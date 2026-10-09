import { describe, expect, test } from "bun:test";
import {
	buildProjection,
	buildWorldSlice,
	planScopeEpoch,
	type Projection,
} from "../index.ts";
import {
	B,
	NOW,
	freeze,
	rec,
	sha256,
	sliceInput,
	snapshot,
	state,
} from "./helpers.ts";

const project = (assertions: Record<string, unknown>[], extra = {}) =>
	buildProjection(
		{ contractVersion: 1, snapshot: snapshot(assertions, extra) },
		sha256,
	);
const ok = (r: ReturnType<typeof project>): Projection => {
	if (!r.ok) throw new Error(`${r.code}@${r.path}`);
	return r.value;
};

describe("A12 projection states", () => {
	const ledger = () => [
		rec("fresh"),
		rec("stale", { observedAt: NOW - 90_000_000 }),
		rec("disputed", { lifecycle: "disputed" }),
		rec("cand", {
			lifecycle: "candidate",
			origin: "model_hypothesis",
			evidence: [],
		}),
		rec("inv", { lifecycle: "invalidated" }),
		rec("sup", { lifecycle: "superseded" }),
		rec("ret", { lifecycle: "retracted" }),
	];
	test("states are separated; terminal ones are excluded", () => {
		const p = ok(project(ledger()));
		const by = Object.fromEntries(p.entries.map((e) => [e.id, e]));
		expect(Object.keys(by).sort()).toEqual([
			"cand",
			"disputed",
			"fresh",
			"stale",
		]);
		expect(by["fresh"]).toMatchObject({
			status: "active",
			freshness: "fresh",
			causalEligible: true,
		});
		expect(by["stale"]).toMatchObject({ status: "active", freshness: "stale" });
		expect(by["disputed"]).toMatchObject({
			status: "disputed",
			causalEligible: false,
		});
		expect(by["cand"]).toMatchObject({
			status: "candidate",
			causalEligible: false,
		});
		expect(p.excluded.map((e) => [e.id, e.reason])).toEqual([
			["inv", "TERMINAL_LIFECYCLE"],
			["ret", "TERMINAL_LIFECYCLE"],
			["sup", "TERMINAL_LIFECYCLE"],
		]);
	});
	test("a refuting assertion appears on the disputed one", () => {
		const p = ok(
			project([
				rec("claim-1", { lifecycle: "disputed" }),
				rec("counter", { contradicts: [{ id: "claim-1", revision: 1 }] }),
			]),
		);
		const claim = p.entries.find((e) => e.id === "claim-1")!;
		expect(claim.refutations).toEqual([{ id: "counter", revision: 1 }]);
		expect(claim.causalEligible).toBe(false);
	});
	test("a changed source excludes the assertion and blocks the Slice", () => {
		const changed = [state({ revision: "rev-2" })];
		const p = ok(project([rec("c1")], { sources: changed }));
		expect(p.entries).toEqual([]);
		expect(p.excluded[0]?.reason).toBe("SOURCE_NOT_CURRENT");
		const slice = buildWorldSlice(
			sliceInput([rec("c1")], {}, { sources: changed }),
			sha256,
		);
		expect(slice.ok && [slice.value.status, slice.value.reasonCodes]).toEqual([
			"blocked",
			["SOURCE_NOT_CURRENT"],
		]);
		const forgotten = buildWorldSlice(
			sliceInput(
				[rec("c1")],
				{},
				{ sources: [state({ status: "forgotten" })] },
			),
			sha256,
		);
		expect(forgotten.ok && forgotten.value.status).toBe("blocked");
	});
	test("complete=false, unresolved correction and unverified restore block; OFF disables", () => {
		for (const [extra, code] of [
			[{ complete: false }, "SNAPSHOT_INCOMPLETE"],
			[
				{
					checks: {
						authorized: true,
						correctionsResolved: false,
						restoreVerified: true,
					},
				},
				"CORRECTION_UNRESOLVED",
			],
			[
				{
					checks: {
						authorized: true,
						correctionsResolved: true,
						restoreVerified: false,
					},
				},
				"RESTORE_UNVERIFIED",
			],
		] as const) {
			const r = buildWorldSlice(sliceInput([rec("c1")], {}, extra), sha256);
			expect(r.ok && [r.value.status, r.value.reasonCodes]).toEqual([
				"blocked",
				[code],
			]);
		}
		// disabled outranks blocked
		const off = buildWorldSlice(
			sliceInput([rec("c1")], {}, { worldEnabled: false, complete: false }),
			sha256,
		);
		expect(off.ok && [off.value.status, off.value.units]).toEqual([
			"disabled",
			[],
		]);
	});
	test("authorization failure reveals no names, counts or existence", () => {
		const r = buildWorldSlice(
			sliceInput(
				[rec("secret-claim")],
				{},
				{
					checks: {
						authorized: false,
						correctionsResolved: true,
						restoreVerified: true,
					},
				},
			),
			sha256,
		);
		expect(r.ok && r.value.status).toBe("blocked");
		const text = JSON.stringify(r);
		expect(text).not.toContain("secret-claim");
		expect(
			r.ok && [
				r.value.units,
				r.value.assertionVersions,
				r.value.sourceVersions,
			],
		).toEqual([[], [], []]);
		const projection = buildProjection(
			{
				contractVersion: 1,
				snapshot: snapshot([rec("secret-claim")], {
					checks: {
						authorized: false,
						correctionsResolved: true,
						restoreVerified: true,
					},
				}),
			},
			sha256,
		);
		expect(projection).toEqual({
			ok: false,
			code: "SCOPE_NOT_PERMITTED",
			path: "snapshot",
		});
	});
	test("another Scope's row is rejected without echoing it", () => {
		const r = project([rec("c1"), rec("other-scope-claim", { scope: B })]);
		expect(r).toEqual({
			ok: false,
			code: "SCOPE_NOT_PERMITTED",
			path: "snapshot",
		});
		const s = project([rec("c1")], {
			sources: [state({ scopeKey: "scope-b" })],
		});
		expect(s.ok).toBe(false);
	});
	test("strict unknown input: extra keys, bad version, duplicates, non-objects", () => {
		expect(
			buildProjection({ contractVersion: 2, snapshot: snapshot([]) }, sha256),
		).toMatchObject({
			ok: false,
			code: "UNSUPPORTED_CONTRACT_VERSION",
		});
		expect(project([rec("c1"), rec("c1")]).ok).toBe(false);
		expect(project([rec("c1", { confidence: 0.9 })]).ok).toBe(false);
		expect(project([rec("c1", { lifecycle: "verified" })]).ok).toBe(false);
		expect(buildProjection(null, sha256).ok).toBe(false);
		expect(
			buildProjection(
				{ contractVersion: 1, snapshot: { ...snapshot([]), extra: 1 } },
				sha256,
			).ok,
		).toBe(false);
	});
	test("inputs are not mutated and results are order independent", () => {
		const ledger = freeze(ledgerOf());
		const a = ok(project(ledger as Record<string, unknown>[]));
		const b = ok(project([...ledger].reverse() as Record<string, unknown>[]));
		expect(a).toEqual(b);
	});
});

function ledgerOf() {
	return [
		rec("c1"),
		rec("c2", { lifecycle: "disputed" }),
		rec("c3", { lifecycle: "retracted" }),
	];
}

describe("A24 scope epoch material", () => {
	test("a new refutation changes the material digest and advances the epoch once", () => {
		const before = ok(project([rec("c1")]));
		const after = ok(
			project([
				rec("c1"),
				rec("counter", { contradicts: [{ id: "c1", revision: 1 }] }),
			]),
		);
		expect(before.materialDigest).not.toBe(after.materialDigest);
		const first = planScopeEpoch(
			7,
			before.materialDigest,
			after.materialDigest,
		);
		expect(first).toEqual({ epoch: 8, changed: true });
		// the same change re-sent does not advance again
		expect(
			planScopeEpoch(8, after.materialDigest, after.materialDigest),
		).toEqual({
			epoch: 8,
			changed: false,
		});
	});
	test("the digest ignores asOf and input order but not revisions or lifecycles", () => {
		const x = ok(project([rec("c1"), rec("c2")]));
		const y = ok(project([rec("c2"), rec("c1")], { asOf: NOW + 5 }));
		expect(x.materialDigest).toBe(y.materialDigest);
		const z = ok(project([rec("c1"), rec("c2", { lifecycle: "disputed" })]));
		expect(z.materialDigest).not.toBe(x.materialDigest);
		expect(() => planScopeEpoch(-1, undefined, "d")).toThrow();
	});
});

describe("review fixes: projection hardening", () => {
	test("duplicate source identities are rejected, in either order", () => {
		const a = state({ revision: "rev-2" });
		const b = state();
		for (const sources of [
			[a, b],
			[b, a],
		])
			expect(project([rec("c1")], { sources })).toMatchObject({
				ok: false,
				code: "INVALID_INPUT",
			});
	});
	test("400+ sources: the material digest is not capped at 64KiB", () => {
		const sources = [
			state(),
			...Array.from({ length: 450 }, (_, i) =>
				state({ id: `src-${"y".repeat(120)}-${i}` }),
			),
		];
		const p = ok(project([rec("c1")], { sources }));
		expect(p.materialDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		// order-independent
		const reversed = ok(
			project([rec("c1")], { sources: [...sources].reverse() }),
		);
		expect(reversed.materialDigest).toBe(p.materialDigest);
	});
	test("a terminal disputer no longer refutes; a live one blocks causal use", () => {
		const target = rec("t1");
		const retractedDisputer = rec("d1", {
			lifecycle: "retracted",
			contradicts: [{ id: "t1", revision: 1 }],
		});
		const withRetracted = ok(project([target, retractedDisputer]));
		const t = withRetracted.entries.find((e) => e.id === "t1")!;
		expect(t.refutations).toEqual([]);
		expect(t.causalEligible).toBe(true);
		const liveDisputer = rec("d2", {
			lifecycle: "candidate",
			origin: "model_hypothesis",
			evidence: [],
			contradicts: [{ id: "t1", revision: 1 }],
		});
		const withLive = ok(project([target, liveDisputer]));
		const live = withLive.entries.find((e) => e.id === "t1")!;
		expect(live.status).toBe("active");
		expect(live.refutations).toEqual([{ id: "d2", revision: 1 }]);
		expect(live.causalEligible).toBe(false);
	});
});

describe("round 2: material digest at the legal maximum snapshot size", () => {
	test("500 assertions with long refs and 2000 sources still project (no 64KiB/4MiB cap)", () => {
		const long = (prefix: string, i: number) =>
			`${prefix}-${String(i).padStart(4, "0")}-${"x".repeat(230)}`;
		const assertions = Array.from({ length: 500 }, (_, i) =>
			rec(`a${i}`, {
				contradicts: Array.from({ length: 30 }, (_, j) => ({
					id: long(`c${j}`, i),
					revision: 1,
				})),
			}),
		);
		const sources = Array.from({ length: 2000 }, (_, i) =>
			state({ id: long("s", i) }),
		);
		const r = project(assertions, { sources: [state(), ...sources.slice(1)] });
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		// Permutation-stable at this size too.
		const reversed = project([...assertions].reverse(), {
			sources: [state(), ...sources.slice(1)].reverse(),
		});
		expect(reversed.ok && reversed.value.materialDigest).toBe(
			r.value.materialDigest,
		);
	});
	test("completeness.complete is false for a partial FOCUS_NOT_FOUND slice", () => {
		const slice = buildWorldSlice(
			sliceInput([rec("a1")], { focusSubjectIds: ["nonexistent"] }),
			sha256,
		);
		expect(slice.ok && slice.value.status).toBe("partial");
		expect(slice.ok && slice.value.completeness.complete).toBe(false);
		const ready = buildWorldSlice(sliceInput([rec("a1")]), sha256);
		expect(ready.ok && ready.value.status).toBe("ready");
		expect(ready.ok && ready.value.completeness.complete).toBe(true);
	});
});
