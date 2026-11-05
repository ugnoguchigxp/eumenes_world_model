import { expect, test } from "bun:test";
import { buildProjection } from "../../src/domains/projection/index.ts";
import {
	A,
	NOW,
	rec,
	snapshot,
	sha256,
} from "../../src/domains/projection/test/helpers.ts";
import {
	edgesFromEntries,
	traceInfluence,
	explainRelevance,
	checkDependencies,
	findResearchGaps,
} from "../../src/domains/reasoning/index.ts";
import { compareScenarios } from "../../src/domains/scenarios/index.ts";

// Public pipeline, not a pre-labelled reasoning edge.
for (const [age, expected] of [
	[500, "fresh"],
	[5000, "stale"],
	[-500, "unknown"],
] as const) {
	test(`projection freshness ${expected} survives reasoning and overlays`, () => {
		const p = buildProjection(
			{
				contractVersion: 1,
				snapshot: snapshot([
					rec("edge", {
						subjectId: "cache",
						predicate: "effect",
						payload: {
							kind: "relation",
							relation: "decreases",
							objectId: "latency",
						},
						observedAt: NOW - age,
						freshnessPolicy: { maxAgeMs: 1000 },
						condition: {
							kind: "explicitly_unconditional",
							adoptionEvidenceId: "ev-edge",
						},
					}),
				]),
			},
			sha256,
		);
		expect(p.ok).toBe(true);
		if (!p.ok) return;
		const edges = edgesFromEntries(p.value.entries, {
			edge: { metric: "latency", comparison: "fixed" },
		});
		expect(edges[0]).toMatchObject({ freshness: expected });
		const query = {
			contractVersion: 1,
			scope: A,
			authorized: true,
			edges,
			asOf: NOW,
			maxAgeMs: 1000,
			observations: [],
			entityId: "cache",
			direction: "forward",
		};
		const r = traceInfluence(query);
		expect(r.ok).toBe(true);
		if (r.ok)
			expect(r.value.paths[0]).toMatchObject({
				basisFreshness: expected,
				confirmed: true,
				edges: [{ freshness: expected }],
			});
		const { direction: _direction, ...related } = query;
		const relevance = explainRelevance(related);
		expect(relevance.ok).toBe(true);
		if (relevance.ok)
			expect(relevance.value.relations[0]).toMatchObject({
				freshness: expected,
			});
		const dep = checkDependencies({
			...related,
			edges: edges.map((e) => ({ ...e, relation: "depends_on" })),
			resourceStates: [{ entityId: "latency", state: "available" }],
		});
		expect(dep.ok).toBe(true);
		if (dep.ok)
			expect(dep.value.dependencies[0]).toMatchObject({
				basis: [{ freshness: expected }],
			});
		const { entityId: _entityId, ...gapQuery } = related;
		const gaps = findResearchGaps({
			...gapQuery,
			edges: edges.map((e) => ({ ...e, relation: "causes" })),
		});
		expect(gaps.ok).toBe(true);
		if (gaps.ok)
			expect(gaps.value.gaps[0]).toMatchObject({ freshness: expected });
		const comparison = compareScenarios({
			...query,
			overlays: [
				{ overlayId: "a", removeEdgeIds: [], addEdges: [] },
				{ overlayId: "b", removeEdgeIds: [], addEdges: [] },
			],
		});
		expect(comparison.ok).toBe(true);
		if (comparison.ok)
			expect(comparison.value.overlays[0].influence.paths[0]).toMatchObject({
				basisFreshness: expected,
			});
	});
}
test("unknown freshness values are rejected rather than silently dropped", () => {
	const edge = {
		id: "e",
		revision: 1,
		from: "a",
		to: "b",
		relation: "causes",
		status: "active",
		causalEligible: true,
		condition: { kind: "unspecified" },
		freshness: "invented",
	};
	expect(
		traceInfluence({
			contractVersion: 1,
			scope: A,
			authorized: true,
			edges: [edge],
			asOf: NOW,
			maxAgeMs: 1000,
			observations: [],
			entityId: "a",
			direction: "forward",
		}).ok,
	).toBe(false);
});
