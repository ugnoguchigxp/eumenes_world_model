import { fail, ok, type Checked } from "./result.ts";

/** First World contract version. Unknown versions are rejected. */
export const WORLD_CONTRACT_VERSION = 1;
export type WorldContractVersion = typeof WORLD_CONTRACT_VERSION;
/** Version of the canonical byte encoding used for digests. */
export const CANONICAL_VERSION = 1;

export function checkContractVersion(
	value: unknown,
	path = "contractVersion",
): Checked<WorldContractVersion> {
	if (typeof value !== "number" || !Number.isSafeInteger(value))
		return fail("INVALID_INPUT", path);
	if (value !== WORLD_CONTRACT_VERSION)
		return fail("UNSUPPORTED_CONTRACT_VERSION", path);
	return ok(WORLD_CONTRACT_VERSION);
}
