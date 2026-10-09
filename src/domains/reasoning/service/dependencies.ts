import {
	asRecord,
	checkId,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
} from "../../../contracts/index.ts";
import {
	checkGraphInput,
	resourceStates,
	type ReasoningEdge,
	type ReasoningReason,
	type ResourceState,
} from "../contracts/index.ts";
import { buildGraph, conditionOf, fitPresentation, Meter } from "./shared.ts";

export type DependencyReason =
	| "RESOURCE_STATE_MISSING"
	| "CONDITION_UNKNOWN"
	| "EDGE_NOT_ADOPTED";

export interface DependencyItem {
	readonly entityId: string;
	readonly depth: number;
	readonly viaEdgeId: string;
	readonly state: ResourceState;
	readonly reasonCode?: DependencyReason;
}
export interface DependencyResult {
	status: "complete" | "partial";
	reasons: ReasoningReason[];
	entityId: string;
	/** all_available only when the search is complete and nothing is unknown. */
	outcome: "all_available" | "unsatisfied" | "unknown";
	dependencies: DependencyItem[];
	unsatisfied: string[];
	unknown: string[];
	/** Availability never confirms that the dependent actually succeeds. */
	successConfirmed: false;
	/** Absence of depends_on edges is not evidence that nothing is required. */
	reasonCode?: "NO_DEPENDENCIES_KNOWN";
}

export function checkResourceStates(
	value: unknown,
	path = "resourceStates",
): Checked<Map<string, ResourceState>> {
	const map = new Map<string, ResourceState>();
	if (value === undefined) return ok(map);
	if (!Array.isArray(value)) return fail("INVALID_INPUT", path);
	if (value.length > 2000) return fail("LIMIT_EXCEEDED", path);
	for (let i = 0; i < value.length; i++) {
		const object = asRecord(value[i]);
		if (!object) return fail("INVALID_INPUT", `${path}[${i}]`);
		if (firstUnknownKey(object, ["entityId", "state"]) !== undefined)
			return fail("INVALID_INPUT", `${path}[${i}]`);
		const id = checkId(object["entityId"], `${path}[${i}].entityId`);
		if (!id.ok) return id;
		const state = object["state"];
		if (!resourceStates.includes(state as ResourceState))
			return fail("INVALID_INPUT", `${path}[${i}].state`);
		if (map.has(id.value)) return fail("INVALID_INPUT", `${path}[${i}]`);
		map.set(id.value, state as ResourceState);
	}
	return ok(map);
}

interface Aggregate {
	depth: number;
	readonly edges: ReasoningEdge[];
}

/**
 * Transitive depends_on search; cycles stop on the visited set. Every
 * depends_on edge that reaches a resource is aggregated before its state is
 * chosen, so the result does not depend on edge order. A resource is a hard
 * failure only through an adopted, causal-eligible edge whose condition is
 * satisfied; otherwise the dependency itself is unknown.
 */
export function checkDependencies(input: unknown): Checked<DependencyResult> {
	const parsed = checkGraphInput(input, ["entityId", "resourceStates"]);
	if (!parsed.ok) return parsed;
	const { graph: query, object } = parsed.value;
	const entityId = checkId(object["entityId"], "entityId");
	if (!entityId.ok) return entityId;
	const states = checkResourceStates(object["resourceStates"]);
	if (!states.ok) return states;
	const meter = new Meter(query.budget);
	const graph = buildGraph(query, meter);
	if (!graph.ok) return graph;
	const { budget } = query;
	const found = new Map<string, Aggregate>();
	const seen = new Set<string>([entityId.value]);
	let frontier = [entityId.value];
	for (let depth = 1; frontier.length > 0 && !meter.stopped; depth++) {
		const next: string[] = [];
		for (const node of frontier) {
			for (const edge of graph.value.out.get(node) ?? []) {
				if (edge.relation !== "depends_on") continue;
				if (!meter.expand()) break;
				if (conditionOf(graph.value, edge) === "violated") continue;
				const known = found.get(edge.to);
				if (known) {
					known.edges.push(edge);
					continue;
				}
				if (seen.has(edge.to)) continue;
				if (depth > budget.relevanceDepth) {
					meter.note("DEPTH_BUDGET");
					continue;
				}
				if (found.size >= budget.entities) {
					meter.stop("ENTITY_BUDGET");
					break;
				}
				seen.add(edge.to);
				next.push(edge.to);
				found.set(edge.to, { depth, edges: [edge] });
			}
			if (meter.stopped) break;
		}
		frontier = next;
	}
	const items: DependencyItem[] = [];
	for (const [entityKey, aggregate] of found) {
		const edges = [...aggregate.edges].sort((a, b) =>
			a.id < b.id ? -1 : a.id > b.id ? 1 : a.revision - b.revision,
		);
		const hard = edges.some(
			(edge) =>
				edge.status === "active" &&
				edge.causalEligible &&
				conditionOf(graph.value, edge) === "satisfied",
		);
		let state: ResourceState;
		let reasonCode: DependencyReason | undefined;
		const known = states.value.get(entityKey);
		if (hard) {
			if (known === undefined) {
				state = "unknown";
				reasonCode = "RESOURCE_STATE_MISSING";
			} else state = known;
		} else {
			state = "unknown";
			reasonCode = edges.some(
				(edge) =>
					edge.status === "active" &&
					edge.causalEligible &&
					conditionOf(graph.value, edge) === "unknown",
			)
				? "CONDITION_UNKNOWN"
				: "EDGE_NOT_ADOPTED";
		}
		items.push({
			entityId: entityKey,
			depth: aggregate.depth,
			viaEdgeId: edges[0]!.id,
			state,
			...(reasonCode ? { reasonCode } : {}),
		});
	}
	const dependencies = items.sort(
		(a, b) => a.depth - b.depth || (a.entityId < b.entityId ? -1 : 1),
	);
	const unsatisfied = dependencies
		.filter((d) => d.state === "unavailable")
		.map((d) => d.entityId);
	const unknown = dependencies
		.filter((d) => d.state === "unknown")
		.map((d) => d.entityId);
	const status = meter.status();
	const nothingKnown = dependencies.length === 0;
	const result: DependencyResult = {
		status,
		reasons: meter.sortedReasons(),
		entityId: entityId.value,
		outcome:
			unsatisfied.length > 0
				? "unsatisfied"
				: unknown.length > 0 || status === "partial" || nothingKnown
					? "unknown"
					: "all_available",
		dependencies,
		unsatisfied,
		unknown,
		successConfirmed: false,
		...(nothingKnown ? { reasonCode: "NO_DEPENDENCIES_KNOWN" as const } : {}),
	};
	fitPresentation(
		result,
		[result.dependencies, result.unknown, result.unsatisfied],
		budget.presentationBytes,
	);
	// Trimming the lists makes the search partial: never report all_available.
	if (result.status === "partial" && result.outcome === "all_available")
		result.outcome = "unknown";
	return ok(result);
}
