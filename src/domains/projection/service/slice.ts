import {
	canonicalBytes,
	canonicalDigest,
	ok,
	type CanonicalHasher,
	type Checked,
	type SourceRef,
} from "../../../contracts/index.ts";
import { sourceInputKey } from "../../assertions/index.ts";
import {
	SLICE_MAX_BYTES,
	checkBuildSliceInput,
	type SliceAssertionVersion,
	type SliceReasonCode,
	type SliceReceipt,
	type SliceStatus,
	type SliceUnit,
	type WorldSlice,
} from "../contracts/slice.ts";
import type {
	ProjectionEntry,
	ProjectionSnapshot,
} from "../contracts/snapshot.ts";
import { projectSnapshot } from "./project.ts";

/** Non-empty placeholder for state that is withheld from the caller. */
const WITHHELD = "-";
const statusRank = { active: 0, disputed: 1, candidate: 2 } as const;
const freshnessRank = { fresh: 0, unknown: 1, stale: 2 } as const;

function toUnit(entry: ProjectionEntry): SliceUnit {
	const a = entry.assertion;
	const unit: SliceUnit = {
		assertionId: a.id,
		revision: a.revision,
		stance:
			entry.status === "candidate" || entry.origin === "model_hypothesis"
				? "hypothesis"
				: "claim",
		status: entry.status,
		origin: entry.origin,
		freshness: entry.freshness,
		conclusion: {
			subjectId: a.subjectId,
			predicate: a.predicate,
			payload: a.payload,
		},
		condition: a.condition,
		refutations: entry.refutations,
		sources: entry.sources,
	};
	return a.validTime === undefined ? unit : { ...unit, validTime: a.validTime };
}

/** Header-only Slice for statuses that must reveal nothing about content. */
function withDigest(
	slice: Omit<WorldSlice, "digest">,
	hasher: CanonicalHasher,
): Checked<WorldSlice> {
	const digest = canonicalDigest(slice, hasher);
	if (!digest.ok) return digest;
	return ok({ ...slice, digest: digest.value });
}

/**
 * Header for callers that must learn nothing about the Scope's state: no epoch,
 * policy, forget/restore or interpretation values (fixed placeholders).
 */
function minimalHeader(
	snapshot: ProjectionSnapshot,
	goalRef: WorldSlice["goalRef"],
	maxBytes: number,
	status: SliceStatus,
	reasonCodes: readonly SliceReasonCode[],
): Omit<WorldSlice, "digest"> {
	return {
		...header(snapshot, goalRef, maxBytes, status, reasonCodes),
		scopeEpoch: 0,
		policyRevision: WITHHELD,
		forgetEpoch: WITHHELD,
		restoreEpoch: WITHHELD,
		interpretationVersion: WITHHELD,
	};
}

function header(
	snapshot: ProjectionSnapshot,
	goalRef: WorldSlice["goalRef"],
	maxBytes: number,
	status: SliceStatus,
	reasonCodes: readonly SliceReasonCode[],
): Omit<WorldSlice, "digest"> {
	return {
		contractVersion: 1,
		sliceVersion: 1,
		principal: snapshot.scope.principal,
		scopeKey: snapshot.scope.scopeKey,
		asOf: snapshot.asOf,
		goalRef,
		status,
		reasonCodes,
		scopeEpoch: snapshot.scopeEpoch,
		policyRevision: snapshot.policyRevision,
		forgetEpoch: snapshot.forgetEpoch,
		restoreEpoch: snapshot.restoreEpoch,
		interpretationVersion: snapshot.interpretationVersion,
		budget: { maxBytes, usedBytes: 0 },
		completeness: { complete: false, omittedUnits: 0 },
		assertionVersions: [],
		sourceVersions: [],
		units: [],
	};
}

function versionsOf(chosen: readonly ProjectionEntry[]): {
	assertionVersions: SliceAssertionVersion[];
	sourceVersions: SourceRef[];
} {
	const sourceMap = new Map<string, SourceRef>();
	for (const entry of chosen)
		for (const ref of entry.sources) sourceMap.set(sourceInputKey(ref), ref);
	const assertionVersions: SliceAssertionVersion[] = chosen
		.map((e) => ({
			id: e.id,
			revision: e.revision,
			lifecycle: e.assertion.lifecycle,
		}))
		.sort((a, b) =>
			a.id === b.id ? a.revision - b.revision : a.id < b.id ? -1 : 1,
		);
	return {
		assertionVersions,
		sourceVersions: [...sourceMap.entries()]
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([, ref]) => ref),
	};
}

/** UTF-8 bytes of the budgeted presentation: units + both version arrays. */
function presentationBytes(
	units: readonly SliceUnit[],
	chosen: readonly ProjectionEntry[],
): number {
	const { assertionVersions, sourceVersions } = versionsOf(chosen);
	let total = 0;
	for (const part of [units, assertionVersions, sourceVersions]) {
		const bytes = canonicalBytes(part, Number.MAX_SAFE_INTEGER);
		if (!bytes.ok) return Number.POSITIVE_INFINITY;
		total += bytes.value.length;
	}
	return total;
}

/**
 * buildWorldSlice({contractVersion, snapshot, request}, hasher).
 * Status priority: disabled > blocked > overflow > partial > ready.
 * Budget counts the UTF-8 bytes of the canonical JSON of `units` plus
 * `assertionVersions` and `sourceVersions`; units are dropped whole, never
 * partially. Order and digest do not depend on input order.
 */
