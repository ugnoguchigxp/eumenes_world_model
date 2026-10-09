import {
	asRecord,
	checkEpochMs,
	checkOpaque,
	fail,
	firstUnknownKey,
	limits,
	ok,
	type Checked,
} from "../../../contracts/index.ts";

/**
 * Precision of a period boundary as written by the source. The pure layer does
 * no calendar math: the host supplies the instant interval each boundary can
 * fall in, so "from September" is never rewritten to a fabricated day.
 */
export const validPrecisions = ["exact", "day", "month", "year"] as const;
export type ValidPrecision = (typeof validPrecisions)[number];

/** The boundary instant lies in [earliest, latest). Exact: earliest===latest. */
export interface TimeBound {
	readonly earliest: number;
	readonly latest: number;
}

/**
 * Valid time: an exact instant, or a period [start, end) with precision.
 *
 * Semantic choice (kept deliberately): an `instant` validTime holds only AT
 * that exact instant. Evaluated at any other asOf it is `violated`
 * (CLAIM_NOT_VALID), not "not applicable". A claim like "X was true at T" that
 * should stay usable later must be expressed as a period, or the host must
 * not attach a validTime to it.
 */
export type ValidTime =
	| { readonly kind: "instant"; readonly at: number }
	| {
			readonly kind: "period";
			readonly precision: ValidPrecision;
			/** Original expression, kept verbatim (e.g. 「9月から」). */
			readonly original: string;
			readonly start?: TimeBound;
			readonly end?: TimeBound;
	  };

export const validityReasons = [
	"INSTANT_MATCH",
	"INSTANT_MISMATCH",
	"IN_PERIOD",
	"NOT_STARTED",
	"ENDED",
	"PRECISION_INSUFFICIENT",
] as const;
export type ValidityReason = (typeof validityReasons)[number];

function checkBound(
	value: unknown,
	precision: ValidPrecision,
	path: string,
): Checked<TimeBound> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const extra = firstUnknownKey(object, ["earliest", "latest"]);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const earliest = checkEpochMs(object["earliest"], `${path}.earliest`);
	if (!earliest.ok) return earliest;
	const latest = checkEpochMs(object["latest"], `${path}.latest`);
	if (!latest.ok) return latest;
	const consistent =
		precision === "exact"
			? earliest.value === latest.value
			: earliest.value < latest.value;
	if (!consistent) return fail("INVALID_INPUT", path);
	return ok({ earliest: earliest.value, latest: latest.value });
}

export function checkValidTime(
	value: unknown,
	path = "validTime",
): Checked<ValidTime> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	if (object["kind"] === "instant") {
		const extra = firstUnknownKey(object, ["kind", "at"]);
		if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
		const at = checkEpochMs(object["at"], `${path}.at`);
		return at.ok ? ok({ kind: "instant", at: at.value }) : at;
	}
	if (object["kind"] !== "period") return fail("INVALID_INPUT", `${path}.kind`);
	const extra = firstUnknownKey(object, [
		"kind",
		"precision",
		"original",
		"start",
		"end",
	]);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const precision = object["precision"];
	if (!validPrecisions.includes(precision as ValidPrecision))
		return fail("INVALID_INPUT", `${path}.precision`);
	const original = checkOpaque(
		object["original"],
		`${path}.original`,
		limits.stringValueBytes,
	);
	if (!original.ok) return original;
	const hasStart = object["start"] !== undefined;
	const hasEnd = object["end"] !== undefined;
	if (!hasStart && !hasEnd) return fail("INVALID_INPUT", path);
	const start = hasStart
		? checkBound(object["start"], precision as ValidPrecision, `${path}.start`)
		: undefined;
	if (start && !start.ok) return start;
	const end = hasEnd
		? checkBound(object["end"], precision as ValidPrecision, `${path}.end`)
		: undefined;
	if (end && !end.ok) return end;
	if (start?.ok && end?.ok && start.value.earliest >= end.value.latest)
		return fail("INVALID_INPUT", path);
	return ok({
		kind: "period",
		precision: precision as ValidPrecision,
		original: original.value,
		...(start?.ok ? { start: start.value } : {}),
		...(end?.ok ? { end: end.value } : {}),
	});
}
