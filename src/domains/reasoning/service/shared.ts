import {
	canonicalBytes,
	fail,
	ok,
	type Checked,
} from "../../../contracts/index.ts";
import { evaluateConditions, type Tri } from "../../conditions/index.ts";
import type {
	Budget,
	GraphInput,
	ReasoningEdge,
	ReasoningReason,
} from "../contracts/index.ts";

const byEdge = (a: ReasoningEdge, b: ReasoningEdge) =>
	a.id < b.id ? -1 : a.id > b.id ? 1 : a.revision - b.revision;

/** Counters consumed inside the traversal loops; never after the fact. */
export class Meter {
	expansions = 0;
	stopped = false;
	readonly reasons = new Set<ReasoningReason>();
	constructor(readonly budget: Budget) {}
	/** Spend one expansion. False means the budget is exhausted: stop. */
	expand(): boolean {
		if (this.stopped) return false;
		if (this.expansions >= this.budget.expansions) {
			this.reasons.add("EXPANSION_BUDGET");
			this.stopped = true;
			return false;
		}
		this.expansions++;
		return true;
	}
	stop(reason: ReasoningReason) {
		this.reasons.add(reason);
		this.stopped = true;
	}
	note(reason: ReasoningReason) {
		this.reasons.add(reason);
	}
	sortedReasons(): ReasoningReason[] {
		return [...this.reasons].sort();
	}
	status(): "complete" | "partial" {
		return this.reasons.size === 0 ? "complete" : "partial";
	}
}

export interface Graph {
	readonly out: ReadonlyMap<string, readonly ReasoningEdge[]>;
	readonly into: ReadonlyMap<string, readonly ReasoningEdge[]>;
	readonly edges: readonly ReasoningEdge[];
	readonly conditions: ReadonlyMap<string, Tri>;
}

const edgeKey = (e: ReasoningEdge) => `${e.id}\u0000${e.revision}`;

/**
 * Takes at most `candidates` edges (deterministic order); the sentinel row, if
 * present, only proves the budget was cut and is never expanded.
 */
export function buildGraph(input: GraphInput, meter: Meter): Checked<Graph> {
	if (!input.authorized) return fail("SCOPE_NOT_PERMITTED", "authorized");
	const sorted = [...input.edges].sort(byEdge);
	if (sorted.length > input.budget.candidates) meter.note("CANDIDATE_BUDGET");
	const edges = sorted.slice(0, input.budget.candidates);
	const out = new Map<string, ReasoningEdge[]>();
	const into = new Map<string, ReasoningEdge[]>();
	const conditions = new Map<string, Tri>();
	for (const edge of edges) {
		const from = out.get(edge.from) ?? [];
		from.push(edge);
		out.set(edge.from, from);
		const to = into.get(edge.to) ?? [];
		to.push(edge);
		into.set(edge.to, to);
		const result = evaluateConditions({
			contractVersion: 1,
			asOf: input.context.asOf,
			authorized: true,
			maxAgeMs: input.context.maxAgeMs,
			condition: edge.condition,
			...(edge.validTime ? { validTime: edge.validTime } : {}),
			observations: input.context.observations,
			...(input.context.currentVersions
				? { currentVersions: input.context.currentVersions }
				: {}),
		});
		conditions.set(edgeKey(edge), result.ok ? result.value.result : "unknown");
	}
	return ok({ out, into, edges, conditions });
}

export const conditionOf = (graph: Graph, edge: ReasoningEdge): Tri =>
	graph.conditions.get(edgeKey(edge)) ?? "unknown";

/**
 * Drops trailing items, whole items only, until the serialized result fits the
 * presentation budget, and marks the result partial. `lists` are ordered from
 * the least to the most important: the first non-empty list is trimmed first.
 * Every list that contributes bytes to the result must be passed in.
 */
export function fitPresentation<
	T extends { status: "complete" | "partial"; reasons: ReasoningReason[] },
>(result: T, lists: unknown[][], bytes: number): T {
	for (;;) {
		const encoded = canonicalBytes(result, Number.MAX_SAFE_INTEGER);
		if (!encoded.ok || encoded.value.length <= bytes) return result;
		const list = lists.find((candidate) => candidate.length > 0);
		if (!list) return result;
		list.pop();
		result.status = "partial";
		if (!result.reasons.includes("PRESENTATION_BUDGET")) {
			result.reasons.push("PRESENTATION_BUDGET");
			result.reasons.sort();
		}
	}
}
