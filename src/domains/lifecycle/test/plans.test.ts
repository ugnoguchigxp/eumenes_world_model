import { describe, expect, test } from "bun:test";
import {
	compareDependentRef,
	dependentKey,
	type DependentKind,
	type DependentRef,
} from "../../../contracts/index.ts";
import {
	planForget,
	planInvalidation,
	type PlanOutcome,
	type ScopedDependencyEdge,
} from "../index.ts";

const A = { principal: "p-a", scopeKey: "scope-a" };
const B = { principal: "p-a", scopeKey: "scope-b" };
const r = (kind: DependentKind, id: string, revision = 1): DependentRef => ({
	kind,
	id,
	revision,
});
const e = (
	input: DependentRef,
	dependent: DependentRef,
	scope = A,
): ScopedDependencyEdge => ({ scope, input, dependent });
const keys = (refs: readonly DependentRef[]) => refs.map(dependentKey);

const s1 = r("source", "s1");
const s2 = r("source", "s2");
const a = r("assertion", "a");
const b = r("assertion", "b");

function request(over: Record<string, unknown>) {
	return {
		contractVersion: 1,
		scope: A,
		roots: [],
		edges: [],
		budget: 500,
		...over,
	};
}
/** Runs every batch, feeding the cursor back. */
function drain(
	plan: (i: unknown) => PlanOutcome,
	base: Record<string, unknown>,
	budget: number,
) {
	const all: DependentRef[] = [];
	let cursor: unknown;
	for (let guard = 0; guard < 1000; guard++) {
		const out = plan(
			request({ ...base, budget, ...(cursor ? { cursor } : {}) }),
		);
		if (out.status !== "planned") throw new Error("rejected");
		all.push(...out.targets);
		expect(out.targets.length).toBeLessThanOrEqual(budget);
		if (out.complete) {
			expect(out.requiresClosedGate).toBe(false);
			expect(out.cursor).toBeUndefined();
			return all;
		}
		expect(out.requiresClosedGate).toBe(true);
		cursor = out.cursor;
	}
	throw new Error("no termination");
}

const graphs: Record<
	string,
	{
		roots: DependentRef[];
		edges: ScopedDependencyEdge[];
		forget: DependentRef[];
	}
> = {
	"A11 chain s1->a->b, s2->b, cycle b->a": {
		roots: [s2],
		edges: [e(s1, a), e(a, b), e(s2, b), e(b, a)],
		forget: [s2, b, a],
	},
	"multi-root": {
		roots: [s1, s2],
		edges: [e(s1, a), e(s2, b), e(a, r("manifest", "m"))],
		forget: [s1, s2, a, b, r("manifest", "m")].sort(compareDependentRef),
	},
	"multi-hop with unrelated branch": {
		roots: [s1],
		edges: [
			e(s1, a),
			e(a, b),
			e(b, r("prediction", "p")),
			e(r("prediction", "p"), r("outcome", "o")),
			e(s2, r("assertion", "z")),
		],
		forget: [s1, a, b, r("prediction", "p"), r("outcome", "o")].sort(
			compareDependentRef,
		),
	},
};

