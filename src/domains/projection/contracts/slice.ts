import {
	asRecord,
	checkBoolean,
	checkContractVersion,
	checkId,
	checkRevision,
	checkSafeInteger,
	checkScope,
	checkVersionString,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
	type ScopeRef,
	type SourceRef,
	type SourceState,
} from "../../../contracts/index.ts";
import type {
	ConditionSpec,
	ValidTime,
} from "../../conditions/contracts/index.ts";
import {
	checkSourceRef,
	checkSourceState,
	lifecycles,
	sourceIdentityKey,
	type AssertionRef,
	type Freshness,
	type Lifecycle,
	type Origin,
	type Payload,
} from "../../assertions/contracts/index.ts";
import {
	checkProjectionSnapshot,
	maxSnapshotAssertions,
	maxSnapshotSources,
	type ProjectionSnapshot,
	type ProjectionStatus,
} from "./snapshot.ts";

/**
 * Presentation budget (C5/C6): serialized UTF-8 bytes of the canonical JSON of
 * `units` + `assertionVersions` + `sourceVersions` together. The version arrays
 * are part of what the consumer is shown/stores, so they count; the fixed-size
 * header fields (ids, epochs, status, budget) do not.
 */
export const SLICE_MAX_BYTES = 8192;
export const SLICE_VERSION = 1;
export const maxFocusSubjects = 64;

export const sliceStatuses = [
	"ready",
	"partial",
	"blocked",
	"overflow",
	"disabled",
] as const;
export type SliceStatus = (typeof sliceStatuses)[number];

export const sliceReasonCodes = [
	"WORLD_DISABLED",
	"ACCESS_NOT_VERIFIED",
	"SNAPSHOT_INCOMPLETE",
	"CORRECTION_UNRESOLVED",
	"RESTORE_UNVERIFIED",
	"SOURCE_NOT_CURRENT",
	"REQUIRED_UNIT_EXCEEDS_BUDGET",
	"UNITS_OMITTED_BY_BUDGET",
	"NO_ELIGIBLE_UNITS",
	"FOCUS_NOT_FOUND",
] as const;
export type SliceReasonCode = (typeof sliceReasonCodes)[number];

export interface GoalRef {
	readonly id: string;
	readonly revision: number;
}

export interface SliceRequest {
	readonly goalRef?: GoalRef;
	/** Subjects whose units are mandatory for the decision. */
	readonly focusSubjectIds?: readonly string[];
	/** Host budget in bytes; the smaller of this and the default is used. */
	readonly maxBytes?: number;
}

/** Indivisible explanation: conclusion + condition + refutation + sources. */
export interface SliceUnit {
	readonly assertionId: string;
	readonly revision: number;
	readonly stance: "claim" | "hypothesis";
	readonly status: ProjectionStatus;
	readonly origin: Origin;
	readonly freshness: Freshness;
	readonly conclusion: {
		readonly subjectId: string;
		readonly predicate: string;
		readonly payload: Payload;
	};
	readonly condition: ConditionSpec;
	readonly validTime?: ValidTime;
	readonly refutations: readonly AssertionRef[];
	readonly sources: readonly SourceRef[];
}

export interface SliceAssertionVersion {
	readonly id: string;
	readonly revision: number;
	readonly lifecycle: Lifecycle;
}

export interface WorldSlice {
	readonly contractVersion: 1;
	readonly sliceVersion: 1;
	readonly principal: string;
	readonly scopeKey: string;
	readonly asOf: number;
	readonly goalRef: GoalRef | null;
	readonly status: SliceStatus;
	readonly reasonCodes: readonly SliceReasonCode[];
	readonly scopeEpoch: number;
	readonly policyRevision: string;
	readonly forgetEpoch: string;
	readonly restoreEpoch: string;
	readonly interpretationVersion: string;
	readonly budget: { readonly maxBytes: number; readonly usedBytes: number };
	/**
	 * complete is true only for a ready Slice: nothing omitted by the budget and
	 * the request fully answered (no FOCUS_NOT_FOUND / NO_ELIGIBLE_UNITS).
	 */
	readonly completeness: {
		readonly complete: boolean;
		readonly omittedUnits: number;
	};
	readonly assertionVersions: readonly SliceAssertionVersion[];
	readonly sourceVersions: readonly SourceRef[];
	readonly units: readonly SliceUnit[];
	readonly digest: string;
}

