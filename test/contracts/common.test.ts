import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
	canonicalBytes,
	canonicalDigest,
	checkContractVersion,
	checkDigest,
	checkId,
	checkOperationKey,
	checkEpochMs,
	checkFiniteNumber,
	checkPredicate,
	checkRevision,
	checkScope,
	checkTypedValue,
	limits,
	type CanonicalHasher,
} from "../../src/contracts/index.ts";

const sha256: CanonicalHasher = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);

describe("A01 runtime value checks", () => {
	test("contract version: only 1 is accepted", () => {
		expect(checkContractVersion(1).ok).toBe(true);
		expect(code(checkContractVersion(2))).toBe("UNSUPPORTED_CONTRACT_VERSION");
		expect(code(checkContractVersion("1"))).toBe("INVALID_INPUT");
		expect(code(checkContractVersion(1.5))).toBe("INVALID_INPUT");
	});
	test.each([
		[0, "INVALID_INPUT"],
		[1, "ok"],
		[1.5, "INVALID_INPUT"],
		[Number.MAX_SAFE_INTEGER, "ok"],
		[Number.MAX_SAFE_INTEGER + 1, "INVALID_INPUT"],
		[-1, "INVALID_INPUT"],
		["1", "INVALID_INPUT"],
	])("revision %p -> %s", (value, expected) => {
		expect(code(checkRevision(value))).toBe(expected);
	});
	test("typed values reject NaN, Infinity, undefined, missing unit, extras", () => {
		expect(checkTypedValue({ kind: "number", value: 90, unit: "ms" }).ok).toBe(
			true,
		);
		for (const bad of [
			{ kind: "number", value: Number.NaN, unit: "ms" },
			{ kind: "number", value: Number.POSITIVE_INFINITY, unit: "ms" },
			{ kind: "number", value: 1 },
			{ kind: "number", value: 1, unit: "" },
			{ kind: "string", value: undefined },
			{ kind: "string", value: "x", extra: 1 },
			{ kind: "entity", entityId: "" },
			{ kind: "other" },
			null,
			"x",
		])
			expect(checkTypedValue(bad).ok).toBe(false);
	});
	test("IDs: empty rejected, byte (not char) limit, lone surrogate rejected", () => {
		expect(code(checkId(""))).toBe("INVALID_INPUT");
		expect(code(checkId(undefined))).toBe("INVALID_INPUT");
		expect(checkId("あ".repeat(85)).ok).toBe(true); // 255 bytes
		expect(code(checkId("あ".repeat(86)))).toBe("LIMIT_EXCEEDED"); // 258 bytes
		expect(checkId("a".repeat(limits.idBytes)).ok).toBe(true);
		expect(code(checkId("a".repeat(limits.idBytes + 1)))).toBe(
			"LIMIT_EXCEEDED",
		);
		expect(code(checkId("\ud800"))).toBe("INVALID_INPUT");
		expect(code(checkOperationKey("k".repeat(257)))).toBe("LIMIT_EXCEEDED");
	});
	test("scope is strict and not normalized", () => {
		expect(checkScope({ principal: "p-a", scopeKey: "scope-a" }).ok).toBe(true);
		expect(checkScope({ principal: "p-a" }).ok).toBe(false);
		expect(checkScope({ principal: "p-a", scopeKey: "s", extra: 1 }).ok).toBe(
			false,
		);
		const r = checkScope({ principal: "P-A ", scopeKey: "S" });
		expect(r.ok && r.value.principal).toBe("P-A ");
	});
	test("digest format", () => {
		expect(checkDigest(`sha256:${"a".repeat(64)}`).ok).toBe(true);
		expect(checkDigest(`sha256:${"A".repeat(64)}`).ok).toBe(false);
		expect(checkDigest("sha256:abc").ok).toBe(false);
	});
});

