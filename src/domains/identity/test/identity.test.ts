import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planMerge, planSplit, resolveEntity } from "../index.ts";

const sharedName = JSON.parse(
	readFileSync(
		join(import.meta.dir, "../../../../fixtures/identity/shared-name.json"),
		"utf8",
	),
) as { entities: Record<string, unknown>[] };
const A = { principal: "p-a", scopeKey: "scope-a" };
const B = { principal: "p-a", scopeKey: "scope-b" };
const ent = (
	id: string,
	name: string,
	extra: Record<string, unknown> = {},
) => ({
	id,
	scope: A,
	revision: 1,
	displayName: name,
	aliases: [],
	externalRefs: [],
	...extra,
});
function freeze<T>(value: T): T {
	if (typeof value === "object" && value !== null) {
		for (const v of Object.values(value)) freeze(v);
		Object.freeze(value);
	}
	return value;
}
const q = (query: unknown, entities: unknown, scope = A) =>
	resolveEntity(freeze({ scope, query }), freeze(entities));

describe("A07 resolve", () => {
	test("same name in another Scope does not leak", () => {
		const r = q({ kind: "alias", text: "音声サービス" }, sharedName.entities);
		expect(r).toEqual({
			ok: true,
			value: { status: "resolved", entityId: "e-a1", via: "alias" },
		});
		const none = q(
			{ kind: "alias", text: "音声サービス" },
			[sharedName.entities[1]],
			A,
		);
		expect(none).toEqual({ ok: true, value: { status: "missing" } });
		const id = q({ kind: "id", id: "e-b1" }, sharedName.entities, A);
		expect(id).toEqual({ ok: true, value: { status: "missing" } });
	});
	test("two candidates in one Scope are ambiguous, sorted by id", () => {
		const r = q({ kind: "alias", text: "Voice" }, [
			ent("z", "Voice"),
			ent("m", "x", { aliases: ["Voice"] }),
		]);
		expect(r).toEqual({
			ok: true,
			value: { status: "ambiguous", candidateIds: ["m", "z"] },
		});
	});
	test("alias is trim+NFC only; no case folding", () => {
		const nfd = "が".normalize("NFD");
		expect(nfd).not.toBe("が");
		// decomposed + padded query still resolves (trim + NFC), original spelling kept
		expect(q({ kind: "alias", text: ` ${nfd} ` }, [ent("e1", "が")])).toEqual({
			ok: true,
			value: { status: "resolved", entityId: "e1", via: "alias" },
		});
		// the stored name may be the decomposed form as well
		expect(q({ kind: "alias", text: "が" }, [ent("e1", nfd)])).toEqual({
			ok: true,
			value: { status: "resolved", entityId: "e1", via: "alias" },
		});
		// a literal "${nfd}" text is not the decomposed string
		expect(q({ kind: "alias", text: " ${nfd} " }, [ent("e1", "が")])).toEqual({
			ok: true,
			value: { status: "missing" },
		});
		expect(q({ kind: "alias", text: "voice" }, [ent("e1", "Voice")])).toEqual({
			ok: true,
			value: { status: "missing" },
		});
	});
	test("duplicate entity ids in a Scope are rejected, in any order", () => {
		const x = ent("x", "X");
		const xMerged = ent("x", "X", { mergedInto: "y" });
		const y = ent("y", "Y");
		for (const list of [
			[x, xMerged, y],
			[xMerged, x, y],
		])
			expect(q({ kind: "id", id: "x" }, list).ok).toBe(false);
		// the same id in different Scopes is not a duplicate
		expect(q({ kind: "id", id: "x" }, [x, { ...x, scope: B }]).ok).toBe(true);
	});
	test("explicit id and external ref match exactly", () => {
		const es = [
			ent("e1", "a", { externalRefs: [{ system: "crm", id: "1" }] }),
			ent("e2", "b", { externalRefs: [{ system: "crm", id: "2" }] }),
		];
		expect(q({ kind: "id", id: "e2" }, es)).toEqual({
			ok: true,
			value: { status: "resolved", entityId: "e2", via: "id" },
		});
		expect(q({ kind: "external", system: "crm", externalId: "2" }, es)).toEqual(
			{
				ok: true,
				value: { status: "resolved", entityId: "e2", via: "external" },
			},
		);
		expect(
			q({ kind: "external", system: "other", externalId: "2" }, es),
		).toEqual({
			ok: true,
			value: { status: "missing" },
		});
	});
	test("merged id resolves to its representative; cyclic data terminates", () => {
		const es = [ent("r", "R"), ent("m", "M", { mergedInto: "r" })];
		expect(q({ kind: "id", id: "m" }, es)).toEqual({
			ok: true,
			value: { status: "resolved", entityId: "r", via: "id" },
		});
		const loop = [
			ent("a", "A", { mergedInto: "b" }),
			ent("b", "B", { mergedInto: "a" }),
		];
		expect(q({ kind: "id", id: "a" }, loop)).toEqual({
			ok: true,
			value: { status: "missing" },
		});
	});
	test("invalid input is rejected from unknown", () => {
		expect(q({ kind: "nope" }, []).ok).toBe(false);
		expect(q({ kind: "id", id: "" }, []).ok).toBe(false);
		expect(resolveEntity(null, []).ok).toBe(false);
		expect(q({ kind: "id", id: "x", extra: 1 }, []).ok).toBe(false);
		expect(
			q({ kind: "id", id: "x" }, [{ ...ent("a", "A"), extra: 1 }]).ok,
		).toBe(false);
	});
});

