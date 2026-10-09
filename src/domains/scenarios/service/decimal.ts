/**
 * Exact decimal arithmetic on the shortest round-trip decimal form of finite
 * doubles. 0.4 - 0.1 is exactly 0.3 here (not 0.30000000000000004), so the
 * tolerance boundary "delta == tolerance is incomparable" holds for decimals
 * as written by the caller.
 */
export interface Decimal {
	readonly m: bigint;
	readonly e: number;
}

const pattern = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/;

export function toDecimal(value: number): Decimal {
	const match = pattern.exec(value.toString());
	if (!match) throw new RangeError("decimal_requires_finite_number");
	const [, sign, whole, fraction = "", exponent = "0"] = match;
	const m = BigInt(`${whole}${fraction}`);
	return { m: sign === "-" ? -m : m, e: Number(exponent) - fraction.length };
}

function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
	const e = Math.min(a.e, b.e);
	return [a.m * 10n ** BigInt(a.e - e), b.m * 10n ** BigInt(b.e - e), e];
}

export function subtract(a: Decimal, b: Decimal): Decimal {
	const [x, y, e] = align(a, b);
	return { m: x - y, e };
}
export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
	const [x, y] = align(a, b);
	return x < y ? -1 : x > y ? 1 : 0;
}
export const negate = (a: Decimal): Decimal => ({ m: -a.m, e: a.e });
/** Nearest double; Infinity when the magnitude overflows. */
export const toNumber = (a: Decimal): number => Number(`${a.m}e${a.e}`);
