import {
	asRecord,
	checkContractVersion,
	fail,
	firstUnknownKey,
	ok,
	sameScope,
	type Checked,
} from "../../../contracts/index.ts";
import { sourceIdentityKey } from "../../assertions/index.ts";
import {
	checkSliceReceipt,
	checkUsageCurrent,
	type UsageBlockCode,
	type UsageResult,
} from "../contracts/slice.ts";
import { indexStates, sourceIsCurrent } from "./project.ts";

const blocked = (reasonCode: UsageBlockCode): Checked<UsageResult> =>
	ok({ status: "blocked", reasonCode });

/**
 * Pure re-validation of a Slice receipt against current writer facts for the
 * same Scope. Matching IDs is not enough: scope epoch, policy, forget/restore
 * epoch, interpretation, assertion lifecycle and source versions must all be
 * unchanged. Blocked results carry a code only, never content.
 * validateSliceUsage({contractVersion, receipt, current}).
 */
export function validateSliceUsage(input: unknown): Checked<UsageResult> {
	const object = asRecord(input);
	if (!object) return fail("INVALID_INPUT", "input");
	const extra = firstUnknownKey(object, [
		"contractVersion",
		"receipt",
		"current",
	]);
	if (extra !== undefined) return fail("INVALID_INPUT", `input.${extra}`);
	const version = checkContractVersion(object["contractVersion"]);
	if (!version.ok) return version;
	const receipt = checkSliceReceipt(object["receipt"]);
	if (!receipt.ok) return receipt;
	const current = checkUsageCurrent(object["current"]);
	if (!current.ok) return current;
	const r = receipt.value;
	const c = current.value;

	if (
		!c.authorized ||
		!sameScope(c.scope, { principal: r.principal, scopeKey: r.scopeKey })
	)
		return blocked("ACCESS_DENIED");
	if (!c.worldEnabled) return blocked("WORLD_DISABLED");
	if (r.status !== "ready" && r.status !== "partial")
		return blocked("SLICE_NOT_USABLE");
	if (r.scopeEpoch !== c.scopeEpoch) return blocked("SCOPE_EPOCH_CHANGED");
	if (r.policyRevision !== c.policyRevision) return blocked("POLICY_CHANGED");
	if (r.forgetEpoch !== c.forgetEpoch) return blocked("FORGET_EPOCH_CHANGED");
	if (r.restoreEpoch !== c.restoreEpoch)
		return blocked("RESTORE_EPOCH_CHANGED");
	if (r.interpretationVersion !== c.interpretationVersion)
		return blocked("INTERPRETATION_CHANGED");
	const currentAssertions = new Map(
		c.assertions.map((a) => [JSON.stringify([a.id, a.revision]), a.lifecycle]),
	);
	for (const used of r.assertionVersions)
		if (
			currentAssertions.get(JSON.stringify([used.id, used.revision])) !==
			used.lifecycle
		)
			return blocked("ASSERTION_CHANGED");
	// Only states of the receipt's own Scope may keep a Slice valid.
	const states = indexStates(
		c.sources.filter((state) =>
			sameScope(
				{ principal: state.principal, scopeKey: state.scopeKey },
				{ principal: r.principal, scopeKey: r.scopeKey },
			),
		),
	);
	for (const ref of r.sourceVersions)
		if (!sourceIsCurrent(ref, states) || !states.has(sourceIdentityKey(ref)))
			return blocked("SOURCE_CHANGED");
	return ok({ status: "valid" });
}
