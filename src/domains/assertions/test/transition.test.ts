import { describe, expect, test } from "bun:test";
import {
	lifecycles,
	planAssertionTransition,
	terminalLifecycles,
	transitionActions,
	transitionTable,
	type Lifecycle,
	type TransitionAction,
} from "../index.ts";
import { A, B, freeze, ref } from "./helpers.ts";

const requests: Record<TransitionAction, Record<string, unknown>> = {
	adopt: {
		action: "adopt",
		adoption: { kind: "explicit", operationId: "op-adopt" },
		subjectConfirmedByHost: true,
	},
	dispute: {
		action: "dispute",
		contradicts: [{ id: "claim-9", revision: 1 }],
	},
	resolve: {
		action: "resolve",
		resolution: { id: "res-1", revision: 1 },
		reasonCode: "EXPLICIT_RESOLUTION",
	},
	supersede: { action: "supersede", replacementRevision: 4 },
	retract: { action: "retract", reasonSource: ref() },
	invalidate: { action: "invalidate", reasonCode: "SOURCE_RETRACTED" },
};
const make = (
	lifecycle: Lifecycle,
	request: Record<string, unknown>,
	extra: Record<string, unknown> = {},
	currentExtra: Record<string, unknown> = {},
) =>
	freeze({
		contractVersion: 1,
		scope: A,
		current: {
			id: "claim-1",
			revision: 3,
			scope: A,
			lifecycle,
			origin: "user_report",
			...currentExtra,
		},
		expectedRevision: 3,
		request,
		registeredAdoptionRules: ["rule-1"],
		...extra,
	});
const run = (i: unknown) => {
	const r = planAssertionTransition(i);
	if (!r.ok) throw new Error(`${r.code}:${r.path}`);
	return r.value;
};

describe("A10 transition table (all 36 pairs)", () => {
	for (const from of lifecycles) {
		for (const action of transitionActions) {
			const allowed = transitionTable[action].from.includes(from);
			test(`${from} --${action}--> ${allowed ? "allowed" : "forbidden"}`, () => {
				const result = run(make(from, requests[action]!));
				if (allowed) {
					expect(result.status).toBe("planned");
					if (result.status === "planned") {
						expect(result.plan.from).toBe(from);
						expect(result.plan.to).toBe(transitionTable[action].to);
						expect(result.plan.nextRevision).toBe(4);
						expect(result.plan.expectedRevision).toBe(3);
					}
				} else {
					expect(result).toEqual({
						status: "rejected",
						reasonCode: terminalLifecycles.includes(from)
							? "TERMINAL_STATE"
							: "TRANSITION_NOT_ALLOWED",
					});
				}
			});
		}
	}
	test("table is exactly the C4 edge list (written out literally)", () => {
		const edges = transitionActions.flatMap((action) =>
			transitionTable[action].from.map(
				(from) => `${from}>${action}>${transitionTable[action].to}`,
			),
		);
		expect([...edges].sort()).toEqual(
			[
				"candidate>adopt>active",
				"active>dispute>disputed",
				"disputed>resolve>active",
				"candidate>supersede>superseded",
				"active>supersede>superseded",
				"disputed>supersede>superseded",
				"candidate>retract>retracted",
				"active>retract>retracted",
				"disputed>retract>retracted",
				"candidate>invalidate>invalidated",
				"active>invalidate>invalidated",
				"disputed>invalidate>invalidated",
			].sort(),
		);
	});
});

