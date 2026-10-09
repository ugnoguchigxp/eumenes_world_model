import { ok, type Checked, type TypedValue } from "../../../contracts/index.ts";
import {
	checkEvaluateConditionsInput,
	type CompareOp,
	type Condition,
	type EvaluationReason,
	type EvaluationResult,
	type Observation,
	type Tri,
} from "../contracts/condition.ts";
import { validityAt } from "./validity.ts";

interface Outcome {
	readonly result: Tri;
	readonly reasons: ReadonlySet<EvaluationReason>;
}
const decisive = (result: Tri): Outcome => ({ result, reasons: new Set() });
const unknown = (...reasons: EvaluationReason[]): Outcome => ({
	result: "unknown",
	reasons: new Set(reasons),
});

const isTri = (value: unknown): value is Tri =>
	value === "satisfied" || value === "violated" || value === "unknown";

/**
 * Three-valued operators. A value outside Tri (possible from untyped callers)
 * fails closed: it is treated as unknown and never as satisfied.
 */
export function not3(value: Tri): Tri {
	if (!isTri(value)) return "unknown";
	return value === "satisfied"
		? "violated"
		: value === "violated"
			? "satisfied"
			: "unknown";
}
/** Any violated -> violated; else any unknown -> unknown. Empty is unknown. */
export function and3(values: readonly Tri[]): Tri {
	if (!Array.isArray(values) || values.length === 0) return "unknown";
	if (values.includes("violated")) return "violated";
	return values.every((v) => v === "satisfied") ? "satisfied" : "unknown";
}
/** Any satisfied -> satisfied; else any unknown -> unknown. Empty is unknown. */
export function or3(values: readonly Tri[]): Tri {
	if (!Array.isArray(values) || values.length === 0) return "unknown";
	if (values.includes("satisfied")) return "satisfied";
	return values.every((v) => v === "violated") ? "violated" : "unknown";
}

function merge(outcomes: readonly Outcome[]): Set<EvaluationReason> {
	const reasons = new Set<EvaluationReason>();
	for (const outcome of outcomes)
		for (const r of outcome.reasons) reasons.add(r);
	return reasons;
}

function sameValue(a: TypedValue, b: TypedValue): boolean {
	if (a.kind !== b.kind) return false;
	switch (a.kind) {
		case "number":
			return b.kind === "number" && a.value === b.value && a.unit === b.unit;
		case "entity":
			return b.kind === "entity" && a.entityId === b.entityId;
		default:
			return a.kind === b.kind && "value" in b && a.value === b.value;
	}
}

function compareValues(
	op: CompareOp,
	actual: TypedValue,
	expected: TypedValue,
): Outcome {
	if (actual.kind !== expected.kind) return unknown("TYPE_MISMATCH");
	if (actual.kind === "number" && expected.kind === "number") {
		// Only the same explicit unit is comparable; no conversion is guessed.
		if (actual.unit !== expected.unit) return unknown("UNIT_MISMATCH");
		const a = actual.value;
		const b = expected.value;
		const holds =
			op === "eq"
				? a === b
				: op === "ne"
					? a !== b
					: op === "lt"
						? a < b
						: op === "lte"
							? a <= b
							: op === "gt"
								? a > b
								: a >= b;
		return decisive(holds ? "satisfied" : "violated");
	}
	const equal = sameValue(actual, expected);
	return decisive(
		op === "eq"
			? equal
				? "satisfied"
				: "violated"
			: equal
				? "violated"
				: "satisfied",
	);
}

interface Context {
	readonly asOf: number;
	readonly maxAgeMs: number;
	readonly observations: readonly Observation[];
	readonly versions: ReadonlyMap<string, string> | undefined;
}