/** What the host keeps with an answer to re-validate before adoption. */
export interface SliceReceipt {
	readonly principal: string;
	readonly scopeKey: string;
	readonly status: SliceStatus;
	readonly scopeEpoch: number;
	readonly policyRevision: string;
	readonly forgetEpoch: string;
	readonly restoreEpoch: string;
	readonly interpretationVersion: string;
	readonly assertionVersions: readonly SliceAssertionVersion[];
	readonly sourceVersions: readonly SourceRef[];
	readonly digest: string;
}

export function checkGoalRef(value: unknown, path: string): Checked<GoalRef> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const extra = firstUnknownKey(object, ["id", "revision"]);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const id = checkId(object["id"], `${path}.id`);
	if (!id.ok) return id;
	const revision = checkRevision(object["revision"], `${path}.revision`);
	if (!revision.ok) return revision;
	return ok({ id: id.value, revision: revision.value });
}

export function checkSliceRequest(
	value: unknown,
	path = "request",
): Checked<SliceRequest> {
	const object = asRecord(value ?? {});
	if (!object) return fail("INVALID_INPUT", path);
	const extra = firstUnknownKey(object, [
		"goalRef",
		"focusSubjectIds",
		"maxBytes",
	]);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	let request: SliceRequest = {};
	if (object["goalRef"] !== undefined) {
		const goal = checkGoalRef(object["goalRef"], `${path}.goalRef`);
		if (!goal.ok) return goal;
		request = { ...request, goalRef: goal.value };
	}
	if (object["focusSubjectIds"] !== undefined) {
		const raw = object["focusSubjectIds"];
		if (!Array.isArray(raw))
			return fail("INVALID_INPUT", `${path}.focusSubjectIds`);
		if (raw.length > maxFocusSubjects)
			return fail("LIMIT_EXCEEDED", `${path}.focusSubjectIds`);
		const ids: string[] = [];
		for (let i = 0; i < raw.length; i++) {
			const id = checkId(raw[i], `${path}.focusSubjectIds[${i}]`);
			if (!id.ok) return id;
			ids.push(id.value);
		}
		request = { ...request, focusSubjectIds: [...new Set(ids)].sort() };
	}
	if (object["maxBytes"] !== undefined) {
		const bytes = checkSafeInteger(object["maxBytes"], `${path}.maxBytes`);
		if (!bytes.ok) return bytes;
		if (bytes.value < 1) return fail("INVALID_INPUT", `${path}.maxBytes`);
		request = { ...request, maxBytes: bytes.value };
	}
	return ok(request);
}

export interface BuildSliceInput {
	readonly snapshot: ProjectionSnapshot;
	readonly request: SliceRequest;
}
export function checkBuildSliceInput(value: unknown): Checked<BuildSliceInput> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", "input");
	const extra = firstUnknownKey(object, [
		"contractVersion",
		"snapshot",
		"request",
	]);
	if (extra !== undefined) return fail("INVALID_INPUT", `input.${extra}`);
	const version = checkContractVersion(object["contractVersion"]);
	if (!version.ok) return version;
	const snapshot = checkProjectionSnapshot(object["snapshot"]);
	if (!snapshot.ok) return snapshot;
	const request = checkSliceRequest(object["request"]);
	if (!request.ok) return request;
	return ok({ snapshot: snapshot.value, request: request.value });
}

// ---- usage re-validation ------------------------------------------------

