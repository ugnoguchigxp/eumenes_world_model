import {
	asRecord,
	checkBoolean,
	checkContractVersion,
	checkEpochMs,
	checkId,
	checkSafeInteger,
	checkTypedValue,
	checkVersionString,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
	type TypedValue,
	type WorldContractVersion,
} from "../../../contracts/index.ts";
import { checkValidTime, type ValidTime } from "./time.ts";

/** Three-valued truth. Unknown is never promoted to satisfied. */
export type Tri = "satisfied" | "violated" | "unknown";

export const maxConditionDepth = 8;
export const maxConditionNodes = 64;
export const maxObservations = 500;

export const compareOps = ["eq", "ne", "lt", "lte", "gt", "gte"] as const;
export type CompareOp = (typeof compareOps)[number];

export type Condition =
	| {
			readonly kind: "compare";
			readonly key: string;
			readonly op: CompareOp;
			readonly value: TypedValue;
	  }
	| { readonly kind: "all"; readonly items: readonly Condition[] }
	| { readonly kind: "any"; readonly items: readonly Condition[] }
	| { readonly kind: "not"; readonly item: Condition }
	| { readonly kind: "unsupported" };

/**
 * Top-level condition. unspecified (or an absent field) is unknown, never an
 * automatic true; explicitly_unconditional needs an adoption-evidence ID.
 */
export type ConditionSpec =
	| { readonly kind: "unspecified" }
	| {
			readonly kind: "explicitly_unconditional";
			readonly adoptionEvidenceId: string;
	  }
	| { readonly kind: "expression"; readonly expression: Condition };

/** A versioned observation supplied by the host. */
export interface Observation {
	readonly observationId: string;
	/** Observation key: same key means the same measured quantity. */
	readonly key: string;
	readonly value: TypedValue;
	readonly observedAt: number;
	readonly version: string;
	/** Higher wins; equal priority with differing values is a contradiction. */
	readonly priority: number;
	readonly validTime?: ValidTime;
}

export interface ObservationVersion {
	readonly observationId: string;
	readonly version: string;
}

export interface EvaluateConditionsInput {
	readonly contractVersion: WorldContractVersion;
	readonly asOf: number;
	/** Host-verified authorization. false yields unknown without detail. */
	readonly authorized: boolean;
	/** Observations older than this (asOf - observedAt) are stale. */
	readonly maxAgeMs: number;
	readonly condition: ConditionSpec;
	/** Validity of the claim carrying the condition; never skipped. */
	readonly validTime?: ValidTime;
	readonly observations: readonly Observation[];
	/**
	 * Current version per observation from the host's writer snapshot. When
	 * given, an observation with a different or missing entry is unusable.
	 */
	readonly currentVersions?: readonly ObservationVersion[];
}

export const evaluationReasons = [
	"NOT_AUTHORIZED",
	"CLAIM_NOT_VALID",
	"CLAIM_VALIDITY_UNKNOWN",
	"UNSPECIFIED_CONDITION",
	"EMPTY_GROUP",
	"UNSUPPORTED_CONDITION",
	"NO_OBSERVATION",
	"FUTURE_OBSERVATION",
	"STALE_OBSERVATION",
	"VERSION_MISMATCH",
	"OBSERVATION_NOT_VALID",
	"OBSERVATION_VALIDITY_UNKNOWN",
	"UNIT_MISMATCH",
	"TYPE_MISMATCH",
	"CONFLICTING_OBSERVATIONS",
] as const;
export type EvaluationReason = (typeof evaluationReasons)[number];

export interface EvaluationResult {
	readonly result: Tri;
	/** Unique, sorted reason codes. Empty when the result is decisive. */
	readonly reasons: readonly EvaluationReason[];
}

function strict(
	object: Record<string, unknown>,
	keys: readonly string[],
	path: string,
) {
	const extra = firstUnknownKey(object, keys);
	return extra === undefined
		? undefined
		: fail("INVALID_INPUT", `${path}.${extra}`);
}

