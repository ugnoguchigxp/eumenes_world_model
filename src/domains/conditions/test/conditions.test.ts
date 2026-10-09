import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	and3,
	evaluateConditions,
	not3,
	or3,
	type Condition,
	type Tri,
} from "../index.ts";

const fixtures = join(import.meta.dir, "../../../../fixtures/conditions");
const tables = JSON.parse(
	readFileSync(join(fixtures, "truth-tables.json"), "utf8"),
);
const tri: Record<string, Tri> = {
	S: "satisfied",
	V: "violated",
	U: "unknown",
};
const T = (key: string): Tri => tri[key]!;
const NOW = 1791500000000;
const ms = (value: number, unit = "ms") => ({ kind: "number", value, unit });
const obs = (over: Record<string, unknown> = {}) => ({
	observationId: "o1",
	key: "latency",
	value: ms(90),
	observedAt: NOW - 1000,
	version: "v1",
	priority: 1,
	...over,
});
const cmp = (op = "lt", value: unknown = ms(100), key = "latency") => ({
	kind: "compare",
	key,
	op,
	value,
});
const input = (condition: unknown, over: Record<string, unknown> = {}) => ({
	contractVersion: 1,
	asOf: NOW,
	authorized: true,
	maxAgeMs: 60_000,
	condition: { kind: "expression", expression: condition },
	observations: [obs()],
	...over,
});
const run = (value: unknown) => {
	const r = evaluateConditions(value);
	if (!r.ok) throw new Error(`rejected:${r.code}:${r.path}`);
	return r.value;
};

// A leaf whose truth value is fixed through an observation of key "k".
const leaf = (value: Tri, id: string) => ({
	condition: cmp("eq", { kind: "boolean", value: true }, id),
	observation:
		value === "unknown"
			? undefined
			: obs({
					observationId: id,
					key: id,
					value: { kind: "boolean", value: value === "satisfied" },
				}),
});
function evalTree(
	build: (leaves: ReturnType<typeof leaf>[]) => unknown,
	values: Tri[],
) {
	const leaves = values.map((v, i) => leaf(v, `k${i}`));
	return run(
		input(build(leaves), {
			observations: leaves.flatMap((l) =>
				l.observation ? [l.observation] : [],
			),
		}),
	);
}

describe("A04 three-valued tables", () => {
	test("NOT: all three inputs", () => {
		for (const [a, out] of tables.not) {
			expect(not3(T(a))).toBe(T(out));
			const r = evalTree(
				([x]) => ({ kind: "not", item: x!.condition }),
				[T(a)],
			);
			expect(r.result).toBe(T(out));
		}
	});
	test("AND/OR: all nine input pairs", () => {
		for (const [a, b, out] of tables.and) {
			expect(and3([T(a), T(b)])).toBe(T(out));
			const r = evalTree(
				(l) => ({ kind: "all", items: l.map((x) => x.condition) }),
				[T(a), T(b)],
			);
			expect(r.result).toBe(T(out));
		}
		for (const [a, b, out] of tables.or) {
			expect(or3([T(a), T(b)])).toBe(T(out));
			const r = evalTree(
				(l) => ({ kind: "any", items: l.map((x) => x.condition) }),
				[T(a), T(b)],
			);
			expect(r.result).toBe(T(out));
		}
		expect(tables.and).toHaveLength(9);
		expect(tables.or).toHaveLength(9);
	});
	test("empty all/any, unspecified and absent condition are unknown", () => {
		for (const kind of ["all", "any"]) {
			const r = run(input({ kind, items: [] }));
			expect(r).toEqual({ result: "unknown", reasons: ["EMPTY_GROUP"] });
		}
		const base = input(undefined);
		expect(run({ ...base, condition: { kind: "unspecified" } }).result).toBe(
			"unknown",
		);
		const { condition: _omit, ...absent } = base;
		expect(run(absent)).toEqual({
			result: "unknown",
			reasons: ["UNSPECIFIED_CONDITION"],
		});
	});
	test("compare operators on a fresh observation of 90ms", () => {
		const table: [string, number, Tri][] = [
			["lt", 100, "satisfied"],
			["lt", 90, "violated"],
			["lte", 90, "satisfied"],
			["gt", 90, "violated"],
			["gte", 90, "satisfied"],
			["eq", 90, "satisfied"],
			["ne", 90, "violated"],
		];
		for (const [op, v, expected] of table)
			expect(run(input(cmp(op, ms(v)))).result).toBe(expected);
	});
	test("unsupported nodes are unknown, never satisfied", () => {
		expect(run(input({ kind: "unsupported" }))).toEqual({
			result: "unknown",
			reasons: ["UNSUPPORTED_CONDITION"],
		});
	});
	test("reasons are deterministic regardless of observation order", () => {
		const a = obs({ observationId: "a", value: ms(1) });
		const b = obs({ observationId: "b", value: ms(2) });
		const r1 = run(input(cmp(), { observations: [a, b] }));
		const r2 = run(input(cmp(), { observations: [b, a] }));
		expect(r1).toEqual(r2);
	});
});