function checkAssertionVersion(
	value: unknown,
	path: string,
): Checked<SliceAssertionVersion> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const extra = firstUnknownKey(object, ["id", "revision", "lifecycle"]);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const id = checkId(object["id"], `${path}.id`);
	if (!id.ok) return id;
	const revision = checkRevision(object["revision"], `${path}.revision`);
	if (!revision.ok) return revision;
	if (!lifecycles.includes(object["lifecycle"] as Lifecycle))
		return fail("INVALID_INPUT", `${path}.lifecycle`);
	return ok({
		id: id.value,
		revision: revision.value,
		lifecycle: object["lifecycle"] as Lifecycle,
	});
}
function checkVersionList<T>(
	value: unknown,
	path: string,
	item: (v: unknown, p: string) => Checked<T>,
	max: number,
	identity: (v: T) => string,
): Checked<T[]> {
	if (!Array.isArray(value)) return fail("INVALID_INPUT", path);
	if (value.length > max) return fail("LIMIT_EXCEEDED", path);
	const out: T[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < value.length; i++) {
		const checked = item(value[i], `${path}[${i}]`);
		if (!checked.ok) return checked;
		// Duplicates would make the result depend on array order.
		const key = identity(checked.value);
		if (seen.has(key)) return fail("INVALID_INPUT", `${path}[${i}]`);
		seen.add(key);
		out.push(checked.value);
	}
	return ok(out);
}
const assertionVersionKey = (v: SliceAssertionVersion) =>
	JSON.stringify([v.id, v.revision]);
const sourceStateKey = (v: SourceState) =>
	JSON.stringify([v.principal, v.scopeKey, sourceIdentityKey(v)]);
const sourceRefKey = (v: SourceRef) => sourceIdentityKey(v);

export function checkSliceReceipt(
	value: unknown,
	path = "receipt",
): Checked<SliceReceipt> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const extra = firstUnknownKey(object, [
		"principal",
		"scopeKey",
		"status",
		"scopeEpoch",
		"policyRevision",
		"forgetEpoch",
		"restoreEpoch",
		"interpretationVersion",
		"assertionVersions",
		"sourceVersions",
		"digest",
	]);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const scope = checkScope(
		{ principal: object["principal"], scopeKey: object["scopeKey"] },
		path,
	);
	if (!scope.ok) return scope;
	if (!sliceStatuses.includes(object["status"] as SliceStatus))
		return fail("INVALID_INPUT", `${path}.status`);
	const scopeEpoch = checkSafeInteger(
		object["scopeEpoch"],
		`${path}.scopeEpoch`,
	);
	if (!scopeEpoch.ok) return scopeEpoch;
	if (scopeEpoch.value < 0) return fail("INVALID_INPUT", `${path}.scopeEpoch`);
	const policy = checkVersionString(
		object["policyRevision"],
		`${path}.policyRevision`,
	);
	if (!policy.ok) return policy;
	const forget = checkVersionString(
		object["forgetEpoch"],
		`${path}.forgetEpoch`,
	);
	if (!forget.ok) return forget;
	const restore = checkVersionString(
		object["restoreEpoch"],
		`${path}.restoreEpoch`,
	);
	if (!restore.ok) return restore;
	const interpretation = checkVersionString(
		object["interpretationVersion"],
		`${path}.interpretationVersion`,
	);
	if (!interpretation.ok) return interpretation;
	const assertions = checkVersionList(
		object["assertionVersions"],
		`${path}.assertionVersions`,
		checkAssertionVersion,
		maxSnapshotAssertions,
		assertionVersionKey,
	);
	if (!assertions.ok) return assertions;
	const sources = checkVersionList(
		object["sourceVersions"],
		`${path}.sourceVersions`,
		checkSourceRef,
		maxSnapshotSources,
		sourceRefKey,
	);
	if (!sources.ok) return sources;
	const digest = checkVersionString(object["digest"], `${path}.digest`);
	if (!digest.ok) return digest;
	return ok({
		principal: scope.value.principal,
		scopeKey: scope.value.scopeKey,
		status: object["status"] as SliceStatus,
		scopeEpoch: scopeEpoch.value,
		policyRevision: policy.value,
		forgetEpoch: forget.value,
		restoreEpoch: restore.value,
		interpretationVersion: interpretation.value,
		assertionVersions: assertions.value,
		sourceVersions: sources.value,
		digest: digest.value,
	});
}