const mergeInput = (over: Record<string, unknown> = {}) => ({
	scope: A,
	operationId: "op-m1",
	representativeId: "r",
	targetIds: ["r", "m1", "m2"],
	expectedRevisions: { r: 1, m1: 1, m2: 1 },
	evidence: ["ev-2", "ev-1"],
	entities: [
		ent("r", "Rep", { aliases: ["R"] }),
		ent("m1", "One", {
			aliases: ["1"],
			externalRefs: [{ system: "crm", id: "9" }],
		}),
		ent("m2", "Two"),
		{ ...ent("other", "Rep"), scope: B },
	],
	...over,
});
function planned<T extends { status: string }>(r: { ok: boolean; value?: T }) {
	if (!r.ok || r.value?.status !== "planned") throw new Error("not planned");
	return r.value as Extract<T, { status: "planned" }>;
}

describe("A07 merge and split", () => {
	test("merge plan keeps the original mapping and does not mutate input", () => {
		const input = freeze(mergeInput());
		const { plan } = planned(planMerge(input));
		expect(plan.evidence).toEqual(["ev-1", "ev-2"]);
		expect(plan.representativeBefore.aliases).toEqual(["R"]);
		expect(plan.representativeAfter.aliases).toEqual(["R", "One", "1", "Two"]);
		expect(plan.representativeAfter.revision).toBe(2);
		expect(plan.members.map((m) => m.id)).toEqual(["m1", "m2"]);
		expect(plan.members[0]!.aliases).toEqual(["1"]);
		expect(plan.members[0]!.nextRevision).toBe(2);
	});
	test("stale revision, missing/other-scope target, merged target, bad shape", () => {
		expect(
			planMerge(mergeInput({ expectedRevisions: { r: 1, m1: 0 + 2, m2: 1 } })),
		).toEqual({
			ok: true,
			value: { status: "rejected", reasonCode: "REVISION_CONFLICT" },
		});
		expect(
			planMerge(
				mergeInput({
					targetIds: ["r", "m1", "other"],
					expectedRevisions: { r: 1, m1: 1, other: 1 },
				}),
			),
		).toEqual({
			ok: true,
			value: { status: "rejected", reasonCode: "ENTITY_NOT_FOUND" },
		});
		const cyc = mergeInput({
			entities: [
				ent("r", "R", { mergedInto: "m1" }),
				ent("m1", "M"),
				ent("m2", "T"),
			],
		});
		expect(planMerge(cyc)).toEqual({
			ok: true,
			value: { status: "rejected", reasonCode: "MERGE_CYCLE" },
		});
		expect(planMerge(mergeInput({ representativeId: "zz" })).ok).toBe(false);
		expect(
			planMerge(mergeInput({ targetIds: ["r"], expectedRevisions: { r: 1 } }))
				.ok,
		).toBe(false);
		expect(planMerge(mergeInput({ evidence: [] })).ok).toBe(false);
		expect(planMerge(mergeInput({ targetIds: ["r", "r", "m1"] })).ok).toBe(
			false,
		);
	});
	function afterMerge() {
		const { plan } = planned(planMerge(mergeInput()));
		const entities = [
			ent("r", "Rep", {
				revision: 2,
				aliases: plan.representativeAfter.aliases,
			}),
			ent("m1", "One", { revision: 2, mergedInto: "r" }),
			ent("m2", "Two", { revision: 2, mergedInto: "r" }),
		];
		return { plan, entities };
	}
	const splitInput = (over: Record<string, unknown> = {}) => {
		const { plan, entities } = afterMerge();
		return {
			scope: A,
			operationId: "op-s1",
			mergeOperationId: "op-m1",
			expectedRevision: 2,
			history: [plan],
			splitMergeOperationIds: [],
			entities,
			...over,
		};
	};
	test("merge then split restores the original alias mapping", () => {
		const { plan } = planned(planSplit(freeze(splitInput())));
		expect(plan.representative.aliases).toEqual(["R"]);
		expect(plan.representative.nextRevision).toBe(3);
		expect(plan.restored.map((r) => [r.id, r.aliases, r.nextRevision])).toEqual(
			[
				["m1", ["1"], 3],
				["m2", [], 3],
			],
		);
		expect(plan.restored[0]!.externalRefs).toEqual([
			{ system: "crm", id: "9" },
		]);
	});
	test("split rejects stale revision, unknown merge, repeat, drifted state", () => {
		const code = (r: unknown) =>
			(r as { value: { reasonCode: string } }).value.reasonCode;
		expect(code(planSplit(splitInput({ expectedRevision: 1 })))).toBe(
			"REVISION_CONFLICT",
		);
		expect(code(planSplit(splitInput({ mergeOperationId: "nope" })))).toBe(
			"MERGE_HISTORY_NOT_FOUND",
		);
		expect(
			code(planSplit(splitInput({ splitMergeOperationIds: ["op-m1"] }))),
		).toBe("ALREADY_SPLIT");
		const drift = splitInput();
		drift.entities[0] = ent("r", "Rep", { revision: 3 });
		expect(code(planSplit({ ...drift, expectedRevision: 3 }))).toBe(
			"REVISION_CONFLICT",
		);
		expect(
			planSplit({ ...splitInput(), history: [{ kind: "merge" }] }).ok,
		).toBe(false);
	});
	test("history from another Scope is not usable", () => {
		const r = planSplit(splitInput({ scope: B }));
		expect(r).toEqual({
			ok: true,
			value: { status: "rejected", reasonCode: "MERGE_HISTORY_NOT_FOUND" },
		});
	});
});