describe("A05 comparability", () => {
	test("ms versus s is unknown (no unit conversion)", () => {
		const r = run(input(cmp("lt", ms(1, "s"))));
		expect(r).toEqual({ result: "unknown", reasons: ["UNIT_MISMATCH"] });
	});
	test("type mismatch is unknown", () => {
		const r = run(input(cmp("eq", { kind: "string", value: "90" })));
		expect(r).toEqual({ result: "unknown", reasons: ["TYPE_MISMATCH"] });
	});
	test("stale observation is unknown; boundary age is still fresh", () => {
		const edge = obs({ observedAt: NOW - 60_000 });
		expect(run(input(cmp(), { observations: [edge] })).result).toBe(
			"satisfied",
		);
		const stale = obs({ observedAt: NOW - 60_001 });
		expect(run(input(cmp(), { observations: [stale] }))).toEqual({
			result: "unknown",
			reasons: ["STALE_OBSERVATION"],
		});
	});
	test("same-priority contradiction is unknown; higher priority decides", () => {
		const yes = obs({ observationId: "a", value: ms(90) });
		const no = obs({ observationId: "b", value: ms(150) });
		expect(run(input(cmp(), { observations: [yes, no] }))).toEqual({
			result: "unknown",
			reasons: ["CONFLICTING_OBSERVATIONS"],
		});
		const strong = { ...no, priority: 2 };
		expect(run(input(cmp(), { observations: [yes, strong] })).result).toBe(
			"violated",
		);
		const dup = { ...yes, observationId: "c" };
		expect(run(input(cmp(), { observations: [yes, dup] })).result).toBe(
			"satisfied",
		);
	});
	test("no observation is unknown", () => {
		expect(run(input(cmp(), { observations: [] }))).toEqual({
			result: "unknown",
			reasons: ["NO_OBSERVATION"],
		});
	});
	test("current-version check excludes changed or unlisted observations", () => {
		const ok = run(
			input(cmp(), {
				currentVersions: [{ observationId: "o1", version: "v1" }],
			}),
		);
		expect(ok.result).toBe("satisfied");
		for (const currentVersions of [
			[{ observationId: "o1", version: "v2" }],
			[],
		])
			expect(run(input(cmp(), { currentVersions }))).toEqual({
				result: "unknown",
				reasons: ["VERSION_MISMATCH"],
			});
	});
	test("AST limits: depth 8 and 64 nodes pass; depth 9 and 65 nodes fail", () => {
		const nest = (depth: number): Condition => {
			let node: Condition = cmp() as Condition;
			for (let i = 1; i < depth; i++) node = { kind: "not", item: node };
			return node;
		};
		expect(evaluateConditions(input(nest(8))).ok).toBe(true);
		const deep = evaluateConditions(input(nest(9)));
		expect(!deep.ok && deep.code).toBe("LIMIT_EXCEEDED");
		const flat = (n: number) => ({
			kind: "all",
			items: Array.from({ length: n - 1 }, () => cmp()),
		});
		expect(evaluateConditions(input(flat(64))).ok).toBe(true);
		const wide = evaluateConditions(input(flat(65)));
		expect(!wide.ok && wide.code).toBe("LIMIT_EXCEEDED");
	});
	test("strict input: unknown fields, bad version and ordering on non-numbers", () => {
		const bad = [
			{ ...input(cmp()), extra: 1 },
			{ ...input(cmp()), contractVersion: 2 },
			{ ...input(cmp()), asOf: 1.5 },
			{ ...input(cmp()), maxAgeMs: -1 },
			{ ...input(cmp()), observations: [obs({ priority: -1 })] },
			{ ...input(cmp()), observations: [obs(), obs()] },
			input(cmp("lt", { kind: "string", value: "x" })),
			input({ kind: "mystery" }),
		];
		for (const value of bad) expect(evaluateConditions(value).ok).toBe(false);
		const v2 = evaluateConditions({ ...input(cmp()), contractVersion: 2 });
		expect(!v2.ok && v2.code).toBe("UNSUPPORTED_CONTRACT_VERSION");
	});
	test("unauthorized callers learn only unknown", () => {
		expect(run(input(cmp(), { authorized: false }))).toEqual({
			result: "unknown",
			reasons: ["NOT_AUTHORIZED"],
		});
	});
});

