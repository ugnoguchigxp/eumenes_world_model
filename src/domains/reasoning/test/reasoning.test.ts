import { describe, expect, test } from "bun:test";
import {
	checkDependencies,
	compareGaps,
	edgesFromEntries,
	composeEffect,
	explainRelevance,
	findResearchGaps,
	traceInfluence,
	type ResearchGap,
} from "../index.ts";

const NOW = 1791500000000;
const scope = { principal: "p-a", scopeKey: "scope-a" };
const yes = { kind: "explicitly_unconditional", adoptionEvidenceId: "ev-1" };
const axis = { metric: "latency", comparison: "p95" };

type Edge = Record<string, unknown>;
const edge = (
	id: string,
	from: string,
	to: string,
	relation: string,
	extra: Edge = {},
): Edge => ({
	id,
	revision: 1,
	from,
	to,
	relation,
	status: "active",
	causalEligible: true,
	condition: yes,
	...extra,
});
const query = (edges: Edge[], extra: Edge = {}) => ({
	contractVersion: 1,
	scope,
	authorized: true,
	asOf: NOW,
	maxAgeMs: 60_000,
	observations: [],
	edges,
	...extra,
});
function freeze<T>(value: T): T {
	if (typeof value === "object" && value !== null) {
		for (const v of Object.values(value)) freeze(v);
		Object.freeze(value);
	}
	return value;
}
function influence(edges: Edge[], entityId: string, extra: Edge = {}) {
	const result = traceInfluence(
		query(edges, { entityId, direction: "forward", ...extra }),
	);
	if (!result.ok) throw new Error(`rejected:${result.code}:${result.path}`);
	return result.value;
}
const nodesOf = (paths: { nodes: readonly string[] }[]) =>
	paths.map((p) => p.nodes.join(">"));