describe("review fixes: duplicates, overflow, opaque ids, drift", () => {
	const mergeReq = (over: Record<string, unknown> = {}) => ({
		scope: A,
		operationId: "op-m1",
		representativeId: "r",
		targetIds: ["r", "m1"],
		expectedRevisions: { r: 1, m1: 1 },
		evidence: ["ev-1"],
		entities: [ent("r", "Rep"), ent("m1", "One")],
		...over,
	});
	test("planMerge accepts ids named __proto__ / constructor as opaque ids", () => {
		const expectedRevisions = JSON.parse(
			'{"__proto__": 1, "constructor": 1}',
		) as Record<string, number>;
		const r = planMerge(
			mergeReq({
				representativeId: "__proto__",
				targetIds: ["__proto__", "constructor"],
				expectedRevisions,
				entities: [ent("__proto__", "P"), ent("constructor", "C")],
			}),
		);
		expect(r.ok && r.value.status).toBe("planned");
		// an absent key is a conflict, never an inherited value
		const missing = planMerge(
			mergeReq({
				expectedRevisions: JSON.parse('{"r": 1, "toString": 1}'),
			}),
		);
		expect(missing.ok && missing.value).toEqual({
			status: "rejected",
			reasonCode: "REVISION_CONFLICT",
		});
	});
	test("revision at MAX_SAFE_INTEGER cannot be advanced (merge and split)", () => {
		const top = Number.MAX_SAFE_INTEGER;
		const r = planMerge(
			mergeReq({
				expectedRevisions: { r: top, m1: 1 },
				entities: [ent("r", "Rep", { revision: top }), ent("m1", "One")],
			}),
		);
		expect(r.ok).toBe(false);
		expect(!r.ok && r.code).toBe("LIMIT_EXCEEDED");
		const { plan } = planned(planMerge(mergeReq()));
		const s = planSplit({
			scope: A,
			operationId: "op-s1",
			mergeOperationId: "op-m1",
			expectedRevision: top,
			history: [
				{
					...plan,
					representativeBefore: {
						...plan.representativeBefore,
						revision: top - 1,
					},
					representativeAfter: { ...plan.representativeAfter, revision: top },
				},
			],
			splitMergeOperationIds: [],
			entities: [
				ent("r", "Rep", { revision: top }),
				ent("m1", "One", { revision: 2, mergedInto: "r" }),
			],
		});
		expect(!s.ok && s.code).toBe("LIMIT_EXCEEDED");
	});
	test("duplicate history operationId is rejected; member drift is refused", () => {
		const { plan } = planned(planMerge(mergeReq()));
		const base = {
			scope: A,
			operationId: "op-s1",
			mergeOperationId: "op-m1",
			expectedRevision: 2,
			splitMergeOperationIds: [],
			entities: [
				ent("r", "Rep", { revision: 2 }),
				ent("m1", "One", { revision: 2, mergedInto: "r" }),
			],
		};
		expect(planSplit({ ...base, history: [plan, plan] }).ok).toBe(false);
		const memberRevision = planSplit({
			...base,
			history: [plan],
			entities: [
				ent("r", "Rep", { revision: 2 }),
				ent("m1", "One", { revision: 3, mergedInto: "r" }),
			],
		});
		expect(memberRevision.ok && memberRevision.value).toEqual({
			status: "rejected",
			reasonCode: "REVISION_CONFLICT",
		});
		const memberMoved = planSplit({
			...base,
			history: [plan],
			entities: [
				ent("r", "Rep", { revision: 2 }),
				ent("m1", "One", { revision: 2, mergedInto: "other" }),
			],
		});
		expect(memberMoved.ok && memberMoved.value).toEqual({
			status: "rejected",
			reasonCode: "MERGE_CYCLE",
		});
	});
});

