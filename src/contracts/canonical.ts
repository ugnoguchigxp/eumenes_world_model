import { limits } from "./limits.ts";
import { fail, ok, type Checked } from "./result.ts";
import { asRecord, isWellFormed } from "./ids.ts";
import type { Digest } from "./values.ts";

/** Injected synchronous hash: bytes -> 64 lowercase hex chars of SHA-256. */
export type CanonicalHasher = (bytes: Uint8Array) => string;

const encoder = new TextEncoder();

function write(value: unknown, depth: number): string | undefined {
	if (depth > limits.canonicalDepth) return undefined;
	if (value === null) return "null";
	switch (typeof value) {
		case "string":
			return isWellFormed(value) ? JSON.stringify(value) : undefined;
		case "boolean":
			return value ? "true" : "false";
		case "number":
			return Number.isFinite(value) ? JSON.stringify(value) : undefined;
		case "object": {
			if (Array.isArray(value)) {
				const parts: string[] = [];
				for (let i = 0; i < value.length; i++) {
					if (!(i in value)) return undefined;
					const part = write(value[i], depth + 1);
					if (part === undefined) return undefined;
					parts.push(part);
				}
				return `[${parts.join(",")}]`;
			}
			const object = asRecord(value);
			if (!object) return undefined;
			const parts: string[] = [];
			for (const key of Object.keys(object).sort()) {
				const part = write(object[key], depth + 1);
				if (part === undefined) return undefined;
				parts.push(`${JSON.stringify(key)}:${part}`);
			}
			return `{${parts.join(",")}}`;
		}
		default:
			// undefined, bigint, symbol, function
			return undefined;
	}
}

/**
 * Canonical UTF-8 bytes: object keys ascending (code unit order), array order
 * preserved (callers sort sets), finite JSON only. Undefined is rejected, not
 * dropped.
 */
export function canonicalBytes(
	value: unknown,
	maxBytes: number = limits.payloadBytes,
): Checked<Uint8Array> {
	const text = write(value, 0);
	if (text === undefined) return fail("INVALID_INPUT", "canonical");
	const bytes = encoder.encode(text);
	if (bytes.length > maxBytes) return fail("LIMIT_EXCEEDED", "canonical");
	return ok(bytes);
}

export function canonicalDigest(
	value: unknown,
	hasher: CanonicalHasher,
	maxBytes?: number,
): Checked<Digest> {
	const bytes = canonicalBytes(value, maxBytes);
	if (!bytes.ok) return bytes;
	const hex = hasher(bytes.value);
	if (!/^[0-9a-f]{64}$/.test(hex)) return fail("INVALID_INPUT", "hasher");
	return ok(`sha256:${hex}` as Digest);
}
