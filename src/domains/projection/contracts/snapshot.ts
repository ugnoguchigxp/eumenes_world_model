import {
	asRecord,
	checkBoolean,
	checkEpochMs,
	checkId,
	checkSafeInteger,
	checkScope,
	checkVersionString,
	fail,
	firstUnknownKey,
	ok,
	sameScope,
	type Checked,
	type ScopeRef,
	type SourceState,
} from "../../../contracts/index.ts";
import {
	checkAssertionDraft,
	checkSourceState,
	lifecycles,
	sourceIdentityKey,
	type Assertion,
	type AssertionRef,
	type Freshness,
	type Lifecycle,
} from "../../assertions/contracts/index.ts";
import type { SourceRef } from "../../../contracts/index.ts";

/** Retrieval budget (C5): never more than this many assertions per snapshot. */
export const maxSnapshotAssertions = 500;
export const maxSnapshotSources = 2000;

/** Host-verified mandatory checks. Any false makes the Slice blocked. */
export interface ProjectionChecks {
	readonly authorized: boolean;
	readonly correctionsResolved: boolean;
	readonly restoreVerified: boolean;
}

/** Already-authorized, bounded material for one Scope. */
export interface ProjectionSnapshot {
	readonly scope: ScopeRef;
	readonly asOf: number;
	readonly worldEnabled: boolean;
	/** False when retrieval was cut off or a required read was incomplete. */
	readonly complete: boolean;
	readonly checks: ProjectionChecks;
	readonly scopeEpoch: number;
	readonly policyRevision: string;
	readonly forgetEpoch: string;
	readonly restoreEpoch: string;
	readonly interpretationVersion: string;
	readonly assertions: readonly Assertion[];
	/** Current source states from the same writer snapshot. */
	readonly sources: readonly SourceState[];
}

const snapshotKeys = [
	"scope",
	"asOf",
	"worldEnabled",
	"complete",
	"checks",
	"scopeEpoch",
	"policyRevision",
	"forgetEpoch",
	"restoreEpoch",
	"interpretationVersion",
	"assertions",
	"sources",
];

function checkChecks(value: unknown, path: string): Checked<ProjectionChecks> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const extra = firstUnknownKey(object, [
		"authorized",
		"correctionsResolved",
		"restoreVerified",
	]);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const authorized = checkBoolean(object["authorized"], `${path}.authorized`);
	if (!authorized.ok) return authorized;
	const corrections = checkBoolean(
		object["correctionsResolved"],
		`${path}.correctionsResolved`,
	);
	if (!corrections.ok) return corrections;
	const restore = checkBoolean(
		object["restoreVerified"],
		`${path}.restoreVerified`,
	);
	if (!restore.ok) return restore;
	return ok({
		authorized: authorized.value,
		correctionsResolved: corrections.value,
		restoreVerified: restore.value,
	});
}

const assertionRecordKeys = ["lifecycle", "rootEvidenceIds"];

/** An adopted-ledger record: a draft plus lifecycle and root evidence IDs. */
export function checkAssertionRecord(
	value: unknown,
	path: string,
): Checked<Assertion> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const lifecycle = object["lifecycle"];
	if (!lifecycles.includes(lifecycle as Lifecycle))
		return fail("INVALID_INPUT", `${path}.lifecycle`);
	const roots = object["rootEvidenceIds"];
	if (!Array.isArray(roots))
		return fail("INVALID_INPUT", `${path}.rootEvidenceIds`);
	const rootIds: string[] = [];
	for (let i = 0; i < roots.length; i++) {
		const id = checkId(roots[i], `${path}.rootEvidenceIds[${i}]`);
		if (!id.ok) return id;
		rootIds.push(id.value);
	}
	const rest: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(object))
		if (!assertionRecordKeys.includes(key)) rest[key] = item;
	const draft = checkAssertionDraft(rest, path);
	if (!draft.ok) return draft;
	const { lifecycle: _ignored, ...base } = draft.value;
	return ok({
		...base,
		lifecycle: lifecycle as Lifecycle,
		rootEvidenceIds: [...rootIds].sort(),
	});
}