describe("round-2 fixes", () => {
	const aliasesOf = (prefix: string, n: number) =>
		Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
	const req = (over: Record<string, unknown> = {}) => ({
		scope: A,
		operationId: "op-big",
		representativeId: "r",
		targetIds: ["r", "m"],
		expectedRevisions: { r: 1, m: 1 },
		evidence: ["ev-1"],
		...over,
	});
	test("a merge whose union exceeds the parser limits is rejected at plan time", () => {
		const big = req({
			entities: [
				ent("r", "Rep", { aliases: aliasesOf("a", 600) }),
				ent("m", "Mem", { aliases: aliasesOf("b", 600) }),
			],
		});
		const r = planMerge(big);
		expect(!r.ok && r.code).toBe("LIMIT_EXCEEDED");
		// right at the limit still plans and the result stays resolvable
		const fits = planMerge(
			req({
				entities: [
					ent("r", "Rep", { aliases: aliasesOf("a", 500) }),
					ent("m", "Mem", { aliases: aliasesOf("b", 498) }),
				],
			}),
		);
		const { plan } = planned(fits);
		expect(plan.representativeAfter.aliases.length).toBeLessThanOrEqual(1000);
		const rep = {
			...ent("r", plan.representativeAfter.displayName, {
				revision: plan.representativeAfter.revision,
			}),
			aliases: plan.representativeAfter.aliases,
		};
		expect(q({ kind: "id", id: "r" }, [rep]).ok).toBe(true);
		// few items but over the single-payload byte limit (64KiB)
		const heavy = (prefix: string) =>
			Array.from({ length: 10 }, (_, i) => `${prefix}${i}`.padEnd(4000, "x"));
		const bytes = planMerge(
			req({
				entities: [
					ent("r", "Rep", { aliases: heavy("a") }),
					ent("m", "Mem", { aliases: heavy("b") }),
				],
			}),
		);
		expect(!bytes.ok && bytes.code).toBe("LIMIT_EXCEEDED");
		const bigRefs = planMerge(
			req({
				entities: [
					ent("r", "Rep", {
						externalRefs: Array.from({ length: 600 }, (_, i) => ({
							system: "s",
							id: `r${i}`,
						})),
					}),
					ent("m", "Mem", {
						externalRefs: Array.from({ length: 600 }, (_, i) => ({
							system: "s",
							id: `m${i}`,
						})),
					}),
				],
			}),
		);
		expect(!bigRefs.ok && bigRefs.code).toBe("LIMIT_EXCEEDED");
	});
	test("a hand-built or corrupt merge history entry is refused by the parser", () => {
		const { plan } = planned(
			planMerge(req({ entities: [ent("r", "Rep"), ent("m", "Mem")] })),
		);
		const split = (history: unknown) =>
			planSplit({
				scope: A,
				operationId: "op-s",
				mergeOperationId: "op-big",
				expectedRevision: 2,
				history: [history],
				splitMergeOperationIds: [],
				entities: [
					ent("r", "Rep", { revision: 2 }),
					ent("m", "Mem", { revision: 2, mergedInto: "r" }),
				],
			});
		expect(split(plan).ok).toBe(true);
		const [member] = plan.members;
		for (const bad of [
			{
				...plan,
				representativeBefore: { ...plan.representativeBefore, id: "x" },
			},
			{
				...plan,
				representativeAfter: { ...plan.representativeAfter, id: "x" },
			},
			{
				...plan,
				representativeAfter: { ...plan.representativeAfter, revision: 9 },
			},
			{ ...plan, members: [{ ...member!, nextRevision: 9 }] },
			{ ...plan, members: [member, member] },
			{
				...plan,
				members: [{ ...member!, id: "r" }],
			},
			{ ...plan, members: [] },
		]) {
			const r = split(bad);
			expect(!r.ok && r.code).toBe("INVALID_INPUT");
		}
	});
});

