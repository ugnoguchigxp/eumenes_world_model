import { limits } from "./limits.ts";
import { fail, ok, type Checked } from "./result.ts";
import type { ByteRange } from "./source.ts";

const encoder = new TextEncoder();

/**
 * Returns the cited UTF-8 bytes of `content` for a half-open byte range
 * [startByte, endByte). Rejects ranges that are empty, out of bounds, or that
 * split a multi-byte character.
 */
export function citedBytes(
	content: string,
	range: ByteRange,
	path = "range",
): Checked<Uint8Array> {
	const { startByte, endByte } = range;
	if (
		!Number.isSafeInteger(startByte) ||
		!Number.isSafeInteger(endByte) ||
		startByte < 0 ||
		startByte >= endByte
	)
		return fail("INVALID_INPUT", path);
	const bytes = encoder.encode(content);
	if (endByte > bytes.length) return fail("INVALID_INPUT", path);
	if (endByte - startByte > limits.payloadBytes)
		return fail("LIMIT_EXCEEDED", path);
	const isBoundary = (i: number) =>
		i === 0 || i === bytes.length || (bytes[i]! & 0xc0) !== 0x80;
	if (!isBoundary(startByte) || !isBoundary(endByte))
		return fail("INVALID_INPUT", path);
	return ok(bytes.slice(startByte, endByte));
}