describe("A14 causal propagation follows only directed causal edges", () => {
	const graph = [
		edge("e1", "A", "B", "causes"),
		edge("e2", "B", "C", "correlates_with"),
		edge("e3", "B", "D", "part_of"),
		edge("e4", "B", "E", "serves_goal"),
		edge("e5", "B", "F", "related_to"),
	];
	test("A->B causal only; correlation, part_of, goal and related_to excluded", () => {
		const r = influence(graph, "A");
		expect(nodesOf(r.paths)).toEqual(["A>B"]);
		expect(r.status).toBe("complete");
		expect(r.skipped.map((s) => [s.edgeId, s.reasonCode])).toEqual([
			["e2", "NON_CAUSAL_RELATION"],
			["e3", "NON_CAUSAL_RELATION"],
			["e4", "NON_CAUSAL_RELATION"],
			["e5", "NON_CAUSAL_RELATION"],
		]);
	});
	test("reverse search lists cause candidates and keeps edge direction", () => {
		const r = influence(graph, "B", { direction: "reverse" });
		expect(nodesOf(r.paths)).toEqual(["A>B"]);
		expect(r.paths[0]!.edges[0]).toMatchObject({ from: "A", to: "B" });
		// Forward-only effects are not reachable backwards from A.
		const fromA = influence(graph, "A", { direction: "reverse" });
		expect(fromA.paths).toEqual([]);
		expect(fromA.noPathMeaning).toBe("NO_PATH_FOUND_NOT_NO_EFFECT");
	});
	test("feedback loops are finite", () => {
		const r = influence(
			[edge("e1", "A", "B", "causes"), edge("e2", "B", "A", "causes")],
			"A",
		);
		expect(nodesOf(r.paths)).toEqual(["A>B"]);
		expect(r.skipped).toEqual([{ edgeId: "e2", reasonCode: "FEEDBACK" }]);
		expect(r.status).toBe("complete");
	});
	test("disputed or non-eligible claims never propagate", () => {
		const r = influence(
			[
				edge("e1", "A", "B", "causes", {
					status: "disputed",
					causalEligible: false,
				}),
				edge("e2", "A", "C", "causes", {
					status: "candidate",
					causalEligible: false,
				}),
			],
			"A",
		);
		expect(r.paths).toEqual([]);
		expect(r.skipped.map((s) => s.reasonCode)).toEqual([
			"NOT_CAUSAL_ELIGIBLE",
			"NOT_CAUSAL_ELIGIBLE",
		]);
	});
	test("sign composition needs one comparison axis; otherwise unknown", () => {
		const mk = (relation: "increases" | "decreases", a?: typeof axis) =>
			({
				id: "x",
				revision: 1,
				from: "a",
				to: "b",
				relation,
				status: "active",
				causalEligible: true,
				condition: { kind: "unspecified" },
				...(a ? { axis: a } : {}),
			}) as const;
		expect(
			composeEffect([mk("increases", axis), mk("increases", axis)]),
		).toEqual({
			effect: "increases",
			reasons: [],
		});
		expect(
			composeEffect([mk("decreases", axis), mk("decreases", axis)]).effect,
		).toBe("increases");
		expect(
			composeEffect([mk("increases", axis), mk("decreases", axis)]).effect,
		).toBe("decreases");
		expect(
			composeEffect([
				mk("increases", axis),
				mk("increases", { ...axis, metric: "throughput" }),
			]),
		).toEqual({ effect: "unknown", reasons: ["AXIS_MISMATCH"] });
		expect(composeEffect([mk("increases")]).reasons).toEqual(["AXIS_MISSING"]);
	});
	test("causes/enables are never converted to a numeric effect", () => {
		const r = influence(
			[
				edge("e1", "A", "B", "increases", { axis }),
				edge("e2", "B", "C", "enables"),
			],
			"A",
		);
		expect(r.paths.map((p) => [p.nodes.join(">"), p.effect])).toEqual([
			["A>B", "increases"],
			["A>B>C", "unknown"],
		]);
		expect(JSON.stringify(r)).not.toMatch(/score|probability|magnitude/);
	});
	test("unknown condition keeps the path unconfirmed; violated condition stops it", () => {
		const compare = {
			kind: "expression",
			expression: {
				kind: "compare",
				key: "flag",
				op: "eq",
				value: { kind: "boolean", value: true },
			},
		};
		const observation = (value: boolean) => ({
			observationId: "o1",
			key: "flag",
			value: { kind: "boolean", value },
			observedAt: NOW - 10,
			version: "v1",
			priority: 1,
		});
		const unknown = influence(
			[edge("e1", "A", "B", "causes", { condition: { kind: "unspecified" } })],
			"A",
		);
		expect(unknown.paths[0]!.confirmed).toBe(false);
		const satisfied = influence(
			[edge("e1", "A", "B", "causes", { condition: compare })],
			"A",
			{ observations: [observation(true)] },
		);
		expect(satisfied.paths[0]!.confirmed).toBe(true);
		const violated = influence(
			[edge("e1", "A", "B", "causes", { condition: compare })],
			"A",
			{ observations: [observation(false)] },
		);
		expect(violated.paths).toEqual([]);
		expect(violated.skipped).toEqual([
			{ edgeId: "e1", reasonCode: "CONDITION_VIOLATED" },
		]);
	});
	test("relevance lists correlation as related but not propagating", () => {
		const r = explainRelevance(
			query(
				[
					edge("e1", "A", "B", "causes"),
					edge("e2", "B", "C", "correlates_with"),
					edge("e3", "D", "B", "part_of"),
				],
				{ entityId: "A" },
			),
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.entities.map((e) => `${e.entityId}:${e.distance}`)).toEqual([
			"A:0",
			"B:1",
			"C:2",
			"D:2",
		]);
		const flags = Object.fromEntries(
			r.value.relations.map((x) => [x.edgeId, x.causalPropagation]),
		);
		expect(flags).toEqual({ e1: true, e2: false, e3: false });
	});
});