describe("A11 closure", () => {
	test("forget of an uncited input source reaches a and b through the cycle", () => {
		const out = planForget(
			request({
				roots: [s2],
				edges: graphs["A11 chain s1->a->b, s2->b, cycle b->a"]!.edges,
			}),
		);
		expect(out).toMatchObject({
			status: "planned",
			complete: true,
			requiresClosedGate: false,
		});
		if (out.status !== "planned") return;
		expect(keys(out.targets).sort()).toEqual(keys([s2, a, b]).sort());
	});
	test("invalidation excludes the roots even when a cycle returns to them", () => {
		const out = planInvalidation(
			request({ roots: [a], edges: [e(a, b), e(b, a)] }),
		);
		if (out.status !== "planned") throw new Error("rejected");
		expect(out.targets).toEqual([b]);
	});
	test("revision-specific: other revisions of the same id are not matched", () => {
		const out = planInvalidation(
			request({
				roots: [r("source", "s1", 1)],
				edges: [e(r("source", "s1", 2), a)],
			}),
		);
		if (out.status !== "planned") throw new Error("rejected");
		expect(out.targets).toEqual([]);
	});
	for (const [name, g] of Object.entries(graphs)) {
		test(`batches concatenate to the unbounded set and order: ${name}`, () => {
			const base = { roots: g.roots, edges: g.edges };
			const whole = drain(planForget, base, 500);
			expect(keys(whole).sort()).toEqual(keys(g.forget).sort());
			for (let size = 1; size <= whole.length + 1; size++) {
				const batched = drain(planForget, base, size);
				expect(keys(batched)).toEqual(keys(whole));
				expect(new Set(keys(batched)).size).toBe(batched.length);
			}
			const inv = drain(planInvalidation, base, 1);
			expect(keys(inv).sort()).toEqual(
				keys(
					g.forget.filter(
						(x) =>
							!g.roots.some((root) => dependentKey(root) === dependentKey(x)),
					),
				).sort(),
			);
		});
	}
	test("input order does not change the plan", () => {
		const g = graphs["multi-hop with unrelated branch"]!;
		const x = planForget(request({ roots: g.roots, edges: g.edges }));
		const y = planForget(
			request({ roots: g.roots, edges: [...g.edges].reverse() }),
		);
		expect(x).toEqual(y);
	});
	test("budget exceeded: partial, gate closed, unscanned not reported", () => {
		const out = planForget(
			request({ roots: [s1], edges: [e(s1, a), e(a, b)], budget: 1 }),
		);
		if (out.status !== "planned") throw new Error("rejected");
		expect(out.complete).toBe(false);
		expect(out.requiresClosedGate).toBe(true);
		expect(out.targets).toEqual([s1]);
		expect(out.cursor?.pending).toEqual([a]);
		expect(out.cursor?.done).toEqual([s1]);
	});
	test("cross-scope: other Scope edges and IDs never appear", () => {
		const hidden = r("assertion", "hidden-in-scope-b");
		const out = planForget(
			request({
				roots: [s1],
				edges: [e(s1, a), e(s1, hidden, B), e(hidden, r("entity", "x"), B)],
			}),
		);
		if (out.status !== "planned") throw new Error("rejected");
		expect(keys(out.targets)).toEqual(keys([s1, a]));
		expect(JSON.stringify(out)).not.toContain("hidden-in-scope-b");
	});
	test("a large closure completes in 500-target chunks", () => {
		const edges: ScopedDependencyEdge[] = [];
		for (let i = 0; i < 1200; i++)
			edges.push(
				e(i === 0 ? s1 : r("assertion", `n${i - 1}`), r("assertion", `n${i}`)),
			);
		const out = planForget(request({ roots: [s1], edges, budget: 500 }));
		if (out.status !== "planned") throw new Error("rejected");
		expect(out.targets.length).toBe(500);
		expect(out.complete).toBe(false);
		expect(drain(planForget, { roots: [s1], edges }, 500).length).toBe(1201);
	});
});

describe("closure shape and cursor capacity", () => {
	test("a diamond emits the shared dependent exactly once", () => {
		const c = r("assertion", "c");
		const edges = [e(s1, a), e(s1, b), e(a, c), e(b, c)];
		for (const budget of [1, 2, 3, 500]) {
			const all = drain(planForget, { roots: [s1], edges }, budget);
			expect(keys(all)).toEqual(keys([s1, a, b, c]));
		}
	});
	test("a cursor as large as a maximal closure is accepted (roots + edges)", () => {
		const nodes = 500 + 100_000;
		const make = (count: number) =>
			Array.from({ length: count }, (_, i) =>
				r("assertion", `d${String(i).padStart(6, "0")}`),
			);
		const pending = Array.from({ length: 500 }, (_, i) =>
			r("assertion", `p${String(i).padStart(3, "0")}`),
		);
		// the last call of a maximal closure carries all but `budget` nodes in done
		const done = make(nodes - 450);
		const out = planForget(
			request({
				roots: [],
				budget: 450,
				cursor: { pending: pending.slice(0, 450), done, excluded: [] },
			}),
		);
		if (out.status !== "planned") throw new Error(`rejected:${out.reasonCode}`);
		expect(out.targets.length).toBe(450);
		expect(out.complete).toBe(true);
		// done alone may hold the whole closure (100_500 > the old 100_000 cap)
		const full = planForget(
			request({
				roots: [],
				budget: 1,
				cursor: { pending: [], done: make(nodes), excluded: [] },
			}),
		);
		expect(full.status).toBe("planned");
		// one past the capacity is still refused
		const tooMany = planForget(
			request({
				roots: [],
				cursor: { pending: [], done: make(nodes + 1), excluded: [] },
			}),
		);
		expect(tooMany).toEqual({
			status: "rejected",
			reasonCode: "LIMIT_EXCEEDED",
		});
	});
	test("many roots with several dependents drain in chunks without loss", () => {
		const roots = Array.from({ length: 500 }, (_, i) =>
			r("source", `s${String(i).padStart(3, "0")}`),
		);
		const edges: ScopedDependencyEdge[] = [];
		for (const [i, root] of roots.entries())
			for (let j = 0; j < 3; j++)
				edges.push(e(root, r("assertion", `a${i}-${j}`)));
		const all = drain(planForget, { roots, edges }, 450);
		expect(all.length).toBe(500 + 1500);
		expect(new Set(keys(all)).size).toBe(all.length);
	});
});