export function buildWorldSlice(
	input: unknown,
	hasher: CanonicalHasher,
): Checked<WorldSlice> {
	const parsed = checkBuildSliceInput(input);
	if (!parsed.ok) return parsed;
	const { snapshot, request } = parsed.value;
	const goalRef = request.goalRef ?? null;
	const maxBytes = Math.min(
		request.maxBytes ?? SLICE_MAX_BYTES,
		SLICE_MAX_BYTES,
	);

	// Authorization first: an unverified caller learns nothing, not even whether
	// the World is enabled or what the Scope's counters are.
	if (!snapshot.checks.authorized)
		return withDigest(
			minimalHeader(snapshot, goalRef, maxBytes, "blocked", [
				"ACCESS_NOT_VERIFIED",
			]),
			hasher,
		);
	if (!snapshot.worldEnabled)
		return withDigest(
			minimalHeader(snapshot, goalRef, maxBytes, "disabled", [
				"WORLD_DISABLED",
			]),
			hasher,
		);
	const projection = projectSnapshot(snapshot, hasher);
	if (!projection.ok) return projection;
	const { entries, excluded } = projection.value;

	const blocked: SliceReasonCode[] = [];
	if (!snapshot.complete) blocked.push("SNAPSHOT_INCOMPLETE");
	if (!snapshot.checks.correctionsResolved)
		blocked.push("CORRECTION_UNRESOLVED");
	if (!snapshot.checks.restoreVerified) blocked.push("RESTORE_UNVERIFIED");
	if (excluded.some((e) => e.reason === "SOURCE_NOT_CURRENT"))
		blocked.push("SOURCE_NOT_CURRENT");
	if (blocked.length > 0)
		return withDigest(
			header(snapshot, goalRef, maxBytes, "blocked", blocked),
			hasher,
		);

	const focus = new Set(request.focusSubjectIds ?? []);
	const ranked = entries
		.map((entry) => ({
			entry,
			focused: focus.has(entry.subjectId),
		}))
		.sort((a, b) => {
			if (a.focused !== b.focused) return a.focused ? -1 : 1;
			const s = statusRank[a.entry.status] - statusRank[b.entry.status];
			if (s !== 0) return s;
			const f =
				freshnessRank[a.entry.freshness] - freshnessRank[b.entry.freshness];
			if (f !== 0) return f;
			if (a.entry.id !== b.entry.id) return a.entry.id < b.entry.id ? -1 : 1;
			return a.entry.revision - b.entry.revision;
		});
	// Required = focus units; without focus, the single top-ranked unit.
	const requiredCount =
		focus.size > 0
			? ranked.filter((r) => r.focused).length
			: Math.min(1, ranked.length);

	const units: SliceUnit[] = [];
	const chosen: ProjectionEntry[] = [];
	let used = 0;
	let overflow = false;
	let omitted = 0;
	for (let i = 0; i < ranked.length; i++) {
		const { entry } = ranked[i]!;
		const unit = toUnit(entry);
		const size = presentationBytes([...units, unit], [...chosen, entry]);
		if (size <= maxBytes) {
			used = size;
			units.push(unit);
			chosen.push(entry);
			continue;
		}
		if (i < requiredCount) {
			overflow = true;
			break;
		}
		omitted = ranked.length - i;
		break;
	}
	if (overflow)
		return withDigest(
			header(snapshot, goalRef, maxBytes, "overflow", [
				"REQUIRED_UNIT_EXCEEDS_BUDGET",
			]),
			hasher,
		);

	const reasons: SliceReasonCode[] = [];
	if (omitted > 0) reasons.push("UNITS_OMITTED_BY_BUDGET");
	if (ranked.length === 0) reasons.push("NO_ELIGIBLE_UNITS");
	// A requested subject without any eligible unit is not silently "ready".
	if ([...focus].some((id) => !ranked.some((r) => r.entry.subjectId === id)))
		reasons.push("FOCUS_NOT_FOUND");
	const status: SliceStatus = reasons.length > 0 ? "partial" : "ready";

	const { assertionVersions, sourceVersions } = versionsOf(chosen);
	return withDigest(
		{
			...header(snapshot, goalRef, maxBytes, status, reasons),
			budget: { maxBytes, usedBytes: used },
			// complete only when nothing was omitted AND the request was fully
			// answered (a missing focus subject or an empty Slice is not complete).
			completeness: { complete: reasons.length === 0, omittedUnits: omitted },
			assertionVersions,
			sourceVersions,
			units,
		},
		hasher,
	);
}

/** The minimal record the host stores to re-validate a Slice before adoption. */
export function toSliceReceipt(slice: WorldSlice): SliceReceipt {
	return {
		principal: slice.principal,
		scopeKey: slice.scopeKey,
		status: slice.status,
		scopeEpoch: slice.scopeEpoch,
		policyRevision: slice.policyRevision,
		forgetEpoch: slice.forgetEpoch,
		restoreEpoch: slice.restoreEpoch,
		interpretationVersion: slice.interpretationVersion,
		assertionVersions: slice.assertionVersions,
		sourceVersions: slice.sourceVersions,
		digest: slice.digest,
	};
}
