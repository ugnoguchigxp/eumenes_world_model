import {
	asRecord,
	checkContractVersion,
	checkScope,
	firstUnknownKey,
	sameScope,
} from "../../contracts/index.ts";
import { sourceIdentityKey } from "../../domains/assertions/index.ts";
import { getAssertion, getHead } from "../../domains/assertions/sqlite.ts";
import { getTombstone, isGateOpen } from "../../domains/lifecycle/sqlite.ts";
import {
	checkSliceReceipt,
	validateSliceUsage,
	type UsageResult,
} from "../../domains/projection/index.ts";
import { getEpoch } from "../../domains/projection/sqlite.ts";
import {
	requireTransaction,
	type WorldDb,
} from "../../infrastructure/sqlite/db.ts";
import {
	blockedResult,
	checkAccess,
	checkHostChecks,
	rejectedResult,
} from "./checks.ts";
import { WORLD_INTERPRETATION_VERSION } from "./types.ts";

export type WorldUsageResult =
	| UsageResult
	| { readonly status: "rejected"; readonly reasonCode: string };

/**
 * Pre-adoption re-validation on the writer: assertion lifecycle/version from
 * the ledger, the Scope epoch from the projection table, and the host's
 * policy / forget / restore / source facts. Matching IDs alone never passes.
 * The result carries a reason code only, never content.
 */
export function validateWorldUsage(
	db: WorldDb,
	rawReceipt: unknown,
	rawCurrent: unknown,
): WorldUsageResult {
	requireTransaction(db);
	const receipt = checkSliceReceipt(rawReceipt);
	if (!receipt.ok) return rejectedResult("INVALID_INPUT");
	const current = asRecord(rawCurrent);
	if (
		!current ||
		firstUnknownKey(current, [
			"contractVersion",
			"access",
			"scope",
			"hostChecks",
		]) !== undefined
	)
		return rejectedResult("INVALID_INPUT");
	const version = checkContractVersion(current["contractVersion"]);
	const scope = checkScope(current["scope"]);
	const host = checkHostChecks(current["hostChecks"]);
	if (!version.ok || !scope.ok || !host.ok)
		return rejectedResult("INVALID_INPUT");
	const r = receipt.value;
	// A different Scope than the receipt's: indistinguishable denial.
	if (!sameScope(scope.value, { principal: r.principal, scopeKey: r.scopeKey }))
		return blockedResult("ACCESS_DENIED") as WorldUsageResult;
	const access = checkAccess(
		current["access"],
		scope.value,
		host.value.policyRevision,
	);
	if (access === "INVALID_INPUT") return rejectedResult("INVALID_INPUT");
	if (access === "SCOPE_NOT_PERMITTED")
		return blockedResult("ACCESS_DENIED") as WorldUsageResult;
	if (access === "POLICY_CHANGED")
		return blockedResult("POLICY_CHANGED") as WorldUsageResult;
	const worldEnabled =
		host.value.gate !== "closed" && isGateOpen(db, scope.value);
	const result = validateSliceUsage({
		contractVersion: 1,
		receipt: rawReceipt,
		current: {
			scope: scope.value,
			authorized: true,
			worldEnabled,
			scopeEpoch: getEpoch(db, scope.value)?.epoch ?? 0,
			policyRevision: host.value.policyRevision,
			forgetEpoch: host.value.forgetEpoch,
			restoreEpoch: host.value.restoreEpoch,
			interpretationVersion: WORLD_INTERPRETATION_VERSION,
			assertions: r.assertionVersions.flatMap((used) => {
				// A tombstoned or superseded-by-newer-head version is "gone": it is
				// left out so the pure check answers ASSERTION_CHANGED.
				if (
					getTombstone(db, scope.value, { kind: "assertion", id: used.id }) !==
						undefined ||
					getHead(db, scope.value, used.id)?.currentRevision !== used.revision
				)
					return [];
				const stored = getAssertion(db, scope.value, used.id, used.revision);
				return stored
					? [
							{
								id: stored.id,
								revision: stored.revision,
								lifecycle: stored.lifecycle,
							},
						]
					: [];
			}),
			// Only same-Scope states that are not tombstoned count as current.
			sources: host.value.sourceSnapshot.states.filter(
				(state) =>
					sameScope(
						{ principal: state.principal, scopeKey: state.scopeKey },
						scope.value,
					) &&
					getTombstone(db, scope.value, {
						kind: "source",
						id: sourceIdentityKey(state),
					}) === undefined &&
					getTombstone(db, scope.value, {
						kind: "state",
						id: sourceIdentityKey(state),
					}) === undefined,
			),
		},
	});
	if (!result.ok) return rejectedResult("INVALID_INPUT");
	return result.value;
}
