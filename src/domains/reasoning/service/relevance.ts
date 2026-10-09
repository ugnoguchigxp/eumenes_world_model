import { checkId, ok, type Checked } from "../../../contracts/index.ts";
import {
	causalRelations,
	checkGraphInput,
	type ReasoningEdge,
	type ReasoningReason,
} from "../contracts/index.ts";
import { buildGraph, conditionOf, fitPresentation, Meter } from "./shared.ts";

export interface RelatedEntity {
	readonly entityId: string;
	readonly distance: number;
}
export interface RelatedRelation {
	readonly edgeId: string;
	readonly revision: number;
	readonly from: string;
	readonly to: string;
	readonly relation: ReasoningEdge["relation"];
	readonly status: ReasoningEdge["status"];
	/** True only for adopted causal edges; correlation is never causal. */
	readonly causalPropagation: boolean;
}
export interface RelevanceResult {
	status: "complete" | "partial";
	reasons: ReasoningReason[];
	entityId: string;
	entities: RelatedEntity[];
	relations: RelatedRelation[];
}

/**
 * Breadth-first relatedness over every relation kind in either direction.
 * Relevance is explanation material, not an effect: nothing here propagates.
 */
export function explainRelevance(input: unknown): Checked<RelevanceResult> {
	const parsed = checkGraphInput(input, ["entityId"]);
	if (!parsed.ok) return parsed;
	const { graph: query, object } = parsed.value;
	const entityId = checkId(object["entityId"], "entityId");
	if (!entityId.ok) return entityId;
	const meter = new Meter(query.budget);
	const graph = buildGraph(query, meter);
	if (!graph.ok) return graph;
	const { budget } = query;
	const distance = new Map<string, number>([[entityId.value, 0]]);
	const relations = new Map<string, RelatedRelation>();
	let frontier = [entityId.value];
	for (let depth = 0; frontier.length > 0 && !meter.stopped; depth++) {
		const next: string[] = [];
		for (const node of frontier) {
			// A self-loop is both outgoing and incoming: expand it once.
			const incident = [
				...new Set([
					...(graph.value.out.get(node) ?? []),
					...(graph.value.into.get(node) ?? []),
				]),
			].sort((a, b) =>
				a.id < b.id ? -1 : a.id > b.id ? 1 : a.revision - b.revision,
			);
			for (const edge of incident) {
				if (!meter.expand()) break;
				const other = edge.from === node ? edge.to : edge.from;
				// At the depth limit no new entity is added, but a relation between
				// two entities that are already listed must not be silently dropped.
				if (depth >= budget.relevanceDepth && !distance.has(other)) {
					meter.note("DEPTH_BUDGET");
					continue;
				}
				if (!distance.has(other)) {
					if (distance.size >= budget.entities) {
						meter.stop("ENTITY_BUDGET");
						break;
					}
					distance.set(other, depth + 1);
					next.push(other);
				}
				const key = `${edge.id}\u0000${edge.revision}`;
				if (!relations.has(key)) {
					if (relations.size >= budget.relations) {
						meter.stop("RELATION_BUDGET");
						break;
					}
					relations.set(key, {
						edgeId: edge.id,
						revision: edge.revision,
						from: edge.from,
						to: edge.to,
						relation: edge.relation,
						status: edge.status,
						causalPropagation:
							causalRelations.includes(edge.relation) &&
							edge.causalEligible &&
							edge.status === "active" &&
							conditionOf(graph.value, edge) !== "violated",
					});
				}
			}
			if (meter.stopped) break;
		}
		frontier = next;
	}
	const result: RelevanceResult = {
		status: meter.status(),
		reasons: meter.sortedReasons(),
		entityId: entityId.value,
		entities: [...distance]
			.map(([id, d]) => ({ entityId: id, distance: d }))
			.sort(
				(a, b) => a.distance - b.distance || (a.entityId < b.entityId ? -1 : 1),
			),
		relations: [...relations.values()].sort((a, b) =>
			a.edgeId < b.edgeId
				? -1
				: a.edgeId > b.edgeId
					? 1
					: a.revision - b.revision,
		),
	};
	return ok(
		fitPresentation(
			result,
			[result.relations, result.entities],
			budget.presentationBytes,
		),
	);
}
