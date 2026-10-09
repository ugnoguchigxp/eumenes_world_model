import { limits } from "./limits.ts";
import { fail, ok, type Checked } from "./result.ts";

const encoder = new TextEncoder();
/** True when the string has no lone surrogates (ES2022-safe check). */
export function isWellFormed(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const c = value.charCodeAt(i);
		if (c >= 0xd800 && c <= 0xdbff) {
			const d = value.charCodeAt(i + 1);
			if (!(d >= 0xdc00 && d <= 0xdfff)) return false;
			i++;
		} else if (c >= 0xdc00 && c <= 0xdfff) return false;
	}
	return true;
}
/** UTF-8 byte length. Never use character count for budgets. */
export function utf8Length(value: string): number {
	return encoder.encode(value).length;
}

/** Opaque non-empty string within a byte limit. Not normalized or rewritten. */
export function checkOpaque(
	value: unknown,
	path: string,
	maxBytes: number = limits.idBytes,
): Checked<string> {
	if (typeof value !== "string" || value.length === 0)
		return fail("INVALID_INPUT", path);
	if (!isWellFormed(value)) return fail("INVALID_INPUT", path);
	if (utf8Length(value) > maxBytes) return fail("LIMIT_EXCEEDED", path);
	return ok(value);
}

/** Caller-issued opaque ID. World never generates IDs. */
export const checkId = (value: unknown, path = "id") =>
	checkOpaque(value, path, limits.idBytes);
export const checkOperationKey = (value: unknown, path = "operationKey") =>
	checkOpaque(value, path, limits.operationKeyBytes);

export interface ScopeRef {
	readonly principal: string;
	readonly scopeKey: string;
}
export function checkScope(value: unknown, path = "scope"): Checked<ScopeRef> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const unknownKey = firstUnknownKey(object, ["principal", "scopeKey"]);
	if (unknownKey !== undefined)
		return fail("INVALID_INPUT", `${path}.${unknownKey}`);
	const principal = checkId(object["principal"], `${path}.principal`);
	if (!principal.ok) return principal;
	const scopeKey = checkId(object["scopeKey"], `${path}.scopeKey`);
	if (!scopeKey.ok) return scopeKey;
	return ok({ principal: principal.value, scopeKey: scopeKey.value });
}
/** Exact (principal, scopeKey) equality; no normalization. */
export function sameScope(a: ScopeRef, b: ScopeRef): boolean {
	return a.principal === b.principal && a.scopeKey === b.scopeKey;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return undefined;
	const proto = Object.getPrototypeOf(value);
	if (proto !== Object.prototype && proto !== null) return undefined;
	return value as Record<string, unknown>;
}
/** Strict objects: unknown fields are rejected, never dropped. */
export function firstUnknownKey(
	object: Record<string, unknown>,
	allowed: readonly string[],
): string | undefined {
	return Object.keys(object).find((key) => !allowed.includes(key));
}