export function checkCondition(
	value: unknown,
	path = "condition",
): Checked<Condition> {
	let nodes = 0;
	function visit(node: unknown, depth: number, at: string): Checked<Condition> {
		if (++nodes > maxConditionNodes) return fail("LIMIT_EXCEEDED", at);
		if (depth > maxConditionDepth) return fail("LIMIT_EXCEEDED", at);
		const object = asRecord(node);
		if (!object) return fail("INVALID_INPUT", at);
		switch (object["kind"]) {
			case "compare": {
				const bad = strict(object, ["kind", "key", "op", "value"], at);
				if (bad) return bad;
				const key = checkId(object["key"], `${at}.key`);
				if (!key.ok) return key;
				const op = object["op"];
				if (!compareOps.includes(op as CompareOp))
					return fail("INVALID_INPUT", `${at}.op`);
				const typed = checkTypedValue(object["value"], `${at}.value`);
				if (!typed.ok) return typed;
				if (op !== "eq" && op !== "ne" && typed.value.kind !== "number")
					return fail("INVALID_INPUT", `${at}.op`);
				return ok({
					kind: "compare",
					key: key.value,
					op: op as CompareOp,
					value: typed.value,
				});
			}
			case "all":
			case "any": {
				const bad = strict(object, ["kind", "items"], at);
				if (bad) return bad;
				const items = object["items"];
				if (!Array.isArray(items)) return fail("INVALID_INPUT", `${at}.items`);
				const parsed: Condition[] = [];
				for (let i = 0; i < items.length; i++) {
					if (!(i in items)) return fail("INVALID_INPUT", `${at}.items`);
					const child = visit(items[i], depth + 1, `${at}.items[${i}]`);
					if (!child.ok) return child;
					parsed.push(child.value);
				}
				return ok({ kind: object["kind"], items: parsed });
			}
			case "not": {
				const bad = strict(object, ["kind", "item"], at);
				if (bad) return bad;
				const child = visit(object["item"], depth + 1, `${at}.item`);
				return child.ok ? ok({ kind: "not", item: child.value }) : child;
			}
			case "unsupported": {
				const bad = strict(object, ["kind"], at);
				return bad ?? ok({ kind: "unsupported" });
			}
			default:
				return fail("INVALID_INPUT", `${at}.kind`);
		}
	}
	return visit(value, 1, path);
}

export function checkConditionSpec(
	value: unknown,
	path = "condition",
): Checked<ConditionSpec> {
	if (value === undefined) return ok({ kind: "unspecified" });
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	switch (object["kind"]) {
		case "unspecified": {
			const bad = strict(object, ["kind"], path);
			return bad ?? ok({ kind: "unspecified" });
		}
		case "explicitly_unconditional": {
			const bad = strict(object, ["kind", "adoptionEvidenceId"], path);
			if (bad) return bad;
			const id = checkId(
				object["adoptionEvidenceId"],
				`${path}.adoptionEvidenceId`,
			);
			return id.ok
				? ok({ kind: "explicitly_unconditional", adoptionEvidenceId: id.value })
				: id;
		}
		case "expression": {
			const bad = strict(object, ["kind", "expression"], path);
			if (bad) return bad;
			const expression = checkCondition(
				object["expression"],
				`${path}.expression`,
			);
			return expression.ok
				? ok({ kind: "expression", expression: expression.value })
				: expression;
		}
		default:
			return fail("INVALID_INPUT", `${path}.kind`);
	}
}

export function checkObservation(
	value: unknown,
	path: string,
): Checked<Observation> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const bad = strict(
		object,
		[
			"observationId",
			"key",
			"value",
			"observedAt",
			"version",
			"priority",
			"validTime",
		],
		path,
	);
	if (bad) return bad;
	const observationId = checkId(
		object["observationId"],
		`${path}.observationId`,
	);
	if (!observationId.ok) return observationId;
	const key = checkId(object["key"], `${path}.key`);
	if (!key.ok) return key;
	const typed = checkTypedValue(object["value"], `${path}.value`);
	if (!typed.ok) return typed;
	const observedAt = checkEpochMs(object["observedAt"], `${path}.observedAt`);
	if (!observedAt.ok) return observedAt;
	const version = checkVersionString(object["version"], `${path}.version`);
	if (!version.ok) return version;
	const priority = checkSafeInteger(object["priority"], `${path}.priority`);
	if (!priority.ok) return priority;
	if (priority.value < 0) return fail("INVALID_INPUT", `${path}.priority`);
	const validTime =
		object["validTime"] === undefined
			? undefined
			: checkValidTime(object["validTime"], `${path}.validTime`);
	if (validTime && !validTime.ok) return validTime;
	return ok({
		observationId: observationId.value,
		key: key.value,
		value: typed.value,
		observedAt: observedAt.value,
		version: version.value,
		priority: priority.value,
		...(validTime?.ok ? { validTime: validTime.value } : {}),
	});
}

