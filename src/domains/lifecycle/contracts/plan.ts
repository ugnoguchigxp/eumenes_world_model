import {
	asRecord,
	checkContractVersion,
	checkDependentRef,
	checkScope,
	dependentKey,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
	type DependentRef,
	type FailureCode,
	type ScopeRef,
	type WorldContractVersion,
} from "../../../contracts/index.ts";

/** Largest chunk per plan call (contract C9 / P2-07). */
export const MAX_PLAN_BUDGET = 500;
export const MAX_PLAN_ROOTS = 500;
export const MAX_PLAN_EDGES = 100_000;
/**
 * Largest closure: every root plus one new node per edge. A cursor carries
 * pending + done nodes, so its caps must cover this or the planner would
 * reject its own continuation near the end of a maximal closure.
 */
export const MAX_PLAN_NODES = MAX_PLAN_ROOTS + MAX_PLAN_EDGES;

/** Input-dependency edge owned by one Scope: `dependent` was derived from `input`. */
export interface ScopedDependencyEdge {
	readonly scope: ScopeRef;
	readonly input: DependentRef;
	readonly dependent: DependentRef;
}

/**
 * Continuation state. `pending` are discovered but not yet emitted;
 * `done` are already emitted in earlier batches. Both are in stable order.
 */
export interface PlanCursor {
	readonly pending: readonly DependentRef[];
	readonly done: readonly DependentRef[];
	/**
	 * Invalidation roots: already changed, never emitted (not even through a
	 * cycle). Carried here so a continuation is self-contained and cannot emit
	 * a root when the caller resends different (or no) roots.
	 */
	readonly excluded: readonly DependentRef[];
}

export interface PlanRequest {
	readonly contractVersion: WorldContractVersion;
	readonly scope: ScopeRef;
	/** Versioned causes (forgotten/changed inputs). Exact kind/id/revision match. */
	readonly roots: readonly DependentRef[];
	readonly edges: readonly ScopedDependencyEdge[];
	/** Max targets emitted by this call (1..MAX_PLAN_BUDGET). */
	readonly budget: number;
	readonly cursor?: PlanCursor;
}

export interface PlanRejected {
	readonly status: "rejected";
	readonly reasonCode: FailureCode;
}
export interface PlanResult {
	readonly status: "planned";
	/** Next targets in closure order; metadata only, never payload. */
	readonly targets: readonly DependentRef[];
	/** true only when the whole closure has been emitted. */
	readonly complete: boolean;
	/** true when work remains: the Scope gate must stay closed. */
	readonly requiresClosedGate: boolean;
	/** Present iff !complete. Unemitted targets are NOT reported as processed. */
	readonly cursor?: PlanCursor;
}
export type PlanOutcome = PlanResult | PlanRejected;

function refs(
	value: unknown,
	path: string,
	max: number,
): Checked<DependentRef[]> {
	if (!Array.isArray(value)) return fail("INVALID_INPUT", path);
	if (value.length > max) return fail("LIMIT_EXCEEDED", path);
	const out: DependentRef[] = [];
	for (let i = 0; i < value.length; i++) {
		const ref = checkDependentRef(value[i], `${path}[${i}]`);
		if (!ref.ok) return ref;
		out.push(ref.value);
	}
	return ok(out);
}

function checkCursor(value: unknown): Checked<PlanCursor> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", "cursor");
	const extra = firstUnknownKey(object, ["pending", "done", "excluded"]);
	if (extra !== undefined) return fail("INVALID_INPUT", `cursor.${extra}`);
	const pending = refs(object["pending"], "cursor.pending", MAX_PLAN_NODES);
	if (!pending.ok) return pending;
	const done = refs(object["done"], "cursor.done", MAX_PLAN_NODES);
	if (!done.ok) return done;
	const excluded = refs(
		object["excluded"] ?? [],
		"cursor.excluded",
		MAX_PLAN_ROOTS,
	);
	if (!excluded.ok) return excluded;
	const seen = new Set(done.value.map(dependentKey));
	for (const ref of pending.value)
		if (seen.has(dependentKey(ref))) return fail("INVALID_INPUT", "cursor");
	// An excluded root is neither emitted nor waiting to be emitted.
	const blocked = new Set([...seen, ...pending.value.map(dependentKey)]);
	for (const ref of excluded.value)
		if (blocked.has(dependentKey(ref))) return fail("INVALID_INPUT", "cursor");
	return ok({
		pending: pending.value,
		done: done.value,
		excluded: excluded.value,
	});
}

/** Strict runtime parse of an unknown request. */
export function parsePlanRequest(value: unknown): Checked<PlanRequest> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", "request");
	const extra = firstUnknownKey(object, [
		"contractVersion",
		"scope",
		"roots",
		"edges",
		"budget",
		"cursor",
	]);
	if (extra !== undefined) return fail("INVALID_INPUT", extra);
	const version = checkContractVersion(object["contractVersion"]);
	if (!version.ok) return version;
	const scope = checkScope(object["scope"]);
	if (!scope.ok) return scope;
	const roots = refs(object["roots"], "roots", MAX_PLAN_ROOTS);
	if (!roots.ok) return roots;
	const budget = object["budget"];
	if (typeof budget !== "number" || !Number.isSafeInteger(budget) || budget < 1)
		return fail("INVALID_INPUT", "budget");
	if (budget > MAX_PLAN_BUDGET) return fail("LIMIT_EXCEEDED", "budget");
	const rawEdges = object["edges"];
	if (!Array.isArray(rawEdges)) return fail("INVALID_INPUT", "edges");
	if (rawEdges.length > MAX_PLAN_EDGES) return fail("LIMIT_EXCEEDED", "edges");
	const edges: ScopedDependencyEdge[] = [];
	for (let i = 0; i < rawEdges.length; i++) {
		const path = `edges[${i}]`;
		const edge = asRecord(rawEdges[i]);
		if (!edge) return fail("INVALID_INPUT", path);
		const bad = firstUnknownKey(edge, ["scope", "input", "dependent"]);
		if (bad !== undefined) return fail("INVALID_INPUT", `${path}.${bad}`);
		const edgeScope = checkScope(edge["scope"], `${path}.scope`);
		if (!edgeScope.ok) return edgeScope;
		const input = checkDependentRef(edge["input"], `${path}.input`);
		if (!input.ok) return input;
		const dependent = checkDependentRef(edge["dependent"], `${path}.dependent`);
		if (!dependent.ok) return dependent;
		edges.push({
			scope: edgeScope.value,
			input: input.value,
			dependent: dependent.value,
		});
	}
	let cursor: PlanCursor | undefined;
	if (object["cursor"] !== undefined) {
		const parsed = checkCursor(object["cursor"]);
		if (!parsed.ok) return parsed;
		cursor = parsed.value;
	}
	return ok({
		contractVersion: version.value,
		scope: scope.value,
		roots: roots.value,
		edges,
		budget,
		...(cursor ? { cursor } : {}),
	});
}