describe("round-3 fixes", () => {
	const heavy = (n: number) =>
		Array.from({ length: n }, (_, i) => `${i}`.padEnd(4000, "x"));
	const req = (over: Record<string, unknown> = {}) => ({
		scope: A,
		operationId: "op-3",
		representativeId: "r",
		targetIds: ["r", "m1", "m2"],
		expectedRevisions: { r: 1, m1: 1, m2: 1 },
		evidence: ["ev-1"],
		entities: [ent("r", "Rep"), ent("m1", "One"), ent("m2", "Two")],
		...over,
	});
	test("a plan too large to persist as one event is not reported as planned", () => {
		// the union stays small (the same aliases everywhere) but the event
		// carries every member's snapshot as well
		const same = heavy(6);
		const ids = ["r", "m1", "m2", "m3", "m4"];
		const r = planMerge(
			req({
				targetIds: ids,
				expectedRevisions: Object.fromEntries(ids.map((i) => [i, 1])),
				entities: ids.map((i) => ent(i, i, { aliases: same })),
			}),
		);
		expect(!r.ok && r.code).toBe("LIMIT_EXCEEDED");
		// a modest plan is still planned
		expect(planMerge(req()).ok).toBe(true);
	});
	test("a split plan too large to persist is refused", () => {
		const { plan } = planned(planMerge(req()));
		const big = {
			...plan,
			representativeBefore: {
				...plan.representativeBefore,
				aliases: heavy(7),
			},
			members: plan.members.map((m) => ({ ...m, aliases: heavy(7) })),
		};
		const r = planSplit({
			scope: A,
			operationId: "op-s",
			mergeOperationId: "op-3",
			expectedRevision: 2,
			history: [big],
			splitMergeOperationIds: [],
			entities: [
				ent("r", "Rep", { revision: 2 }),
				ent("m1", "One", { revision: 2, mergedInto: "r" }),
				ent("m2", "Two", { revision: 2, mergedInto: "r" }),
			],
		});
		expect(!r.ok && r.code).toBe("LIMIT_EXCEEDED");
	});
	test("contractVersion: 1 accepted, other numbers unsupported, other types invalid", () => {
		const split = {
			scope: A,
			operationId: "op-s",
			mergeOperationId: "nope",
			expectedRevision: 1,
			history: [],
			splitMergeOperationIds: [],
			entities: [],
		};
		const calls: [string, (v: unknown) => { ok: boolean; code?: string }][] = [
			[
				"resolve",
				(v) =>
					resolveEntity(
						{
							scope: A,
							query: { kind: "id", id: "x" },
							contractVersion: v,
						},
						[],
					),
			],
			["merge", (v) => planMerge({ ...req(), contractVersion: v })],
			["split", (v) => planSplit({ ...split, contractVersion: v })],
		];
		for (const [, call] of calls) {
			expect(call(1).ok).toBe(true);
			const unsupported = call(2);
			expect(!unsupported.ok && unsupported.code).toBe(
				"UNSUPPORTED_CONTRACT_VERSION",
			);
			const wrongType = call("1");
			expect(!wrongType.ok && wrongType.code).toBe("INVALID_INPUT");
		}
	});
	test("an entity of another Scope with the same id never overrides the real one", () => {
		const { plan } = planned(planMerge(req()));
		const entities = [
			ent("r", "Rep", { revision: 2 }),
			ent("m1", "One", { revision: 2, mergedInto: "r" }),
			ent("m2", "Two", { revision: 2, mergedInto: "r" }),
			// foreign twins listed LAST so a missing scope filter would let them win
			ent("r", "Foreign", { scope: B, revision: 99 }),
			ent("m1", "Foreign", { scope: B, revision: 99, mergedInto: "zz" }),
		];
		const r = planSplit({
			scope: A,
			operationId: "op-s",
			mergeOperationId: "op-3",
			expectedRevision: 2,
			history: [plan],
			splitMergeOperationIds: [],
			entities,
		});
		expect(planned(r).plan.restored.map((m) => m.id)).toEqual(["m1", "m2"]);
	});
	test("whitespace-only names and aliases are rejected as input", () => {
		for (const bad of [
			ent("e", "   "),
			ent("e", "ok", { aliases: ["  \t "] }),
			ent("e", "ok", { aliases: [""] }),
		]) {
			const r = q({ kind: "id", id: "e" }, [bad]);
			expect(!r.ok && r.code).toBe("INVALID_INPUT");
			expect(planMerge(req({ entities: [bad] })).ok).toBe(false);
		}
		expect(q({ kind: "id", id: "e" }, [ent("e", "ok")]).ok).toBe(true);
	});
});