export function checkProjectionSnapshot(
	value: unknown,
	path = "snapshot",
): Checked<ProjectionSnapshot> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const extra = firstUnknownKey(object, snapshotKeys);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const scope = checkScope(object["scope"], `${path}.scope`);
	if (!scope.ok) return scope;
	const asOf = checkEpochMs(object["asOf"], `${path}.asOf`);
	if (!asOf.ok) return asOf;
	const worldEnabled = checkBoolean(
		object["worldEnabled"],
		`${path}.worldEnabled`,
	);
	if (!worldEnabled.ok) return worldEnabled;
	const complete = checkBoolean(object["complete"], `${path}.complete`);
	if (!complete.ok) return complete;
	const checks = checkChecks(object["checks"], `${path}.checks`);
	if (!checks.ok) return checks;
	const scopeEpoch = checkSafeInteger(
		object["scopeEpoch"],
		`${path}.scopeEpoch`,
	);
	if (!scopeEpoch.ok) return scopeEpoch;
	if (scopeEpoch.value < 0) return fail("INVALID_INPUT", `${path}.scopeEpoch`);
	const policyRevision = checkVersionString(
		object["policyRevision"],
		`${path}.policyRevision`,
	);
	if (!policyRevision.ok) return policyRevision;
	const forgetEpoch = checkVersionString(
		object["forgetEpoch"],
		`${path}.forgetEpoch`,
	);
	if (!forgetEpoch.ok) return forgetEpoch;
	const restoreEpoch = checkVersionString(
		object["restoreEpoch"],
		`${path}.restoreEpoch`,
	);
	if (!restoreEpoch.ok) return restoreEpoch;
	const interpretationVersion = checkVersionString(
		object["interpretationVersion"],
		`${path}.interpretationVersion`,
	);
	if (!interpretationVersion.ok) return interpretationVersion;
	const rawAssertions = object["assertions"];
	if (!Array.isArray(rawAssertions))
		return fail("INVALID_INPUT", `${path}.assertions`);
	if (rawAssertions.length > maxSnapshotAssertions)
		return fail("LIMIT_EXCEEDED", `${path}.assertions`);
	const assertions: Assertion[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < rawAssertions.length; i++) {
		const item = checkAssertionRecord(
			rawAssertions[i],
			`${path}.assertions[${i}]`,
		);
		if (!item.ok) return item;
		// A foreign-Scope row must not be echoed back, counted or filtered.
		if (!sameScope(item.value.scope, scope.value))
			return fail("SCOPE_NOT_PERMITTED", path);
		const key = JSON.stringify([item.value.id, item.value.revision]);
		if (seen.has(key)) return fail("INVALID_INPUT", `${path}.assertions[${i}]`);
		seen.add(key);
		assertions.push(item.value);
	}
	const rawSources = object["sources"];
	if (!Array.isArray(rawSources))
		return fail("INVALID_INPUT", `${path}.sources`);
	if (rawSources.length > maxSnapshotSources)
		return fail("LIMIT_EXCEEDED", `${path}.sources`);
	const sources: SourceState[] = [];
	const seenSources = new Set<string>();
	for (let i = 0; i < rawSources.length; i++) {
		const item = checkSourceState(rawSources[i], `${path}.sources[${i}]`);
		if (!item.ok) return item;
		// Two states for one source identity would make the result depend on
		// array order; reject instead of choosing one.
		const sourceKey = sourceIdentityKey(item.value);
		if (seenSources.has(sourceKey))
			return fail("INVALID_INPUT", `${path}.sources[${i}]`);
		seenSources.add(sourceKey);
		if (
			item.value.principal !== scope.value.principal ||
			item.value.scopeKey !== scope.value.scopeKey
		)
			return fail("SCOPE_NOT_PERMITTED", path);
		sources.push(item.value);
	}
	return ok({
		scope: scope.value,
		asOf: asOf.value,
		worldEnabled: worldEnabled.value,
		complete: complete.value,
		checks: checks.value,
		scopeEpoch: scopeEpoch.value,
		policyRevision: policyRevision.value,
		forgetEpoch: forgetEpoch.value,
		restoreEpoch: restoreEpoch.value,
		interpretationVersion: interpretationVersion.value,
		assertions,
		sources,
	});
}

export const exclusionReasons = [
	"TERMINAL_LIFECYCLE",
	"SOURCE_NOT_CURRENT",
] as const;
export type ExclusionReason = (typeof exclusionReasons)[number];

/** Visible state of one assertion in the projection. */
export type ProjectionStatus = "active" | "disputed" | "candidate";

export interface ProjectionEntry {
	readonly id: string;
	readonly revision: number;
	readonly subjectId: string;
	readonly predicate: string;
	readonly status: ProjectionStatus;
	readonly freshness: Freshness;
	readonly origin: Assertion["origin"];
	/** Only adopted, undisputed claims propagate in deterministic reasoning. */
	readonly causalEligible: boolean;
	/** Sorted refs of assertions that dispute this one, plus its own contradicts. */
	readonly refutations: readonly AssertionRef[];
	/** Distinct cited sources (evidence + manifest), sorted. */
	readonly sources: readonly SourceRef[];
	readonly assertion: Assertion;
}
export interface ProjectionExclusion {
	readonly id: string;
	readonly revision: number;
	readonly lifecycle: Lifecycle;
	readonly reason: ExclusionReason;
}
export interface Projection {
	readonly scope: ScopeRef;
	readonly asOf: number;
	readonly entries: readonly ProjectionEntry[];
	readonly excluded: readonly ProjectionExclusion[];
	/** Digest over the stored material set (not asOf or freshness). */
	readonly materialDigest: string;
	readonly contractVersion: 1;
}