describe("A15 budgets are consumed inside the loops", () => {
	test("501 candidates are cut at 500 with partial; 502 is rejected", () => {
		const edges = Array.from({ length: 501 }, (_, i) =>
			edge(`e${String(i).padStart(3, "0")}`, `n${i}`, `n${i + 1}`, "causes"),
		);
		const r = influence(edges, "n0");
		expect(r.status).toBe("partial");
		expect(r.reasons).toContain("CANDIDATE_BUDGET");
		const tooMany = traceInfluence(
			query([...edges, edge("e999", "x", "y", "causes")], {
				entityId: "n0",
				direction: "forward",
			}),
		);
		expect(tooMany.ok).toBe(false);
	});
	test("expansion budget stops the search; no_path is not no_effect", () => {
		const edges = Array.from({ length: 20 }, (_, i) =>
			edge(`e${String(i).padStart(2, "0")}`, "A", `x${i}`, "causes"),
		);
		const r = influence(edges, "A", { budget: { expansions: 5 } });
		expect(r.status).toBe("partial");
		expect(r.reasons).toContain("EXPANSION_BUDGET");
		expect(r.paths.length).toBeLessThanOrEqual(5);
		const none = influence([edge("e1", "Z", "Y", "causes")], "A", {
			budget: { expansions: 1 },
		});
		expect(none.noPathMeaning).toBe("NO_PATH_FOUND_NOT_NO_EFFECT");
	});
	test("depth and path limits report partial with a reason", () => {
		const chain = ["A", "B", "C", "D", "E"]
			.slice(0, -1)
			.map((from, i) =>
				edge(`e${i}`, from, ["B", "C", "D", "E"][i]!, "causes"),
			);
		const deep = influence(chain, "A");
		expect(nodesOf(deep.paths)).toEqual(["A>B", "A>B>C", "A>B>C>D"]);
		expect(deep.reasons).toContain("DEPTH_BUDGET");
		const fan = Array.from({ length: 15 }, (_, i) =>
			edge(`f${String(i).padStart(2, "0")}`, "A", `y${i}`, "causes"),
		);
		const wide = influence(fan, "A", { budget: { paths: 100 } });
		expect(wide.paths).toHaveLength(10);
		expect(wide.reasons).toContain("PATH_BUDGET");
	});
	test("host budgets only lower the defaults", () => {
		const fan = Array.from({ length: 15 }, (_, i) =>
			edge(`f${String(i).padStart(2, "0")}`, "A", `y${i}`, "causes"),
		);
		expect(influence(fan, "A", { budget: { paths: 3 } }).paths).toHaveLength(3);
		expect(influence(fan, "A", { budget: { entities: 4 } }).reasons).toContain(
			"ENTITY_BUDGET",
		);
	});
	test("presentation stays within the byte budget, dropping whole items", () => {
		const fan = Array.from({ length: 10 }, (_, i) =>
			edge(`f${String(i).padStart(2, "0")}`, "A", `y${i}`, "causes"),
		);
		const r = influence(fan, "A", { budget: { presentationBytes: 900 } });
		expect(r.status).toBe("partial");
		expect(r.reasons).toContain("PRESENTATION_BUDGET");
		expect(
			new TextEncoder().encode(JSON.stringify(r)).length,
		).toBeLessThanOrEqual(900);
		expect(r.paths.length).toBeLessThan(10);
	});
	test("relevance honours depth and entity budgets", () => {
		const chain = Array.from({ length: 7 }, (_, i) =>
			edge(`e${i}`, `n${i}`, `n${i + 1}`, "related_to"),
		);
		const r = explainRelevance(query(chain, { entityId: "n0" }));
		expect(r.ok && r.value.entities.map((e) => e.entityId)).toEqual([
			"n0",
			"n1",
			"n2",
			"n3",
			"n4",
		]);
		expect(r.ok && r.value.reasons).toContain("DEPTH_BUDGET");
		const fan = Array.from({ length: 40 }, (_, i) =>
			edge(`f${String(i).padStart(2, "0")}`, "A", `y${i}`, "related_to"),
		);
		const wide = explainRelevance(query(fan, { entityId: "A" }));
		expect(wide.ok && wide.value.entities.length).toBeLessThanOrEqual(30);
		expect(wide.ok && wide.value.reasons).toContain("ENTITY_BUDGET");
	});
});

describe("determinism, strictness and scope", () => {
	const edges = [
		edge("e2", "A", "C", "causes"),
		edge("e1", "A", "B", "causes"),
		edge("e3", "B", "D", "causes"),
	];
	test("input order does not change output; inputs are not mutated", () => {
		const a = traceInfluence(
			freeze(query(edges, { entityId: "A", direction: "forward" })),
		);
		const b = traceInfluence(
			query([...edges].reverse(), { entityId: "A", direction: "forward" }),
		);
		expect(a).toEqual(b);
	});
	test("unauthorized, unknown fields and bad versions are rejected without detail", () => {
		const denied = traceInfluence(
			query(edges, { entityId: "A", direction: "forward", authorized: false }),
		);
		expect(denied).toEqual({
			ok: false,
			code: "SCOPE_NOT_PERMITTED",
			path: "authorized",
		});
		expect(
			traceInfluence(
				query(edges, { entityId: "A", direction: "forward", extra: 1 }),
			).ok,
		).toBe(false);
		expect(
			traceInfluence(query(edges, { entityId: "A", direction: "sideways" })).ok,
		).toBe(false);
		const v2 = traceInfluence({
			...query(edges),
			contractVersion: 2,
			entityId: "A",
			direction: "forward",
		});
		expect(v2.ok === false && v2.code).toBe("UNSUPPORTED_CONTRACT_VERSION");
		expect(
			explainRelevance(
				query([{ ...edges[0]!, relation: "magic" }], { entityId: "A" }),
			).ok,
		).toBe(false);
	});
});

