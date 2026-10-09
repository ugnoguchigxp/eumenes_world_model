import {
	asRecord,
	isWellFormed,
	checkId,
	checkOpaque,
	firstUnknownKey,
} from "./ids.ts";
import { limits } from "./limits.ts";
import { fail, ok, type Checked } from "./result.ts";

export function checkSafeInteger(
	value: unknown,
	path: string,
): Checked<number> {
	// -0 is canonicalized to 0 so Object.is / toEqual agree with the canonical bytes.
	return typeof value === "number" && Number.isSafeInteger(value)
		? ok(value === 0 ? 0 : value)
		: fail("INVALID_INPUT", path);
}
/** World-internal revision: safe integer >= 1. */
export function checkRevision(
	value: unknown,
	path = "revision",
): Checked<number> {
	const n = checkSafeInteger(value, path);
	if (!n.ok) return n;
	return n.value >= 1 ? n : fail("INVALID_INPUT", path);
}
/** Caller-supplied UTC epoch ms. Not an ordering for revisions. */
export function checkEpochMs(value: unknown, path = "time"): Checked<number> {
	return checkSafeInteger(value, path);
}
export function checkFiniteNumber(
	value: unknown,
	path: string,
): Checked<number> {
	return typeof value === "number" && Number.isFinite(value)
		? ok(value === 0 ? 0 : value)
		: fail("INVALID_INPUT", path);
}
export function checkBoolean(value: unknown, path: string): Checked<boolean> {
	return typeof value === "boolean" ? ok(value) : fail("INVALID_INPUT", path);
}
/** Source revision is an opaque Memory value; only equality is meaningful. */
export const checkVersionString = (value: unknown, path = "version") =>
	checkOpaque(value, path, limits.versionBytes);
export const checkPredicate = (value: unknown, path = "predicate") =>
	checkOpaque(value, path, limits.predicateBytes);

export type TypedValue =
	| { readonly kind: "string"; readonly value: string }
	| { readonly kind: "boolean"; readonly value: boolean }
	| { readonly kind: "number"; readonly value: number; readonly unit: string }
	| { readonly kind: "entity"; readonly entityId: string };

export function checkTypedValue(
	value: unknown,
	path = "value",
): Checked<TypedValue> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const strict = (keys: readonly string[]) => {
		const extra = firstUnknownKey(object, keys);
		return extra === undefined
			? undefined
			: fail("INVALID_INPUT", `${path}.${extra}`);
	};
	switch (object["kind"]) {
		case "string": {
			const bad = strict(["kind", "value"]);
			if (bad) return bad;
			const v = object["value"];
			if (typeof v !== "string" || !isWellFormed(v))
				return fail("INVALID_INPUT", `${path}.value`);
			const size = new TextEncoder().encode(v).length;
			if (size > limits.stringValueBytes)
				return fail("LIMIT_EXCEEDED", `${path}.value`);
			return ok({ kind: "string", value: v });
		}
		case "boolean": {
			const bad = strict(["kind", "value"]);
			if (bad) return bad;
			const v = checkBoolean(object["value"], `${path}.value`);
			return v.ok ? ok({ kind: "boolean", value: v.value }) : v;
		}
		case "number": {
			const bad = strict(["kind", "value", "unit"]);
			if (bad) return bad;
			const v = checkFiniteNumber(object["value"], `${path}.value`);
			if (!v.ok) return v;
			const unit = checkOpaque(object["unit"], `${path}.unit`, limits.idBytes);
			if (!unit.ok) return unit;
			return ok({ kind: "number", value: v.value, unit: unit.value });
		}
		case "entity": {
			const bad = strict(["kind", "entityId"]);
			if (bad) return bad;
			const id = checkId(object["entityId"], `${path}.entityId`);
			return id.ok ? ok({ kind: "entity", entityId: id.value }) : id;
		}
		default:
			return fail("INVALID_INPUT", `${path}.kind`);
	}
}

const digestPattern = /^sha256:[0-9a-f]{64}$/;
export type Digest = `sha256:${string}`;
export function checkDigest(value: unknown, path = "digest"): Checked<Digest> {
	return typeof value === "string" && digestPattern.test(value)
		? ok(value as Digest)
		: fail("INVALID_INPUT", path);
}