export function checkEvaluateConditionsInput(
	value: unknown,
): Checked<EvaluateConditionsInput> {
	const path = "input";
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const bad = strict(
		object,
		[
			"contractVersion",
			"asOf",
			"authorized",
			"maxAgeMs",
			"condition",
			"validTime",
			"observations",
			"currentVersions",
		],
		path,
	);
	if (bad) return bad;
	const version = checkContractVersion(object["contractVersion"]);
	if (!version.ok) return version;
	const asOf = checkEpochMs(object["asOf"], "asOf");
	if (!asOf.ok) return asOf;
	const authorized = checkBoolean(object["authorized"], "authorized");
	if (!authorized.ok) return authorized;
	const maxAgeMs = checkSafeInteger(object["maxAgeMs"], "maxAgeMs");
	if (!maxAgeMs.ok) return maxAgeMs;
	if (maxAgeMs.value < 0) return fail("INVALID_INPUT", "maxAgeMs");
	const condition = checkConditionSpec(object["condition"]);
	if (!condition.ok) return condition;
	const validTime =
		object["validTime"] === undefined
			? undefined
			: checkValidTime(object["validTime"]);
	if (validTime && !validTime.ok) return validTime;
	const rawObservations = object["observations"];
	if (!Array.isArray(rawObservations))
		return fail("INVALID_INPUT", "observations");
	if (rawObservations.length > maxObservations)
		return fail("LIMIT_EXCEEDED", "observations");
	const observations: Observation[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < rawObservations.length; i++) {
		if (!(i in rawObservations)) return fail("INVALID_INPUT", "observations");
		const parsed = checkObservation(rawObservations[i], `observations[${i}]`);
		if (!parsed.ok) return parsed;
		if (seen.has(parsed.value.observationId))
			return fail("INVALID_INPUT", `observations[${i}].observationId`);
		seen.add(parsed.value.observationId);
		observations.push(parsed.value);
	}
	let currentVersions: ObservationVersion[] | undefined;
	if (object["currentVersions"] !== undefined) {
		const raw = object["currentVersions"];
		if (!Array.isArray(raw)) return fail("INVALID_INPUT", "currentVersions");
		if (raw.length > maxObservations)
			return fail("LIMIT_EXCEEDED", "currentVersions");
		currentVersions = [];
		const seenVersionIds = new Set<string>();
		for (let i = 0; i < raw.length; i++) {
			if (!(i in raw)) return fail("INVALID_INPUT", "currentVersions");
			const entry = asRecord(raw[i]);
			const at = `currentVersions[${i}]`;
			if (!entry) return fail("INVALID_INPUT", at);
			const extra = strict(entry, ["observationId", "version"], at);
			if (extra) return extra;
			const id = checkId(entry["observationId"], `${at}.observationId`);
			if (!id.ok) return id;
			const v = checkVersionString(entry["version"], `${at}.version`);
			if (!v.ok) return v;
			// Duplicates would make the answer depend on array order.
			if (seenVersionIds.has(id.value))
				return fail("INVALID_INPUT", `${at}.observationId`);
			seenVersionIds.add(id.value);
			currentVersions.push({ observationId: id.value, version: v.value });
		}
	}
	return ok({
		contractVersion: version.value,
		asOf: asOf.value,
		authorized: authorized.value,
		maxAgeMs: maxAgeMs.value,
		condition: condition.value,
		observations,
		...(validTime?.ok ? { validTime: validTime.value } : {}),
		...(currentVersions ? { currentVersions } : {}),
	});
}
