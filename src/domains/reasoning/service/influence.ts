import { checkId, fail, ok, type Checked } from "../../../contracts/index.ts";
import {
	causalRelations,
	checkGraphInput,
	type ReasoningEdge,
	type ReasoningReason,
} from "../contracts/index.ts";
import { buildGraph, conditionOf, fitPresentation, Meter } from "./shared.ts";

export type Effect = "increases" | "decreases" | "unknown";
export type EffectReason =
	| "NON_QUANTITATIVE_RELATION"
	| "AXIS_MISSING"
	| "AXIS_MISMATCH";
export type SkipReason =
	| "NON_CAUSAL_RELATION"
	| "NOT_CAUSAL_ELIGIBLE"
	| "CONDITION_VIOLATED"
	| "FEEDBACK";

export interface PathEdge {
	readonly id: string;
	readonly revision: number;
	readonly from: string;
	readonly to: string;
	readonly relation: ReasoningEdge["relation"];
}
export interface InfluencePath {
	/** Entities in the edges' own direction: cause first, effect last. */
	readonly nodes: readonly string[];
	readonly edges: readonly PathEdge[];
	/** Qualitative sign only; never a magnitude, score or probability. */
	readonly effect: Effect;
	readonly effectReasons: readonly EffectReason[];
	/** False when some edge condition is unknown. */
	readonly confirmed: boolean;
}
export interface InfluenceResult {
	status: "complete" | "partial";
	reasons: ReasoningReason[];
	direction: "forward" | "reverse";
	entityId: string;
	paths: InfluencePath[];
	skipped: { edgeId: string; reasonCode: SkipReason }[];
	/** Present when no path was found. no_path is never no_effect. */
	noPathMeaning?: "NO_PATH_FOUND_NOT_NO_EFFECT";
}

/** Sign composition: same comparison axis, increases/decreases only. */
export function composeEffect(edges: readonly ReasoningEdge[]): {
	effect: Effect;
	reasons: EffectReason[];
} {
	const reasons = new Set<EffectReason>();
	let sign = 1;
	let axis = edges[0]?.axis;
	for (const edge of edges) {
		if (edge.relation !== "increases" && edge.relation !== "decreases")
			reasons.add("NON_QUANTITATIVE_RELATION");
		else if (!edge.axis) reasons.add("AXIS_MISSING");
		else if (
			axis &&
			(edge.axis.metric !== axis.metric ||
				edge.axis.comparison !== axis.comparison)
		)
			reasons.add("AXIS_MISMATCH");
		if (edge.relation === "decreases") sign = -sign;
		axis ??= edge.axis;
	}
	if (reasons.size > 0 || edges.length === 0)
		return { effect: "unknown", reasons: [...reasons].sort() };
	return { effect: sign > 0 ? "increases" : "decreases", reasons: [] };
}

/**
 * Directed causal search. Only causal relations on adopted, undisputed claims
 * propagate; correlation, part_of, serves_goal and related_to never do.
 * Reverse mode lists cause candidates; edge directions stay as stored.
 */
export function traceInfluence(input: unknown): Checked<InfluenceResult> {
	const parsed = checkGraphInput(input, ["entityId", "direction"]);
	if (!parsed.ok) return parsed;
	const { graph: query, object } = parsed.value;
	const entityId = checkId(object["entityId"], "entityId");
	if (!entityId.ok) return entityId;
	const direction = object["direction"];
	if (direction !== "forward" && direction !== "reverse")
		return fail("INVALID_INPUT", "direction");
	const meter = new Meter(query.budget);
	const built = buildGraph(query, meter);
	if (!built.ok) return built;
	const graph = built;
	const { budget } = query;
	const paths: InfluencePath[] = [];
	const skipped = new Map<string, SkipReason>();
	const entities = new Set<string>([entityId.value]);
	const relations = new Set<string>();
	const adjacency =
		direction === "forward" ? graph.value.out : graph.value.into;

	function visit(node: string, trail: ReasoningEdge[], seen: Set<string>) {
		for (const edge of adjacency.get(node) ?? []) {
			if (!meter.expand()) return;
			const next = direction === "forward" ? edge.to : edge.from;
			if (!causalRelations.includes(edge.relation)) {
				skipped.set(edge.id, "NON_CAUSAL_RELATION");
				continue;
			}
			if (edge.status !== "active" || !edge.causalEligible) {
				skipped.set(edge.id, "NOT_CAUSAL_ELIGIBLE");
				continue;
			}
			const condition = conditionOf(graph.value, edge);
			if (condition === "violated") {
				skipped.set(edge.id, "CONDITION_VIOLATED");
				continue;
			}
			if (seen.has(next)) {
				skipped.set(edge.id, "FEEDBACK");
				continue;
			}
			if (trail.length + 1 > budget.causalDepth) {
				meter.note("DEPTH_BUDGET");
				continue;
			}
			if (paths.length >= budget.paths) return meter.stop("PATH_BUDGET");
			if (!entities.has(next) && entities.size >= budget.entities)
				return meter.stop("ENTITY_BUDGET");
			if (!relations.has(edge.id) && relations.size >= budget.relations)
				return meter.stop("RELATION_BUDGET");
			entities.add(next);
			relations.add(edge.id);
			const chain =
				direction === "forward" ? [...trail, edge] : [edge, ...trail];
			const composed = composeEffect(chain);
			const nodes = [chain[0]!.from, ...chain.map((e) => e.to)];
			const confirmed = chain.every(
				(e) => conditionOf(graph.value, e) === "satisfied",
			);
			paths.push({
				nodes,
				edges: chain.map((e) => ({
					id: e.id,
					revision: e.revision,
					from: e.from,
					to: e.to,
					relation: e.relation,
				})),
				effect: composed.effect,
				effectReasons: composed.reasons,
				confirmed,
			});
			seen.add(next);
			visit(next, chain, seen);
			seen.delete(next);
			if (meter.stopped) return;
		}
	}
	visit(entityId.value, [], new Set([entityId.value]));

	const result: InfluenceResult = {
		status: meter.status(),
		reasons: meter.sortedReasons(),
		direction,
		entityId: entityId.value,
		paths,
		skipped: [...skipped]
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([edgeId, reasonCode]) => ({ edgeId, reasonCode })),
	};
	if (paths.length === 0) result.noPathMeaning = "NO_PATH_FOUND_NOT_NO_EFFECT";
	return ok(
		fitPresentation(
			result,
			[result.skipped, result.paths],
			budget.presentationBytes,
		),
	);
}