/** Current writer-snapshot facts for the Slice's own Scope only. */
export interface UsageCurrent {
	readonly scope: ScopeRef;
	readonly authorized: boolean;
	readonly worldEnabled: boolean;
	readonly scopeEpoch: number;
	readonly policyRevision: string;
	readonly forgetEpoch: string;
	readonly restoreEpoch: string;
	readonly interpretationVersion: string;
	readonly assertions: readonly SliceAssertionVersion[];
	readonly sources: readonly SourceState[];
}

export function checkUsageCurrent(
	value: unknown,
	path = "current",
): Checked<UsageCurrent> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const extra = firstUnknownKey(object, [
		"scope",
		"authorized",
		"worldEnabled",
		"scopeEpoch",
		"policyRevision",
		"forgetEpoch",
		"restoreEpoch",
		"interpretationVersion",
		"assertions",
		"sources",
	]);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const scope = checkScope(object["scope"], `${path}.scope`);
	if (!scope.ok) return scope;
	const authorized = checkBoolean(object["authorized"], `${path}.authorized`);
	if (!authorized.ok) return authorized;
	const enabled = checkBoolean(object["worldEnabled"], `${path}.worldEnabled`);
	if (!enabled.ok) return enabled;
	const scopeEpoch = checkSafeInteger(
		object["scopeEpoch"],
		`${path}.scopeEpoch`,
	);
	if (!scopeEpoch.ok) return scopeEpoch;
	if (scopeEpoch.value < 0) return fail("INVALID_INPUT", `${path}.scopeEpoch`);
	const policy = checkVersionString(
		object["policyRevision"],
		`${path}.policyRevision`,
	);
	if (!policy.ok) return policy;
	const forget = checkVersionString(
		object["forgetEpoch"],
		`${path}.forgetEpoch`,
	);
	if (!forget.ok) return forget;
	const restore = checkVersionString(
		object["restoreEpoch"],
		`${path}.restoreEpoch`,
	);
	if (!restore.ok) return restore;
	const interpretation = checkVersionString(
		object["interpretationVersion"],
		`${path}.interpretationVersion`,
	);
	if (!interpretation.ok) return interpretation;
	const assertions = checkVersionList(
		object["assertions"],
		`${path}.assertions`,
		checkAssertionVersion,
		maxSnapshotAssertions,
		assertionVersionKey,
	);
	if (!assertions.ok) return assertions;
	const sources = checkVersionList(
		object["sources"],
		`${path}.sources`,
		checkSourceState,
		maxSnapshotSources,
		sourceStateKey,
	);
	if (!sources.ok) return sources;
	return ok({
		scope: scope.value,
		authorized: authorized.value,
		worldEnabled: enabled.value,
		scopeEpoch: scopeEpoch.value,
		policyRevision: policy.value,
		forgetEpoch: forget.value,
		restoreEpoch: restore.value,
		interpretationVersion: interpretation.value,
		assertions: assertions.value,
		sources: sources.value,
	});
}

export const usageBlockCodes = [
	"ACCESS_DENIED",
	"WORLD_DISABLED",
	"SLICE_NOT_USABLE",
	"SCOPE_EPOCH_CHANGED",
	"POLICY_CHANGED",
	"FORGET_EPOCH_CHANGED",
	"RESTORE_EPOCH_CHANGED",
	"INTERPRETATION_CHANGED",
	"ASSERTION_CHANGED",
	"SOURCE_CHANGED",
] as const;
export type UsageBlockCode = (typeof usageBlockCodes)[number];
export type UsageResult =
	| { readonly status: "valid" }
	| { readonly status: "blocked"; readonly reasonCode: UsageBlockCode };