describe("review fixes: fail-closed operators, priority first, no duplicate versions", () => {
	test("operators never turn a non-Tri value into satisfied", () => {
		const bogus = "bogus" as unknown as Tri;
		expect(not3(bogus)).toBe("unknown");
		expect(and3([bogus])).toBe("unknown");
		expect(and3(["satisfied", bogus])).toBe("unknown");
		expect(and3(["violated", bogus])).toBe("violated");
		expect(or3([bogus])).toBe("unknown");
		expect(or3(["violated", bogus])).toBe("unknown");
		expect(or3(["satisfied", bogus])).toBe("satisfied");
		expect(and3(undefined as unknown as Tri[])).toBe("unknown");
	});
	test("a stale authoritative observation is unknown; a weaker fresh one cannot answer", () => {
		const authoritative = obs({
			observationId: "auth",
			value: ms(500),
			priority: 9,
			observedAt: NOW - 1_000_000,
		});
		const weak = obs({ observationId: "weak", value: ms(90), priority: 1 });
		const r = run(
			input(cmp("lt", ms(100)), { observations: [authoritative, weak] }),
		);
		expect(r).toEqual({ result: "unknown", reasons: ["STALE_OBSERVATION"] });
		// the same holds for an outdated-version authoritative one
		const outdated = obs({ observationId: "auth", priority: 9, version: "v1" });
		const versions = [
			{ observationId: "auth", version: "v2" },
			{ observationId: "weak", version: "v1" },
		];
		expect(
			run(
				input(cmp("lt", ms(100)), {
					observations: [outdated, weak],
					currentVersions: versions,
				}),
			),
		).toEqual({ result: "unknown", reasons: ["VERSION_MISMATCH"] });
	});
	test("a FUTURE observation takes no part in priority selection (backdated asOf)", () => {
		const future = obs({
			observationId: "auth",
			value: ms(500),
			priority: 9,
			observedAt: NOW + 5,
		});
		const past = obs({ observationId: "past", value: ms(90), priority: 1 });
		// the past observation answers; the future one does not exist yet at asOf
		expect(
			run(input(cmp("lt", ms(100)), { observations: [future, past] })),
		).toEqual({ result: "satisfied", reasons: [] });
		expect(
			run(input(cmp("lt", ms(100)), { observations: [past, future] })),
		).toEqual({ result: "satisfied", reasons: [] });
		// only future observations: still unknown with a reason
		expect(run(input(cmp("lt", ms(100)), { observations: [future] }))).toEqual({
			result: "unknown",
			reasons: ["FUTURE_OBSERVATION"],
		});
	});
	test("a fresh authoritative observation still wins over a stale weaker one", () => {
		const authoritative = obs({
			observationId: "auth",
			value: ms(500),
			priority: 9,
		});
		const weak = obs({
			observationId: "weak",
			value: ms(90),
			priority: 1,
			observedAt: NOW - 1_000_000,
		});
		expect(
			run(input(cmp("lt", ms(100)), { observations: [weak, authoritative] }))
				.result,
		).toBe("violated");
	});
	test("duplicate currentVersions ids are rejected, so order cannot decide", () => {
		const a = [
			{ observationId: "o1", version: "v2" },
			{ observationId: "o1", version: "v1" },
		];
		for (const list of [a, [...a].reverse()])
			expect(
				evaluateConditions(input(cmp(), { currentVersions: list })).ok,
			).toBe(false);
	});
});
