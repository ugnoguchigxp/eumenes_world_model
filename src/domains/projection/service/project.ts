import {
	canonicalDigest,
	checkContractVersion,
	asRecord,
	fail,
	firstUnknownKey,
	ok,
	type CanonicalHasher,
	type Checked,
	type SourceRef,
	type SourceState,
} from "../../../contracts/index.ts";
import {
	assessFreshness,
	sourceIdentityKey,
	sourceInputKey,
	type Assertion,
	type AssertionRef,
} from "../../assertions/index.ts";
import {
	checkProjectionSnapshot,
	type Projection,
	type ProjectionEntry,
	type ProjectionExclusion,
	type ProjectionSnapshot,
} from "../contracts/snapshot.ts";

const terminal = new Set(["superseded", "retracted", "invalidated"]);

/** Upper bound of the material set (500 assertions, 2000 sources, with slack). */
const materialMaxBytes = 4 * 1024 * 1024;
const refKey = (ref: AssertionRef) => JSON.stringify([ref.id, ref.revision]);
const compareRef = (a: AssertionRef, b: AssertionRef) =>
	a.id === b.id ? a.revision - b.revision : a.id < b.id ? -1 : 1;
const sortedBy = <T>(items: readonly T[], key: (item: T) => string) =>
	[...items].sort((a, b) => {
		const x = key(a);
		const y = key(b);
		return x < y ? -1 : x > y ? 1 : 0;
	});

/** Distinct cited sources of one assertion (evidence + manifest), sorted. */
export function citedSources(assertion: Assertion): SourceRef[] {
	const seen = new Map<string, SourceRef>();
	for (const ev of assertion.evidence) {
		const { range: _range, ...ref } = ev.source;
		seen.set(sourceInputKey(ref), ref);
	}
	for (const ref of assertion.inputManifest) {
		const { range: _range, ...plain } = ref;
		seen.set(sourceInputKey(plain), plain);
	}
	return sortedBy([...seen.values()], sourceInputKey);
}

/** True when the host's current state matches the cited version exactly. */
export function sourceIsCurrent(
	ref: SourceRef,
	states: ReadonlyMap<string, SourceState>,
): boolean {
	const state = states.get(sourceIdentityKey(ref));
	return (
		state !== undefined &&
		state.status === "available" &&
		state.revision === ref.revision &&
		state.digest === ref.digest
	);
}

export function indexStates(
	states: readonly SourceState[],
): Map<string, SourceState> {
	return new Map(states.map((state) => [sourceIdentityKey(state), state]));
}

/**
 * Pure projection of a bounded ledger snapshot. Superseded/retracted/invalidated
 * assertions are excluded; disputed ones stay as display material but never as
 * deterministic causal input. `active` means adopted, not true.
 */