describe("A16 dependencies and research gaps", () => {
	const deps = [
		edge("d1", "App", "R1", "depends_on"),
		edge("d2", "App", "R2", "depends_on"),
		edge("d3", "R1", "R3", "depends_on"),
		edge("d4", "R3", "App", "depends_on"),
	];
	const state = (entityId: string, s: string) => ({ entityId, state: s });
	test("unavailable beats unknown; cycles terminate", () => {
		const r = checkDependencies(
			query(deps, {
				entityId: "App",
				resourceStates: [state("R1", "available"), state("R2", "unavailable")],
			}),
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.outcome).toBe("unsatisfied");
		expect(r.value.unsatisfied).toEqual(["R2"]);
		expect(r.value.unknown).toEqual(["R3"]);
		expect(r.value.dependencies.map((d) => d.entityId)).toEqual([
			"R1",
			"R2",
			"R3",
		]);
	});
	test("available alone never confirms success", () => {
		const r = checkDependencies(
			query(deps, {
				entityId: "App",
				resourceStates: ["R1", "R2", "R3"].map((id) => state(id, "available")),
			}),
		);
		expect(r.ok && r.value.outcome).toBe("all_available");
		expect(r.ok && r.value.successConfirmed).toBe(false);
	});
	test("missing resource state and truncation stay unknown", () => {
		const missing = checkDependencies(
			query(deps.slice(0, 1), { entityId: "App" }),
		);
		expect(missing.ok && missing.value.outcome).toBe("unknown");
		expect(missing.ok && missing.value.dependencies[0]!.reasonCode).toBe(
			"RESOURCE_STATE_MISSING",
		);
		const cut = checkDependencies(
			query(deps, {
				entityId: "App",
				resourceStates: ["R1", "R2", "R3"].map((id) => state(id, "available")),
				budget: { expansions: 1 },
			}),
		);
		expect(cut.ok && cut.value.outcome).toBe("unknown");
		expect(cut.ok && cut.value.status).toBe("partial");
	});
	test("the entity budget stops dependency discovery as partial/unknown (ENTITY_BUDGET)", () => {
		const fan = Array.from({ length: 4 }, (_, i) =>
			edge(`f${i}`, "App", `R${i}`, "depends_on"),
		);
		const states = fan.map((_, i) => state(`R${i}`, "available"));
		const cut = checkDependencies(
			query(fan, {
				entityId: "App",
				resourceStates: states,
				budget: { entities: 2 },
			}),
		);
		expect(cut.ok).toBe(true);
		if (!cut.ok) return;
		expect(cut.value.status).toBe("partial");
		expect(cut.value.reasons).toContain("ENTITY_BUDGET");
		expect(cut.value.outcome).toBe("unknown");
		expect(cut.value.dependencies.length).toBeLessThanOrEqual(2);
		const full = checkDependencies(
			query(fan, { entityId: "App", resourceStates: states }),
		);
		expect(full.ok && full.value.outcome).toBe("all_available");
	});
	const gap = (extra: Partial<ResearchGap>): ResearchGap => ({
		gapKey: "k",
		kind: "MISSING_RESOURCE",
		subjectId: "s",
		edgeId: "e",
		confirmWith: { kind: "edge", id: "e" },
		blocksGoal: false,
		deadlineAt: null,
		confirmationCost: null,
		...extra,
	});
	test("gap order: goal-blocking, deadline, cost, key; unknown after known", () => {
		const sorted = [
			gap({ gapKey: "h" }),
			gap({ gapKey: "g", confirmationCost: 5 }),
			gap({ gapKey: "f", confirmationCost: 1 }),
			gap({ gapKey: "e", deadlineAt: 200 }),
			gap({ gapKey: "d", deadlineAt: 100 }),
			gap({ gapKey: "c", blocksGoal: true }),
			gap({ gapKey: "b", blocksGoal: true, deadlineAt: 900 }),
		].sort(compareGaps);
		expect(sorted.map((g) => g.gapKey)).toEqual([
			"b",
			"c",
			"d",
			"e",
			"f",
			"g",
			"h",
		]);
	});
	test("gaps are derived with confirmation candidates and Goal handling", () => {
		const edges = [
			edge("d1", "App", "R1", "depends_on"),
			edge("d2", "App", "R2", "depends_on"),
			edge("c1", "App", "Perf", "causes"),
			edge("c2", "App", "Cost", "increases", { axis }),
			edge("c3", "App", "Risk", "enables", {
				condition: { kind: "unspecified" },
			}),
		];
		const base = {
			resourceStates: [state("R1", "available"), state("R2", "unavailable")],
			annotations: [
				{
					gapKey: "MISSING_RESOURCE:d2",
					blocksGoal: true,
					deadlineAt: NOW + 1000,
				},
				{
					gapKey: "MEASUREMENT_MISSING:c1",
					blocksGoal: true,
					confirmationCost: 3,
				},
			],
		};
		const adopted = findResearchGaps(
			query(edges, {
				...base,
				goal: { goalId: "g1", revision: 1, status: "adopted" },
			}),
		);
		expect(adopted.ok).toBe(true);
		if (!adopted.ok) return;
		expect(adopted.value.gaps.map((g) => g.gapKey)).toEqual([
			"MISSING_RESOURCE:d2",
			"MEASUREMENT_MISSING:c1",
			"CONDITION_UNKNOWN:c3",
			"MEASUREMENT_MISSING:c3",
		]);
		expect(adopted.value.gaps[0]!.confirmWith).toEqual({
			kind: "entity",
			id: "R2",
		});
		expect(adopted.value.gaps[3]!.confirmationCost).toBeNull();
		for (const goal of [
			{ goalId: "g1", revision: 2, status: "retracted" },
			undefined,
		]) {
			const r = findResearchGaps(
				query(edges, { ...base, ...(goal ? { goal } : {}) }),
			);
			// Precondition: the call itself succeeded (not a validation failure).
			expect(r.ok).toBe(true);
			expect(r.ok && r.value.gaps.length).toBeGreaterThan(0);
			expect(r.ok && r.value.gaps.some((g) => g.blocksGoal)).toBe(false);
		}
	});
	test("annotation validation rejects invented or negative cost", () => {
		for (const annotations of [
			[{ gapKey: "k", confirmationCost: -1 }],
			[{ gapKey: "k", confirmationCost: Number.NaN }],
			[{ gapKey: "k", extra: 1 }],
		])
			expect(findResearchGaps(query([], { annotations })).ok).toBe(false);
	});
});

