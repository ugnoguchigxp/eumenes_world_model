import {
	compareDependentRef,
	dependentKey,
	sameScope,
	type DependentRef,
} from "../../../contracts/index.ts";
import {
	parsePlanRequest,
	type PlanCursor,
	type PlanOutcome,
	type PlanRequest,
} from "../contracts/plan.ts";

/** Binary min-heap on the stable (kind, id, revision) order. */
class RefHeap {
	private readonly items: DependentRef[] = [];
	get size(): number {
		return this.items.length;
	}
	push(ref: DependentRef): void {
		const items = this.items;
		let i = items.length;
		items.push(ref);
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (compareDependentRef(items[parent]!, items[i]!) <= 0) break;
			[items[parent], items[i]] = [items[i]!, items[parent]!];
			i = parent;
		}
	}
	pop(): DependentRef {
		const items = this.items;
		const top = items[0]!;
		const last = items.pop()!;
		if (items.length > 0) {
			items[0] = last;
			let i = 0;
			for (;;) {
				const left = 2 * i + 1;
				const right = left + 1;
				let smallest = i;
				if (
					left < items.length &&
					compareDependentRef(items[left]!, items[smallest]!) < 0
				)
					smallest = left;
				if (
					right < items.length &&
					compareDependentRef(items[right]!, items[smallest]!) < 0
				)
					smallest = right;
				if (smallest === i) break;
				[items[smallest], items[i]] = [items[i]!, items[smallest]!];
				i = smallest;
			}
		}
		return top;
	}
	sorted(): DependentRef[] {
		return [...this.items].sort(compareDependentRef);
	}
}

/**
 * Reverse-dependency closure over input edges. Deterministic: the smallest
 * pending ref (kind, id, revision) is always emitted next, so concatenated
 * batches equal the order of one unbounded run. Visited state stops cycles.
 * Edges from other Scopes are ignored and never appear in the output.
 */
export function planClosure(
	input: unknown,
	includeRoots: boolean,
): PlanOutcome {
	const parsed = parsePlanRequest(input);
	if (!parsed.ok) return { status: "rejected", reasonCode: parsed.code };
	const request: PlanRequest = parsed.value;

	const dependents = new Map<string, DependentRef[]>();
	for (const edge of request.edges) {
		if (!sameScope(edge.scope, request.scope)) continue;
		const key = dependentKey(edge.input);
		const list = dependents.get(key);
		if (list) list.push(edge.dependent);
		else dependents.set(key, [edge.dependent]);
	}

	const seen = new Set<string>();
	const pendingKeys = new Set<string>();
	const heap = new RefHeap();
	const markPending = (ref: DependentRef) => {
		const key = dependentKey(ref);
		if (seen.has(key) || pendingKeys.has(key)) return;
		pendingKeys.add(key);
		heap.push(ref);
	};
	const emitted: DependentRef[] = [];
	const done = request.cursor?.done ?? [];
	for (const ref of done) seen.add(dependentKey(ref));

	// Excluded roots are already changed: never emit them, even via a cycle.
	// With a cursor they come from the cursor (self-contained continuation);
	// resent roots are ignored so they cannot change what was excluded.
	const excluded: DependentRef[] = request.cursor
		? [...request.cursor.excluded]
		: includeRoots
			? []
			: [...request.roots].sort(compareDependentRef);
	for (const root of excluded) seen.add(dependentKey(root));
	if (request.cursor) {
		for (const ref of request.cursor.pending) markPending(ref);
	} else {
		for (const root of request.roots) {
			if (includeRoots) markPending(root);
			else
				for (const d of dependents.get(dependentKey(root)) ?? [])
					markPending(d);
		}
	}

	while (heap.size > 0 && emitted.length < request.budget) {
		const next = heap.pop();
		const key = dependentKey(next);
		pendingKeys.delete(key);
		seen.add(key);
		emitted.push(next);
		for (const d of dependents.get(key) ?? []) markPending(d);
	}

	if (heap.size === 0)
		return {
			status: "planned",
			targets: emitted,
			complete: true,
			requiresClosedGate: false,
		};
	const cursor: PlanCursor = {
		pending: heap.sorted(),
		done: [...done, ...emitted].sort(compareDependentRef),
		excluded,
	};
	return {
		status: "planned",
		targets: emitted,
		complete: false,
		requiresClosedGate: true,
		cursor,
	};
}
