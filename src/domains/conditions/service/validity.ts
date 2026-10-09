import {
	asRecord,
	checkContractVersion,
	checkEpochMs,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
	type WorldContractVersion,
} from "../../../contracts/index.ts";
import type { Tri } from "../contracts/condition.ts";
import {
	checkValidTime,
	type TimeBound,
	type ValidityReason,
	type ValidTime,
} from "../contracts/time.ts";

export interface CompareValidityInput {
	readonly contractVersion: WorldContractVersion;
	readonly validTime: ValidTime;
	readonly asOf: number;
}
export interface ValidityResult {
	readonly result: Tri;
	readonly reason: ValidityReason;
}

type Passed = "yes" | "no" | "unknown";
/** Has the boundary instant (somewhere in [earliest, latest)) passed asOf? */
function passed(bound: TimeBound, asOf: number): Passed {
	if (asOf >= bound.latest) return "yes";
	if (asOf < bound.earliest) return "no";
	return "unknown";
}

/** Already-validated inputs. A boundary whose precision cannot decide is unknown. */
export function validityAt(validTime: ValidTime, asOf: number): ValidityResult {
	if (validTime.kind === "instant") {
		return validTime.at === asOf
			? { result: "satisfied", reason: "INSTANT_MATCH" }
			: { result: "violated", reason: "INSTANT_MISMATCH" };
	}
	const started = validTime.start ? passed(validTime.start, asOf) : "yes";
	const ended = validTime.end ? passed(validTime.end, asOf) : "no";
	if (started === "no") return { result: "violated", reason: "NOT_STARTED" };
	if (ended === "yes") return { result: "violated", reason: "ENDED" };
	if (started === "yes" && ended === "no")
		return { result: "satisfied", reason: "IN_PERIOD" };
	return { result: "unknown", reason: "PRECISION_INSUFFICIENT" };
}

/** Is the claim/observation valid at asOf? Strict validation from unknown. */
export function compareValidity(input: unknown): Checked<ValidityResult> {
	const object = asRecord(input);
	if (!object) return fail("INVALID_INPUT", "input");
	const extra = firstUnknownKey(object, [
		"contractVersion",
		"validTime",
		"asOf",
	]);
	if (extra !== undefined) return fail("INVALID_INPUT", `input.${extra}`);
	const version = checkContractVersion(object["contractVersion"]);
	if (!version.ok) return version;
	const asOf = checkEpochMs(object["asOf"], "asOf");
	if (!asOf.ok) return asOf;
	const validTime = checkValidTime(object["validTime"]);
	if (!validTime.ok) return validTime;
	return ok(validityAt(validTime.value, asOf.value));
}
