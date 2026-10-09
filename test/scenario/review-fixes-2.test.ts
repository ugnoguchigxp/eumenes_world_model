/**
 * Regression tests for review round 2 of the persistence layer (findings are
 * numbered as in that review). Each test fails without its fix.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { rebuildProjection } from "../../src/application/sqlite/projection.ts";
import {
	planAssertionTransition,
	type TransitionRequest,
} from "../../src/domains/assertions/index.ts";
import { getAssertion } from "../../src/domains/assertions/sqlite.ts";
import { planMerge } from "../../src/domains/identity/index.ts";
import { getEntity } from "../../src/domains/identity/sqlite.ts";
import {
	beginForget,
	getGate,
	getTombstone,
	insertTombstone,
	saveForgetTargets,
} from "../../src/domains/lifecycle/sqlite.ts";
import { failingDb } from "../support/failing-db.ts";
import type { TestStore } from "../support/sqlite-store.ts";
import {
	MARKER,
	count,
	forgetChunk,
	leaks,
	markedClaim,
	quantPrediction,
	sourceRoot,
	srcKey,
	states,
} from "./forget-fixture.ts";
import {
	A,
	NOW,
	access,
	adoptPlan,
	apply,
	claim,
	dump,
	envelope,
	hasher,
	hostChecks,
	openWorld,
	ref,
	state,
} from "./world-fixture.ts";

const stores: TestStore[] = [];
afterEach(() => {
	for (const store of stores.splice(0)) store.close();
});
function world(mode: "file" | "memory" = "file"): TestStore {
	const store = openWorld(mode);
	stores.push(store);
	return store;
}
const run = (store: TestStore, input: unknown) =>
	store.write((db) => apply(db, input));
const register = (key: string, assertion: unknown, host = states()) =>
	envelope(
		key,
		{ kind: "assertion.register", assertion },
		{ hostChecks: host },
	);
const transition = (
	key: string,
	plan: unknown,
	host = states(),
	replacement?: unknown,
) =>
	envelope(
		key,
		{
			kind: "assertion.transition",
			plan,
			...(replacement === undefined ? {} : { replacement }),
		},
		{ hostChecks: host },
	);
function plan(store: TestStore, id: string, request: TransitionRequest) {
	return store.read((db) => {
		const head = getAssertion(db, A, id)!;
		const planned = planAssertionTransition({
			contractVersion: 1,
			scope: A,
			current: {
				id,
				revision: head.revision,
				scope: A,
				lifecycle: head.lifecycle,
				origin: head.origin,
			},
			expectedRevision: head.revision,
			request,
			registeredAdoptionRules: [],
		});
		if (!planned.ok || planned.value.status !== "planned")
			throw new Error(`plan ${id}: ${JSON.stringify(planned)}`);
		return planned.value.plan;
	});
}
const adoptReq = (op: string): TransitionRequest => ({
	action: "adopt",
	adoption: { kind: "explicit", operationId: `adopt-${op}` },
	subjectConfirmedByHost: true,
});
const reopen = (store: TestStore, key: string, forgetId: string) =>
	run(
		store,
		envelope(
			key,
			{ kind: "forget.reopen", forgetId, externalDeletionConfirmed: true },
			{ hostChecks: states() },
		),
	);
const context = {
	hasher,
	clock: NOW,
	hostChecks: hostChecks() as never,
};

function registerEntity(
	store: TestStore,
	id: string,
	displayName: string,
	alias: string,
) {
	expect(
		run(
			store,
			envelope(`reg-${id}`, {
				kind: "entity.register",
				entity: { id, displayName, aliases: [alias], externalRefs: [] },
			}),
		).status,
	).toBe("applied");
}
function mergeInto(store: TestStore, key: string, rep: string, member: string) {
	const merged = store.read((db) => {
		const planned = planMerge({
			scope: A,
			operationId: key,
			representativeId: rep,
			targetIds: [rep, member],
			expectedRevisions: {
				[rep]: getEntity(db, A, rep)!.revision,
				[member]: getEntity(db, A, member)!.revision,
			},
			evidence: ["ev"],
			entities: [getEntity(db, A, rep)!, getEntity(db, A, member)!],
		});
		if (!planned.ok || planned.value.status !== "planned")
			throw new Error(JSON.stringify(planned));
		return planned.value.plan;
	});
	expect(
		run(store, envelope(key, { kind: "entity.merge", plan: merged })).status,
	).toBe("applied");
}

describe("1 forgetting a merged member scrubs EVERY ancestor", () => {
	test("e-3 into e-2 into e-1; forgetting the leaf leaves no trace in either ancestor", () => {
		const store = world();
		registerEntity(store, "e-1", "alpha", "al-1");
		registerEntity(store, "e-2", "beta", "al-2");
		registerEntity(store, "e-3", `leaf-${MARKER}`, `alias-${MARKER}`);
		mergeInto(store, "m-1", "e-2", "e-3");
		mergeInto(store, "m-2", "e-1", "e-2");
		expect(leaks(store, MARKER).length).toBeGreaterThan(0);
		const result = run(
			store,
			forgetChunk("f-1", "fg-1", [{ kind: "entity", id: "e-3", revision: 1 }]),
		);
		expect(result).toMatchObject({
			status: "applied",
			forget: { state: "complete", pending: 0 },
		});
		expect(leaks(store, MARKER)).toEqual([]);
		// The survivors keep their own text.
		expect(leaks(store, "alpha")).not.toEqual([]);
		expect(leaks(store, "beta")).not.toEqual([]);
		expect(leaks(store, "al-2")).not.toEqual([]);
	});

	test("seeded random merge forests: forgotten text is gone everywhere, survivors keep theirs", () => {
		for (let seed0 = 1; seed0 <= 25; seed0++) {
			let seed = seed0 * 7919;
			const rnd = (n: number) => {
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
				return seed % n;
			};
			const store = world("memory");
			const n = 6;
			for (let i = 0; i < n; i++)
				registerEntity(store, `e${i}`, `Dn-MKx${i}x`, `Al-MKx${i}x`);
			const roots = new Set(Array.from({ length: n }, (_, i) => i));
			for (let m = 0; m < 4; m++) {
				const list = [...roots];
				if (list.length < 2) break;
				const rep = list[rnd(list.length)]!;
				const other = list.filter((x) => x !== rep)[rnd(list.length - 1)]!;
				mergeInto(store, `m${seed0}-${m}`, `e${rep}`, `e${other}`);
				roots.delete(other);
			}
			const target = rnd(n);
			const members = new Map<number, number[]>();
			store.read((db) => {
				for (let i = 0; i < n; i++) {
					const into = getEntity(db, A, `e${i}`)?.mergedInto;
					if (into !== undefined && into !== null) {
						const parent = Number(String(into).slice(1));
						members.set(parent, [...(members.get(parent) ?? []), i]);
					}
				}
			});
			const forgotten = new Set<number>();
			const stack = [target];
			while (stack.length > 0) {
				const next = stack.pop()!;
				if (forgotten.has(next)) continue;
				forgotten.add(next);
				stack.push(...(members.get(next) ?? []));
			}
			const result = run(
				store,
				forgetChunk(`f-${seed0}`, `fg-${seed0}`, [
					{ kind: "entity", id: `e${target}`, revision: 1 },
				]),
			);
			expect(result).toMatchObject({
				status: "applied",
				forget: { state: "complete" },
			});
			for (let i = 0; i < n; i++) {
				const found = leaks(store, `MKx${i}x`);
				if (forgotten.has(i)) expect(found).toEqual([]);
				else expect(found.length).toBeGreaterThan(0);
			}
			store.close();
			stores.splice(stores.indexOf(store), 1);
		}
	});
});

describe("2 entity forget reaches every revision of a subject", () => {
	test("a supersede that moved the subject leaves nothing behind", () => {
		const store = world();
		expect(
			run(
				store,
				register(
					"r1",
					markedClaim("c-1", 1, [1], true, { subjectId: "svc-1" }),
				),
			).status,
		).toBe("applied");
		const superseded = plan(store, "c-1", {
			action: "supersede",
			replacementRevision: 2,
		});
		const replacement = markedClaim("c-1", 1, [1], false, {
			revision: 2,
			subjectId: "svc-2",
			supersedes: [{ id: "c-1", revision: 1 }],
		});
		expect(
			run(store, transition("s1", superseded, states(), replacement)).status,
		).toBe("applied");
		expect(count(store, "world_assertion")).toBe(2);
		const result = run(
			store,
			forgetChunk("f-1", "fg-1", [
				{ kind: "entity", id: "svc-1", revision: 1 },
			]),
		);
		expect(result).toMatchObject({
			status: "applied",
			forget: { state: "complete", pending: 0 },
		});
		expect(count(store, "world_assertion")).toBe(0);
		expect(leaks(store, MARKER)).toEqual([]);
	});
});

describe("4 source keys longer than 256 bytes can be forgotten", () => {
	const longId = "x".repeat(240);
	const longRef = ref({ id: longId });
	const longState = state({ id: longId });
	test("register, forget, tombstone and late arrival", () => {
		const store = world();
		const key = srcKey(0).length; // sanity: normal keys are short
		expect(key).toBeLessThan(256);
		const longKey = JSON.stringify(["conversation", "message", longId, null]);
		expect(new TextEncoder().encode(longKey).length).toBeGreaterThan(256);
		const c = claim({
			id: "c-long",
			evidence: [
				{
					evidenceId: "ev-long",
					kind: "user_statement",
					stance: "supports",
					source: longRef,
					rootEvidenceId: "root-long",
				},
			],
			inputManifest: [longRef],
			rootEvidenceIds: ["root-long"],
		});
		const host = hostChecks([longState]);
		expect(run(store, register("r1", c, host)).status).toBe("applied");
		const result = run(
			store,
			forgetChunk(
				"f-1",
				"fg-1",
				[{ kind: "source", id: longKey, revision: 1 }],
				{ hostChecks: host },
			),
		);
		expect(result).toMatchObject({
			status: "applied",
			forget: { state: "complete", pending: 0 },
		});
		expect(count(store, "world_assertion")).toBe(0);
		store.read((db) =>
			expect(
				getTombstone(db, A, { kind: "source", id: longKey }),
			).toBeDefined(),
		);
		expect(reopen(store, "ro", "fg-1").status).toBe("applied");
		expect(
			run(store, register("late", { ...c, id: "c-late" } as never, host)),
		).toEqual({ status: "rejected", reasonCode: "TOMBSTONED" });
	});
});

describe("5 entity forget reaches predictions naming the entity", () => {
	test("prediction goes with its subject entity and cannot come back", () => {
		const store = world();
		const prediction = quantPrediction("pred-1", "cmp-1");
		expect(
			run(
				store,
				envelope(
					"p1",
					{
						kind: "prediction.register",
						input: { prediction, dueAt: 5000 },
					},
					{ hostChecks: states() },
				),
			).status,
		).toBe("applied");
		expect(count(store, "world_prediction")).toBe(1);
		const result = run(
			store,
			forgetChunk("f-1", "fg-1", [
				{ kind: "entity", id: "svc-1", revision: 1 },
			]),
		);
		expect(result).toMatchObject({
			status: "applied",
			forget: { state: "complete" },
		});
		expect(count(store, "world_prediction")).toBe(0);
		expect(reopen(store, "ro", "fg-1").status).toBe("applied");
		expect(
			run(
				store,
				envelope(
					"p2",
					{
						kind: "prediction.register",
						input: {
							prediction: quantPrediction("pred-2", "cmp-2"),
							dueAt: 5000,
						},
					},
					{ hostChecks: states() },
				),
			),
		).toEqual({ status: "rejected", reasonCode: "TOMBSTONED" });
	});
});

describe("6/7 replay digest", () => {
	test("500 roots with long ids fit; a reordered resend is a no_op", () => {
		const store = world();
		const longKey = (n: number) =>
			JSON.stringify([
				"conversation",
				"message",
				`s-${n}-${"y".repeat(100)}`,
				null,
			]);
		const roots = Array.from({ length: 500 }, (_, n) => ({
			kind: "source",
			id: longKey(n),
			revision: 1,
		}));
		const first = run(store, forgetChunk("f-1", "fg-1", roots));
		expect(first).toMatchObject({ status: "applied" });
		const again = run(store, forgetChunk("f-1", "fg-1", [...roots].reverse()));
		expect(again.status).toBe("no_op");
		const other = run(
			store,
			forgetChunk("f-1", "fg-1", [...roots.slice(1), sourceRoot(9)]),
		);
		expect(other).toEqual({
			status: "rejected",
			reasonCode: "OPERATION_KEY_CONFLICT",
		});
	});
});

describe("8 incremental projection equals a rebuild in EVERY column", () => {
	test("seeded sequences incl. dispute, retract, supersede, invalidate (causal_eligible, edge payloads)", () => {
		for (let seed0 = 1; seed0 <= 6; seed0++) {
			let seed = seed0 * 104729;
			const rnd = (n: number) => {
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
				return seed % n;
			};
			const store = world("memory");
			const ids = Array.from({ length: 8 }, (_, i) => `c${i}`);
			ids.forEach((id, i) =>
				expect(
					run(
						store,
						register(
							`r-${id}`,
							markedClaim(id, 1 + (i % 3), [1], false, {
								subjectId: `s${i}`,
								payload: {
									kind: "relation",
									relation: "causes",
									objectId: `s${(i + 1) % 8}`,
								},
							}),
						),
					).status,
				).toBe("applied"),
			);
			let key = 0;
			const kinds = new Set<string>();
			for (let step = 0; step < 40; step++) {
				const id = ids[rnd(ids.length)]!;
				const head = store.read((db) => getAssertion(db, A, id)!);
				const k = `s-${key++}`;
				if (head.lifecycle === "candidate") {
					if (
						run(store, transition(k, plan(store, id, adoptReq(k)))).status ===
						"applied"
					)
						kinds.add("adopt");
				} else if (
					head.lifecycle === "active" ||
					head.lifecycle === "disputed"
				) {
					const choice = rnd(4);
					const other = ids.find((o) => o !== id)!;
					const target = store.read((db) => getAssertion(db, A, other)!);
					if (choice === 0 && head.lifecycle === "active") {
						const r = run(
							store,
							transition(
								k,
								plan(store, id, {
									action: "dispute",
									contradicts: [{ id: other, revision: target.revision }],
								}),
							),
						);
						if (r.status === "applied") kinds.add("dispute");
					} else if (choice === 1) {
						const r = run(
							store,
							envelope(
								k,
								{
									kind: "invalidate",
									reasonCode: "INPUT_VERSION_INVALIDATED",
									targets: [{ id, expectedRevision: head.revision }],
								},
								{ hostChecks: states() },
							),
						);
						if (r.status === "applied") kinds.add("invalidate");
					} else if (choice === 2) {
						const p = plan(store, id, {
							action: "supersede",
							replacementRevision: head.revision + 1,
						});
						const replacement = markedClaim(id, 1, [1], false, {
							revision: head.revision + 1,
							subjectId: head.subjectId,
							payload: head.payload,
							supersedes: [{ id, revision: head.revision }],
						});
						const r = run(store, transition(k, p, states(), replacement));
						if (r.status === "applied") kinds.add("supersede");
					}
				}
			}
			expect(kinds.has("adopt")).toBe(true);
			expect(kinds.has("dispute") || kinds.has("invalidate")).toBe(true);
			const columns = (st: TestStore) =>
				st.read((db) => ({
					current: db
						.query(
							"SELECT * FROM world_current ORDER BY assertion_id, assertion_revision",
						)
						.all(),
					edges: db
						.query("SELECT * FROM world_edge ORDER BY edge_id, revision")
						.all(),
					epoch: db.query("SELECT * FROM world_scope_epoch").all(),
				}));
			const before = columns(store);
			store.write((db) => rebuildProjection(db, A, context));
			expect(columns(store)).toEqual(before);
			store.close();
			stores.splice(stores.indexOf(store), 1);
		}
	});

	test("a contested claim is not causally eligible, and becomes eligible again when the disputer goes", () => {
		const store = world();
		const rel = (id: string, from: string, to: string) =>
			markedClaim(id, 1, [1], false, {
				subjectId: from,
				payload: { kind: "relation", relation: "causes", objectId: to },
			});
		run(store, register("t", rel("t1", "x", "y")));
		run(store, transition("a1", adoptPlan("t1", 1)));
		run(store, register("d", rel("d1", "p", "q")));
		run(store, transition("a2", adoptPlan("d1", 1)));
		const eligible = () =>
			store.read(
				(db) =>
					(
						db
							.query(
								"SELECT causal_eligible AS e FROM world_current WHERE assertion_id = 't1' ORDER BY assertion_revision DESC",
							)
							.get() as { e: number }
					).e,
			);
		expect(eligible()).toBe(1);
		const head = store.read((db) => getAssertion(db, A, "t1")!);
		run(
			store,
			transition(
				"dis",
				plan(store, "d1", {
					action: "dispute",
					contradicts: [{ id: "t1", revision: head.revision }],
				}),
			),
		);
		expect(eligible()).toBe(0);
		const edgeFlag = () =>
			store.read(
				(db) =>
					JSON.parse(
						(
							db
								.query(
									"SELECT payload_json AS p FROM world_edge WHERE assertion_id = 't1'",
								)
								.get() as { p: string }
						).p,
					).causalEligible,
			);
		expect(edgeFlag()).toBe(false);
		run(
			store,
			envelope(
				"inv",
				{
					kind: "invalidate",
					reasonCode: "INPUT_VERSION_INVALIDATED",
					targets: [
						{
							id: "d1",
							expectedRevision: store.read(
								(db) => getAssertion(db, A, "d1")!.revision,
							),
						},
					],
				},
				{ hostChecks: states() },
			),
		);
		expect(eligible()).toBe(1);
		expect(edgeFlag()).toBe(true);
	});
});

describe("9 invalidate by source only stops heads that still depend on it", () => {
	test("a head superseded onto another source survives an invalidate of the old source", () => {
		const store = world();
		run(store, register("r1", markedClaim("c-1", 1, [1], false)));
		const p = plan(store, "c-1", {
			action: "supersede",
			replacementRevision: 2,
		});
		const replacement = markedClaim("c-1", 2, [2], false, {
			revision: 2,
			supersedes: [{ id: "c-1", revision: 1 }],
		});
		expect(run(store, transition("s1", p, states(), replacement)).status).toBe(
			"applied",
		);
		const result = run(
			store,
			envelope(
				"inv",
				{
					kind: "invalidate",
					reasonCode: "INPUT_VERSION_INVALIDATED",
					targets: [],
					sourceKeys: [srcKey(1)],
				},
				{ hostChecks: states() },
			),
		);
		expect(result.status).toBe("applied");
		const head = store.read((db) => getAssertion(db, A, "c-1")!);
		expect(head.revision).toBe(2);
		expect(head.lifecycle).toBe("candidate");
	});
});

describe("10 forget.reopen names the forget that owns the gate", () => {
	const finish = (store: TestStore, key: string, forgetId: string, n: number) =>
		run(store, forgetChunk(key, forgetId, [sourceRoot(n)]));
	test("an older, already reopened forget cannot open the gate of a newer one", () => {
		const store = world();
		expect(finish(store, "f1", "fg-1", 7).status).toBe("applied");
		expect(reopen(store, "ro1", "fg-1").status).toBe("applied");
		expect(finish(store, "f2", "fg-2", 8).status).toBe("applied");
		expect(reopen(store, "ro-old", "fg-1")).toEqual({
			status: "blocked",
			reasonCode: "FORGET_NOT_AWAITING",
		});
		expect(store.read((db) => getGate(db, A))?.state).toBe("closed");
		expect(reopen(store, "ro2", "fg-2").status).toBe("applied");
		expect(store.read((db) => getGate(db, A))?.state).toBe("open");
	});

	test("any pending forget target keeps the gate shut even for the owning forget", () => {
		const store = world();
		store.write((db) => {
			beginForget(db, A, {
				forgetId: "fg-pending",
				reasonCode: "FORGET_REQUESTED",
			});
			saveForgetTargets(db, A, "fg-pending", [
				{ kind: "source", id: srcKey(5), revision: 1 },
			]);
		});
		expect(finish(store, "f2", "fg-2", 8).status).toBe("applied");
		expect(reopen(store, "ro", "fg-2")).toEqual({
			status: "blocked",
			reasonCode: "FORGET_PENDING",
		});
	});
});

describe("surviving mutants of round 1", () => {
	test("a reason source at another revision than the recorded input is refused before any DML", () => {
		const store = world();
		run(store, register("r1", markedClaim("c-1", 1, [1], false)));
		const reasonSource = ref({ id: "src-1", revision: "rev-9" });
		const retract = plan(store, "c-1", { action: "retract", reasonSource });
		const host = hostChecks([
			state({ id: "src-1" }),
			state({ id: "src-1", revision: "rev-9" }),
		]);
		const before = dump(store);
		const counted = store.write((db) => {
			const probe = failingDb(db, 0);
			const result = apply(probe, transition("t1", retract, host));
			return { result, dml: probe.dmlCount };
		});
		expect(counted.result).toEqual({
			status: "rejected",
			reasonCode: "CONFLICTING_INPUT_REVISIONS",
		});
		expect(counted.dml).toBe(0);
		expect(dump(store)).toEqual(before);
	});

	test("a changed policy blocks a write before any DML", () => {
		const store = world();
		const before = dump(store);
		const counted = store.write((db) => {
			const probe = failingDb(db, 0);
			const result = apply(
				probe,
				registerWith({ access: { ...access(), policyRevision: "pol-OLD" } }),
			);
			return { result, dml: probe.dmlCount };
		});
		expect(counted.result).toEqual({
			status: "blocked",
			reasonCode: "POLICY_CHANGED",
		});
		expect(counted.dml).toBe(0);
		expect(dump(store)).toEqual(before);
	});

	test("a supersede whose replacement names a forgotten entity is refused", () => {
		const store = world();
		run(store, register("r1", markedClaim("c-1", 1, [1], false)));
		store.write((db) =>
			insertTombstone(db, A, {
				kind: "entity",
				id: "svc-gone",
				forgetId: "fg-x",
				reasonCode: "FORGET_REQUESTED",
			}),
		);
		const p = plan(store, "c-1", {
			action: "supersede",
			replacementRevision: 2,
		});
		const replacement = markedClaim("c-1", 1, [1], false, {
			revision: 2,
			subjectId: "svc-gone",
			supersedes: [{ id: "c-1", revision: 1 }],
		});
		expect(run(store, transition("s1", p, states(), replacement))).toEqual({
			status: "rejected",
			reasonCode: "TOMBSTONED",
		});
	});
});

function registerWith(over: Record<string, unknown>) {
	return {
		...register("rw", markedClaim("c-rw", 1, [1], false)),
		...over,
	};
}