export function projectSnapshot(
	snapshot: ProjectionSnapshot,
	hasher: CanonicalHasher,
): Checked<Projection> {
	const states = indexStates(snapshot.sources);
	const lifecycleOf = new Map(
		snapshot.assertions.map((a) => [refKey(a), a.lifecycle]),
	);
	const disputers = new Map<string, AssertionRef[]>();
	for (const assertion of snapshot.assertions) {
		// A withdrawn/superseded/invalidated assertion no longer disputes anything.
		if (terminal.has(assertion.lifecycle)) continue;
		for (const target of assertion.contradicts) {
			const list = disputers.get(refKey(target)) ?? [];
			list.push({ id: assertion.id, revision: assertion.revision });
			disputers.set(refKey(target), list);
		}
	}
	const entries: ProjectionEntry[] = [];
	const excluded: ProjectionExclusion[] = [];
	for (const assertion of snapshot.assertions) {
		const base = {
			id: assertion.id,
			revision: assertion.revision,
			lifecycle: assertion.lifecycle,
		};
		if (terminal.has(assertion.lifecycle)) {
			excluded.push({ ...base, reason: "TERMINAL_LIFECYCLE" });
			continue;
		}
		const sources = citedSources(assertion);
		if (!sources.every((ref) => sourceIsCurrent(ref, states))) {
			excluded.push({ ...base, reason: "SOURCE_NOT_CURRENT" });
			continue;
		}
		const status =
			assertion.lifecycle === "active"
				? "active"
				: assertion.lifecycle === "disputed"
					? "disputed"
					: "candidate";
		const refutations = new Map<string, AssertionRef>();
		for (const ref of [
			...assertion.contradicts,
			...(disputers.get(refKey(assertion)) ?? []),
		])
			refutations.set(refKey(ref), { id: ref.id, revision: ref.revision });
		entries.push({
			id: assertion.id,
			revision: assertion.revision,
			subjectId: assertion.subjectId,
			predicate: assertion.predicate,
			status,
			freshness: assessFreshness(
				assertion.observedAt,
				assertion.freshnessPolicy,
				snapshot.asOf,
			),
			origin: assertion.origin,
			// An adopted claim with a live (non-terminal) refutation is contested
			// and must not feed deterministic propagation.
			causalEligible:
				status === "active" &&
				![...refutations.values()].some((ref) => {
					const lifecycle = lifecycleOf.get(refKey(ref));
					return lifecycle !== undefined && !terminal.has(lifecycle);
				}),
			refutations: [...refutations.values()].sort(compareRef),
			sources,
			assertion,
		});
	}
	entries.sort(compareRef);
	excluded.sort(compareRef);
	// Hash each assertion/source on its own, then the sorted list of those small
	// digests: the cost is bounded by the snapshot limits, never by one cap.
	const assertionDigests: { id: string; revision: number; digest: string }[] =
		[];
	for (const a of snapshot.assertions) {
		const digest = canonicalDigest(
			{
				id: a.id,
				revision: a.revision,
				lifecycle: a.lifecycle,
				contradicts: [...a.contradicts].sort(compareRef),
				supersedes: [...a.supersedes].sort(compareRef),
			},
			hasher,
			materialMaxBytes,
		);
		if (!digest.ok) return digest;
		assertionDigests.push({
			id: a.id,
			revision: a.revision,
			digest: digest.value,
		});
	}
	assertionDigests.sort(compareRef);
	const sourceDigests: string[] = [];
	for (const s of snapshot.sources) {
		const digest = canonicalDigest(
			{
				key: sourceIdentityKey(s),
				revision: s.revision,
				digest: s.digest,
				status: s.status,
			},
			hasher,
			materialMaxBytes,
		);
		if (!digest.ok) return digest;
		sourceDigests.push(digest.value);
	}
	sourceDigests.sort();
	const material = canonicalDigest(
		{
			scope: snapshot.scope,
			assertions: assertionDigests,
			sources: sourceDigests,
		},
		hasher,
		materialMaxBytes,
	);
	if (!material.ok) return material;
	return ok({
		contractVersion: 1,
		scope: snapshot.scope,
		asOf: snapshot.asOf,
		entries,
		excluded,
		materialDigest: material.value,
	});
}

/** buildProjection({contractVersion, snapshot}, hasher). Unknown input in. */
export function buildProjection(
	input: unknown,
	hasher: CanonicalHasher,
): Checked<Projection> {
	const object = asRecord(input);
	if (!object) return fail("INVALID_INPUT", "input");
	const extra = firstUnknownKey(object, ["contractVersion", "snapshot"]);
	if (extra !== undefined) return fail("INVALID_INPUT", `input.${extra}`);
	const version = checkContractVersion(object["contractVersion"]);
	if (!version.ok) return version;
	const snapshot = checkProjectionSnapshot(object["snapshot"]);
	if (!snapshot.ok) return snapshot;
	// No content is projected for an unverified caller.
	if (!snapshot.value.checks.authorized)
		return fail("SCOPE_NOT_PERMITTED", "snapshot");
	return projectSnapshot(snapshot.value, hasher);
}

/**
 * World epoch plan (C2): advance only when the stored material set changed;
 * a resend of the same change keeps the epoch.
 */
export function planScopeEpoch(
	currentEpoch: number,
	currentMaterialDigest: string | undefined,
	nextMaterialDigest: string,
): { readonly epoch: number; readonly changed: boolean } {
	if (!Number.isSafeInteger(currentEpoch) || currentEpoch < 0)
		throw new RangeError("invalid epoch");
	const changed = currentMaterialDigest !== nextMaterialDigest;
	return { epoch: changed ? currentEpoch + 1 : currentEpoch, changed };
}