describe("A02 canonical bytes", () => {
	test("key order does not matter; array order does", () => {
		const a = canonicalDigest(
			{ a: 1, b: [1, 2], c: { x: "あ", y: null } },
			sha256,
		);
		const b = canonicalDigest(
			{ c: { y: null, x: "あ" }, b: [1, 2], a: 1 },
			sha256,
		);
		const c = canonicalDigest(
			{ a: 1, b: [2, 1], c: { x: "あ", y: null } },
			sha256,
		);
		expect(a).toEqual(b);
		expect(a.ok && c.ok && a.value !== c.value).toBe(true);
	});
	test("known digests", () => {
		const empty = canonicalDigest("", sha256);
		expect(empty.ok && empty.value).toBe(
			`sha256:${sha256(new TextEncoder().encode('""'))}`,
		);
		const ascii = canonicalBytes({ a: 1 });
		expect(ascii.ok && new TextDecoder().decode(ascii.value)).toBe('{"a":1}');
		const jp = canonicalBytes("音声サービス");
		expect(jp.ok && new TextDecoder().decode(jp.value)).toBe('"音声サービス"');
		expect(sha256(new Uint8Array())).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
		expect(sha256(new TextEncoder().encode("abc"))).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});
	test("undefined, NaN, Infinity, sparse arrays, non-plain objects rejected", () => {
		for (const bad of [
			{ a: undefined },
			[undefined],
			Number.NaN,
			{ a: Number.POSITIVE_INFINITY },
			[1, , 3], // eslint-disable-line no-sparse-arrays
			new Map(),
			1n,
			() => 1,
			"\udc00",
		])
			expect(code(canonicalBytes(bad))).toBe("INVALID_INPUT");
	});
	test("limit is measured in bytes at the boundary", () => {
		// '"' + n*'あ'(3 bytes) + '"'
		const fits = "あ".repeat(10);
		expect(canonicalBytes(fits, 32).ok).toBe(true);
		expect(code(canonicalBytes(fits, 31))).toBe("LIMIT_EXCEEDED");
		expect(code(canonicalBytes("x".repeat(limits.payloadBytes)))).toBe(
			"LIMIT_EXCEEDED",
		);
	});
	test("deep nesting is rejected, and a constant hasher is detected as invalid", () => {
		let v: unknown = 1;
		for (let i = 0; i < 100; i++) v = [v];
		expect(code(canonicalBytes(v))).toBe("INVALID_INPUT");
		expect(code(canonicalDigest("x", () => "short"))).toBe("INVALID_INPUT");
	});
});

describe("review fixes: byte boundaries and -0", () => {
	test("typed string: exactly 4KiB passes (bytes, not chars), one more byte fails", () => {
		const exact = checkTypedValue({ kind: "string", value: "a".repeat(4096) });
		expect(exact.ok).toBe(true);
		expect(
			code(checkTypedValue({ kind: "string", value: "a".repeat(4097) })),
		).toBe("LIMIT_EXCEEDED");
		// 1365 * 3 = 4095 bytes fits; 1366 * 3 = 4098 does not
		expect(
			checkTypedValue({ kind: "string", value: "あ".repeat(1365) }).ok,
		).toBe(true);
		expect(
			code(checkTypedValue({ kind: "string", value: "あ".repeat(1366) })),
		).toBe("LIMIT_EXCEEDED");
	});
	test("predicate is limited to 256 UTF-8 bytes", () => {
		expect(checkPredicate("p".repeat(256)).ok).toBe(true);
		expect(code(checkPredicate("p".repeat(257)))).toBe("LIMIT_EXCEEDED");
		expect(checkPredicate("あ".repeat(85)).ok).toBe(true);
		expect(code(checkPredicate("あ".repeat(86)))).toBe("LIMIT_EXCEEDED");
		expect(code(checkPredicate(""))).toBe("INVALID_INPUT");
	});
	test("canonical payload of exactly payloadBytes fits; one byte more does not", () => {
		// a JSON string value costs its length plus two quotes
		const fits = "x".repeat(limits.payloadBytes - 2);
		const r = canonicalBytes(fits);
		expect(r.ok && r.value.length).toBe(limits.payloadBytes);
		expect(code(canonicalBytes(`${fits}x`))).toBe("LIMIT_EXCEEDED");
	});
	test("-0 is canonicalized to 0 by the numeric checks", () => {
		const epoch = checkEpochMs(-0);
		expect(epoch.ok && Object.is(epoch.value, 0)).toBe(true);
		const finite = checkFiniteNumber(-0, "n");
		expect(finite.ok && Object.is(finite.value, 0)).toBe(true);
		const typed = checkTypedValue({ kind: "number", value: -0, unit: "ms" });
		expect(
			typed.ok &&
				typed.value.kind === "number" &&
				Object.is(typed.value.value, 0),
		).toBe(true);
	});
});