describe("A10 requirements per edge", () => {
	test("terminal states never return to active at the same revision", () => {
		for (const from of terminalLifecycles)
			for (const action of ["adopt", "resolve"] as const)
				expect(run(make(from, requests[action]!)).status).toBe("rejected");
	});
	test("supersede stops the old revision and links the new one together", () => {
		const r = run(make("active", requests["supersede"]!));
		expect(r.status === "planned" && r.plan).toMatchObject({
			to: "superseded",
			nextRevision: 4,
			nextLifecycle: "candidate",
			stopsUseOf: [{ id: "claim-1", revision: 3 }],
			supersedes: [{ id: "claim-1", revision: 3 }],
		});
	});
	test("replacement revision must be current + 1", () => {
		const r = run(
			make("active", { action: "supersede", replacementRevision: 5 }),
		);
		expect(r).toEqual({
			status: "rejected",
			reasonCode: "REPLACEMENT_REVISION_MISMATCH",
		});
	});
	test("stale rev1 correction after rev2 exists is rejected", () => {
		const stale = make(
			"active",
			{ action: "supersede", replacementRevision: 2 },
			{ expectedRevision: 1 },
			{ revision: 2 },
		);
		expect(run(stale)).toEqual({
			status: "rejected",
			reasonCode: "REVISION_CONFLICT",
		});
		// Even a stale request against a superseded revision is a conflict, not a revival.
		expect(
			run(make("superseded", requests["adopt"]!, { expectedRevision: 2 })),
		).toEqual({ status: "rejected", reasonCode: "REVISION_CONFLICT" });
	});
	test("adopt needs a registered rule or explicit op, plus host confirmation", () => {
		const rule = (ruleId: string, confirmed = true) => ({
			action: "adopt",
			adoption: { kind: "rule", ruleId },
			subjectConfirmedByHost: confirmed,
		});
		expect(run(make("candidate", rule("rule-1"))).status).toBe("planned");
		expect(run(make("candidate", rule("model-confidence-0.99")))).toEqual({
			status: "rejected",
			reasonCode: "ADOPTION_RULE_NOT_REGISTERED",
		});
		expect(run(make("candidate", rule("rule-1", false)))).toEqual({
			status: "rejected",
			reasonCode: "HOST_CONFIRMATION_REQUIRED",
		});
		// A model hypothesis is adopted the same way: no shortcut via confidence.
		expect(
			planAssertionTransition(
				make("candidate", { ...rule("rule-1"), confidence: 0.99 }),
			).ok,
		).toBe(false);
		expect(
			planAssertionTransition(
				make("candidate", { action: "adopt", subjectConfirmedByHost: true }),
			).ok,
		).toBe(false);
	});
	test("dispute needs contradicting refs and cannot cite itself", () => {
		expect(
			planAssertionTransition(
				make("active", { action: "dispute", contradicts: [] }),
			).ok,
		).toBe(false);
		expect(
			run(
				make("active", {
					action: "dispute",
					contradicts: [{ id: "claim-1", revision: 3 }],
				}),
			),
		).toEqual({ status: "rejected", reasonCode: "SELF_CONTRADICTION" });
		const ok = run(make("active", requests["dispute"]!));
		expect(ok.status === "planned" && ok.plan.contradicts).toEqual([
			{ id: "claim-9", revision: 1 },
		]);
	});
	test("retract needs a reason source; resolve needs a versioned resolution", () => {
		expect(
			planAssertionTransition(make("active", { action: "retract" })).ok,
		).toBe(false);
		expect(
			planAssertionTransition(
				make("disputed", { action: "resolve", reasonCode: "x" }),
			).ok,
		).toBe(false);
		const r = run(make("disputed", requests["resolve"]!));
		expect(r.status === "planned" && r.plan.resolution).toEqual({
			id: "res-1",
			revision: 1,
		});
	});
	test("invalidate only accepts enumerated reasons", () => {
		expect(
			planAssertionTransition(
				make("active", { action: "invalidate", reasonCode: "because" }),
			).ok,
		).toBe(false);
	});
	test("other Scope is refused without detail; unknown action/version are structural", () => {
		expect(run(make("active", requests["retract"]!, { scope: B }))).toEqual({
			status: "rejected",
			reasonCode: "SCOPE_NOT_PERMITTED",
		});
		expect(
			planAssertionTransition(make("active", { action: "reactivate" })).ok,
		).toBe(false);
		const v = planAssertionTransition({
			...make("active", requests["retract"]!),
			contractVersion: 2,
		});
		expect(!v.ok && v.code).toBe("UNSUPPORTED_CONTRACT_VERSION");
	});
	test("inputs are not mutated and plans are deterministic", () => {
		const i = make("active", requests["supersede"]!);
		expect(run(i)).toEqual(run(i));
	});
});

describe("review fixes: revision overflow and self-contradiction", () => {
	test("revision at MAX_SAFE_INTEGER cannot be advanced", () => {
		const top = Number.MAX_SAFE_INTEGER;
		const r = planAssertionTransition(
			freeze({
				contractVersion: 1,
				scope: A,
				current: {
					id: "claim-1",
					revision: top,
					scope: A,
					lifecycle: "active",
					origin: "user_report",
				},
				expectedRevision: top,
				request: requests.invalidate,
				registeredAdoptionRules: [],
			}),
		);
		expect(!r.ok && r.code).toBe("LIMIT_EXCEEDED");
	});
	test("an older revision of the same assertion is not an independent contradiction", () => {
		const r = run(
			make("active", {
				action: "dispute",
				contradicts: [{ id: "claim-1", revision: 1 }],
			}),
		);
		expect(r).toEqual({ status: "rejected", reasonCode: "SELF_CONTRADICTION" });
	});
});

describe("round-2 fixes: dispute contradicts is a canonical set", () => {
	test("duplicates collapse and order is canonical (same set => same plan)", () => {
		const x = { id: "claim-9", revision: 1 };
		const y = { id: "claim-8", revision: 2 };
		const a = run(make("active", { action: "dispute", contradicts: [x, y] }));
		const b = run(
			make("active", { action: "dispute", contradicts: [y, x, x] }),
		);
		expect(a).toEqual(b);
		expect(a.status === "planned" && a.plan.contradicts).toEqual([y, x]);
	});
});