function evalCompare(
	node: Extract<Condition, { kind: "compare" }>,
	ctx: Context,
): Outcome {
	const allOfKey = ctx.observations.filter((o) => o.key === node.key);
	if (allOfKey.length === 0) return unknown("NO_OBSERVATION");
	// An observation made after asOf does not exist yet at asOf (C5): it never
	// takes part in the selection, so a backdated query still sees the past.
	const sameKey = allOfKey.filter((o) => o.observedAt <= ctx.asOf);
	if (sameKey.length === 0) return unknown("FUTURE_OBSERVATION");
	// Priority decides next, over every observation that existed at asOf: a
	// stale, outdated or invalid authoritative observation must not let a
	// weaker one answer in its place (it makes the result unknown instead).
	const top = Math.max(...sameKey.map((o) => o.priority));
	const topGroup = sameKey.filter((o) => o.priority === top);
	const excluded = new Set<EvaluationReason>();
	const group: Observation[] = [];
	for (const o of topGroup) {
		if (ctx.versions && ctx.versions.get(o.observationId) !== o.version) {
			excluded.add("VERSION_MISMATCH");
		} else if (ctx.asOf - o.observedAt > ctx.maxAgeMs) {
			excluded.add("STALE_OBSERVATION");
		} else {
			const validity = o.validTime
				? validityAt(o.validTime, ctx.asOf)
				: undefined;
			if (validity?.result === "violated")
				excluded.add("OBSERVATION_NOT_VALID");
			else if (validity?.result === "unknown")
				excluded.add("OBSERVATION_VALIDITY_UNKNOWN");
			else group.push(o);
		}
	}
	if (group.length === 0) return { result: "unknown", reasons: excluded };
	const first = group[0]!;
	// Same key, overlapping time (all usable hold at asOf), same priority.
	if (group.some((o) => !sameValue(o.value, first.value))) {
		const kindsDiffer = group.some((o) => o.value.kind !== first.value.kind);
		if (kindsDiffer) return unknown("TYPE_MISMATCH");
		const units = group.some(
			(o) =>
				o.value.kind === "number" &&
				first.value.kind === "number" &&
				o.value.unit !== first.value.unit,
		);
		return unknown(units ? "UNIT_MISMATCH" : "CONFLICTING_OBSERVATIONS");
	}
	return compareValues(node.op, first.value, node.value);
}

function evalCondition(node: Condition, ctx: Context): Outcome {
	switch (node.kind) {
		case "compare":
			return evalCompare(node, ctx);
		case "unsupported":
			return unknown("UNSUPPORTED_CONDITION");
		case "not": {
			const inner = evalCondition(node.item, ctx);
			return { result: not3(inner.result), reasons: inner.reasons };
		}
		case "all":
		case "any": {
			if (node.items.length === 0) return unknown("EMPTY_GROUP");
			// Every child is evaluated so reason codes do not depend on short-circuiting.
			const outcomes = node.items.map((item) => evalCondition(item, ctx));
			const values = outcomes.map((o) => o.result);
			const result = node.kind === "all" ? and3(values) : or3(values);
			return result === "unknown"
				? { result, reasons: merge(outcomes) }
				: decisive(result);
		}
	}
}

const finish = (outcome: Outcome): EvaluationResult => ({
	result: outcome.result,
	reasons: [...outcome.reasons].sort(),
});

/**
 * Evaluates a condition against versioned observations at asOf. Authorization
 * and the claim's validTime are always checked, even for an explicitly
 * unconditional claim.
 */
export function evaluateConditions(input: unknown): Checked<EvaluationResult> {
	const parsed = checkEvaluateConditionsInput(input);
	if (!parsed.ok) return parsed;
	const value = parsed.value;
	// An unauthorized caller learns nothing beyond "unknown".
	if (!value.authorized) return ok(finish(unknown("NOT_AUTHORIZED")));
	const claimValidity = value.validTime
		? validityAt(value.validTime, value.asOf)
		: undefined;
	if (claimValidity?.result === "violated")
		return ok(finish(decisiveWith("violated", "CLAIM_NOT_VALID")));
	const spec = value.condition;
	let condition: Outcome;
	if (spec.kind === "unspecified") condition = unknown("UNSPECIFIED_CONDITION");
	else if (spec.kind === "explicitly_unconditional")
		condition = decisive("satisfied");
	else
		condition = evalCondition(spec.expression, {
			asOf: value.asOf,
			maxAgeMs: value.maxAgeMs,
			observations: value.observations,
			versions: value.currentVersions
				? new Map(
						value.currentVersions.map((v) => [v.observationId, v.version]),
					)
				: undefined,
		});
	if (claimValidity?.result === "unknown") {
		const result = and3(["unknown", condition.result]);
		const reasons = new Set(condition.reasons);
		reasons.add("CLAIM_VALIDITY_UNKNOWN");
		return ok(
			finish({ result, reasons: result === "violated" ? new Set() : reasons }),
		);
	}
	return ok(finish(condition));
}

function decisiveWith(result: Tri, reason: EvaluationReason): Outcome {
	return { result, reasons: new Set([reason]) };
}