describe("review fixes: 8KiB presentation budget in every API", () => {
	const bytes = (v: unknown) =>
		new TextEncoder().encode(JSON.stringify(v)).length;
	const longId = (prefix: string, i: number) =>
		`${prefix}-${"x".repeat(90)}-${String(i).padStart(3, "0")}`;
	test("traceInfluence trims the skipped list too", () => {
		const edges = Array.from({ length: 400 }, (_, i) =>
			edge(longId("e", i), "A", `n${i}`, "part_of"),
		);
		const r = influence(edges, "A");
		expect(r.skipped.length).toBeGreaterThan(0);
		expect(bytes(r)).toBeLessThanOrEqual(8192);
		expect(r.status).toBe("partial");
		expect(r.reasons).toContain("PRESENTATION_BUDGET");
	});
	test("explainRelevance trims entities as well as relations", () => {
		const edges = Array.from({ length: 29 }, (_, i) =>
			edge(longId("e", i), "A", longId("n", i), "related_to"),
		);
		const r = explainRelevance(
			query(edges, { entityId: "A", budget: { presentationBytes: 1500 } }),
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(bytes(r.value)).toBeLessThanOrEqual(1500);
		expect(r.value.status).toBe("partial");
		expect(r.value.reasons).toContain("PRESENTATION_BUDGET");
	});
	test("checkDependencies trims all arrays and never reports all_available when cut", () => {
		const edges = Array.from({ length: 29 }, (_, i) =>
			edge(longId("d", i), "App", longId("R", i), "depends_on"),
		);
		const resourceStates = edges.map((e) => ({
			entityId: e["to"],
			state: "available",
		}));
		const r = checkDependencies(
			query(edges, {
				entityId: "App",
				resourceStates,
				budget: { presentationBytes: 1200 },
			}),
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(bytes(r.value)).toBeLessThanOrEqual(1200);
		expect(r.value.status).toBe("partial");
		expect(r.value.outcome).toBe("unknown");
		const unknownMany = checkDependencies(
			query(
				edges.map((e) => ({ ...e })),
				{ entityId: "App", budget: { presentationBytes: 1500 } },
			),
		);
		expect(unknownMany.ok && bytes(unknownMany.value)).toBeLessThanOrEqual(
			1500,
		);
	});
});

describe("review fixes: relevance and dependency semantics", () => {
	test("relevance does not flag causal propagation for a violated condition", () => {
		const compare = {
			kind: "expression",
			expression: {
				kind: "compare",
				key: "flag",
				op: "eq",
				value: { kind: "boolean", value: true },
			},
		};
		const observations = [
			{
				observationId: "o1",
				key: "flag",
				value: { kind: "boolean", value: false },
				observedAt: NOW - 10,
				version: "v1",
				priority: 1,
			},
		];
		const edges = [edge("e1", "A", "B", "causes", { condition: compare })];
		const r = explainRelevance(query(edges, { entityId: "A", observations }));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		// traceInfluence skips the same edge as violated: the two APIs agree.
		const trace = traceInfluence(
			query(edges, { entityId: "A", direction: "forward", observations }),
		);
		expect(trace.ok && trace.value.skipped[0]?.reasonCode).toBe(
			"CONDITION_VIOLATED",
		);
		expect(r.value.relations[0]?.causalPropagation).toBe(false);
	});
	test("a self-loop is expanded once", () => {
		const r = explainRelevance(
			query([edge("loop", "A", "A", "related_to")], {
				entityId: "A",
				budget: { expansions: 1 },
			}),
		);
		expect(r.ok).toBe(true);
		expect(r.ok && r.value.reasons).not.toContain("EXPANSION_BUDGET");
		expect(r.ok && r.value.relations).toHaveLength(1);
	});
	test("a non-adopted or unknown-condition edge never makes a hard unsatisfied", () => {
		const unavailable = [{ entityId: "R1", state: "unavailable" }];
		const candidate = checkDependencies(
			query(
				[
					edge("d1", "App", "R1", "depends_on", {
						status: "candidate",
						causalEligible: false,
					}),
				],
				{ entityId: "App", resourceStates: unavailable },
			),
		);
		expect(candidate.ok && candidate.value.outcome).toBe("unknown");
		expect(candidate.ok && candidate.value.unsatisfied).toEqual([]);
		const unspecified = checkDependencies(
			query(
				[
					edge("d1", "App", "R1", "depends_on", {
						condition: { kind: "unspecified" },
					}),
				],
				{ entityId: "App", resourceStates: unavailable },
			),
		);
		expect(unspecified.ok && unspecified.value.outcome).toBe("unknown");
		// An adopted, confirmed dependency on an unavailable resource is hard.
		const hard = checkDependencies(
			query([edge("d1", "App", "R1", "depends_on")], {
				entityId: "App",
				resourceStates: unavailable,
			}),
		);
		expect(hard.ok && hard.value.outcome).toBe("unsatisfied");
	});
});

describe("round 2 fixes", () => {
	const deps = (
		edges: Edge[],
		states: Record<string, string>,
		extra: Edge = {},
	) => {
		const r = checkDependencies(
			query(edges, {
				entityId: "X",
				resourceStates: Object.entries(states).map(([entityId, state]) => ({
					entityId,
					state,
				})),
				...extra,
			}),
		);
		if (!r.ok) throw new Error(`rejected:${r.code}:${r.path}`);
		return r.value;
	};
	test("parallel dependency edges aggregate: the result does not depend on edge ids", () => {
		const hypothesis = { status: "candidate", causalEligible: false };
		for (const [a, b] of [
			["a", "b"],
			["b", "a"],
		] as const) {
			const r = deps(
				[
					edge(a, "X", "R", "depends_on", hypothesis),
					edge(b, "X", "R", "depends_on"),
				],
				{ R: "unavailable" },
			);
			expect(r.outcome).toBe("unsatisfied");
			expect(r.unsatisfied).toEqual(["R"]);
		}
		// Only hypothesis edges: unknown, never a hard failure.
		const soft = deps([edge("a", "X", "R", "depends_on", hypothesis)], {
			R: "unavailable",
		});
		expect(soft.outcome).toBe("unknown");
		expect(soft.dependencies[0]?.reasonCode).toBe("EDGE_NOT_ADOPTED");
		// An active edge that is contested (not causal-eligible) is not hard.
		const contested = deps(
			[edge("a", "X", "R", "depends_on", { causalEligible: false })],
			{ R: "unavailable" },
		);
		expect(contested.outcome).toBe("unknown");
	});
	test("no depends_on edge is unknown, not all_available", () => {
		const r = deps([edge("e1", "X", "Y", "causes")], {});
		expect(r.outcome).toBe("unknown");
		expect(r.reasonCode).toBe("NO_DEPENDENCIES_KNOWN");
		expect(r.dependencies).toEqual([]);
	});
	test("findResearchGaps skips violated-condition and hypothesis dependency edges", () => {
		const violated = {
			condition: {
				kind: "expression",
				expression: {
					kind: "compare",
					key: "k",
					op: "eq",
					value: { kind: "boolean", value: true },
				},
			},
		};
		const run = (edges: Edge[], extra: Edge = {}) => {
			const r = findResearchGaps(
				query(edges, {
					resourceStates: [{ entityId: "R", state: "unavailable" }],
					...extra,
				}),
			);
			if (!r.ok) throw new Error(`${r.code}:${r.path}`);
			return r.value.gaps.map((g) => g.gapKey);
		};
		expect(run([edge("d1", "X", "R", "depends_on")])).toEqual([
			"MISSING_RESOURCE:d1",
		]);
		expect(
			run([edge("d1", "X", "R", "depends_on", { status: "candidate" })]),
		).toEqual([]);
		expect(
			run([edge("d1", "X", "R", "depends_on", violated)], {
				observations: [
					{
						observationId: "o1",
						key: "k",
						value: { kind: "boolean", value: false },
						observedAt: NOW - 10,
						version: "v1",
						priority: 1,
					},
				],
			}),
		).toEqual([]);
	});
	test("a relation between two listed boundary-depth entities is kept", () => {
		const graph = [
			edge("e1", "A", "B", "related_to"),
			edge("e2", "B", "C", "related_to"),
			edge("e3", "C", "D", "related_to"),
			edge("e4", "D", "E", "related_to"),
			edge("e5", "D", "G", "related_to"),
			edge("e6", "E", "G", "related_to"),
		];
		const r = explainRelevance(query(graph, { entityId: "A" }));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const ids = r.value.relations.map((x) => x.edgeId);
		expect(r.value.entities.map((e) => e.entityId)).toContain("E");
		expect(r.value.entities.map((e) => e.entityId)).toContain("G");
		expect(ids).toContain("e6");
	});
	test("edgesFromEntries tolerates ids named like Object.prototype members", () => {
		const entries = ["constructor", "__proto__", "toString"].map((id) => ({
			id,
			revision: 1,
			subjectId: "A",
			status: "active",
			causalEligible: true,
			assertion: {
				payload: { kind: "relation", relation: "causes", objectId: "B" },
				condition: yes,
			},
		}));
		const edges = edgesFromEntries(entries as never);
		expect(edges.map((e) => e.id)).toEqual([
			"constructor",
			"__proto__",
			"toString",
		]);
		expect(edges.every((e) => e.axis === undefined)).toBe(true);
	});
	test("findResearchGaps stays within the 8KiB presentation budget", () => {
		const edges = Array.from({ length: 100 }, (_, i) =>
			edge(
				`cause-${String(i).padStart(3, "0")}-${"x".repeat(80)}`,
				"A",
				`B${i}`,
				"causes",
			),
		);
		const r = findResearchGaps(query(edges));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.value.reasons).toContain("PRESENTATION_BUDGET");
		expect(r.value.status).toBe("partial");
		expect(
			new TextEncoder().encode(JSON.stringify(r.value)).length,
		).toBeLessThanOrEqual(8192);
	});
});