describe("strict validation from unknown", () => {
	const bad = (input: unknown, code: string) =>
		expect(planForget(input)).toEqual({
			status: "rejected",
			reasonCode: code as never,
		});
	test("high fan-out: 50k dependents, budget 500, ordered and fast enough", () => {
		const root = r("source", "hub");
		const deps = Array.from({ length: 50_000 }, (_, i) =>
			r("assertion", `a${String(i).padStart(6, "0")}`),
		);
		const edges = deps.map((d) => e(root, d));
		const started = performance.now();
		const first = planForget({
			contractVersion: 1,
			scope: A,
			roots: [root],
			edges,
			budget: 500,
		}) as Extract<PlanOutcome, { status: "planned" }>;
		const elapsed = performance.now() - started;
		expect(first.complete).toBe(false);
		expect(first.targets.length).toBe(500);
		// the root is emitted first, then dependents in ascending id order
		expect(first.targets[0]).toEqual(root);
		const emittedIds = first.targets.slice(1).map((t) => t.id);
		expect(emittedIds).toEqual([...emittedIds].sort());
		expect(emittedIds[0]).toBe("a000000");
		expect(first.cursor!.pending.length).toBe(50_001 - 500);
		// Re-sorting the whole pending set per emission took ~700ms here.
		expect(elapsed).toBeLessThan(400);
	});
	test("rejections", () => {
		bad(null, "INVALID_INPUT");
		bad(request({ contractVersion: 2 }), "UNSUPPORTED_CONTRACT_VERSION");
		bad(request({ extra: 1 }), "INVALID_INPUT");
		bad(request({ budget: 0 }), "INVALID_INPUT");
		bad(request({ budget: 501 }), "LIMIT_EXCEEDED");
		bad(request({ budget: 1.5 }), "INVALID_INPUT");
		bad(request({ scope: { principal: "p" } }), "INVALID_INPUT");
		bad(
			request({ roots: [{ kind: "nope", id: "x", revision: 1 }] }),
			"INVALID_INPUT",
		);
		bad(request({ roots: [{ ...s1, revision: 0 }] }), "INVALID_INPUT");
		bad(request({ edges: [{ scope: A, input: s1 }] }), "INVALID_INPUT");
		bad(
			request({ edges: [{ ...e(s1, a), payload: "text" }] }),
			"INVALID_INPUT",
		);
		bad(request({ cursor: { pending: [s1], done: [s1] } }), "INVALID_INPUT");
		bad(request({ cursor: { pending: [] } }), "INVALID_INPUT");
	});
	test("input is not mutated", () => {
		const input = request({
			roots: [s1],
			edges: [e(s1, a), e(a, b)],
			budget: 1,
		});
		const before = JSON.stringify(input);
		planForget(input);
		planInvalidation(input);
		expect(JSON.stringify(input)).toBe(before);
	});
});

describe("round-2 fixes: the cursor is a self-contained continuation", () => {
	// root -> a -> b -> root (cycle back to the root)
	const root = r("source", "root");
	const edges = [e(root, a), e(a, b), e(b, root)];
	test("a follow-up call with roots: [] cannot emit the excluded root", () => {
		const first = planInvalidation(
			request({ roots: [root], edges, budget: 1 }),
		);
		if (first.status !== "planned" || first.complete)
			throw new Error("expected a partial plan");
		expect(keys(first.targets)).toEqual(keys([a]));
		expect(keys(first.cursor!.excluded)).toEqual(keys([root]));
		const second = planInvalidation(
			request({ roots: [], edges, budget: 10, cursor: first.cursor }),
		);
		if (second.status !== "planned") throw new Error("rejected");
		expect(keys(second.targets)).toEqual(keys([b]));
		expect(second.complete).toBe(true);
		// the unbounded run agrees, and resending different roots changes nothing
		const wrong = planInvalidation(
			request({ roots: [a], edges, budget: 10, cursor: first.cursor }),
		);
		expect(wrong).toEqual(second);
	});
	test("an excluded root may not also be pending or done in a cursor", () => {
		const out = planInvalidation(
			request({
				roots: [],
				edges,
				cursor: { pending: [root], done: [], excluded: [root] },
			}),
		);
		expect(out.status).toBe("rejected");
	});
	test("forget keeps its roots (they are targets, nothing is excluded)", () => {
		const out = planForget(request({ roots: [root], edges, budget: 1 }));
		if (out.status !== "planned" || out.complete)
			throw new Error("expected a partial plan");
		expect(out.cursor!.excluded).toEqual([]);
	});
});
