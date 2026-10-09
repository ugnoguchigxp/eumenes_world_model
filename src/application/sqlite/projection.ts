import {
	canonicalBytes,
	canonicalDigest,
	type CanonicalHasher,
	type ScopeRef,
	type SourceState,
} from "../../contracts/index.ts";
import {
	sourceIdentityKey,
	terminalLifecycles,
	type Assertion,
	type AssertionRef,
} from "../../domains/assertions/index.ts";
import {
	getAssertion,
	listScopeAssertions,
} from "../../domains/assertions/sqlite.ts";
import { buildProjection } from "../../domains/projection/index.ts";
import {
	advanceProjectionEpoch,
	clearProjection,
	deleteProjectionFor,
	getCurrentRow,
	getEpoch,
	insertProjectionRows,
	setCausalEligible,
	updateCurrentPayload,
	type CurrentRow,
	type EdgeRow,
} from "../../domains/projection/sqlite.ts";
import {
	WorldIntegrityError,
	type WorldDb,
} from "../../infrastructure/sqlite/db.ts";
import {
	maxLedgerAssertions,
	WORLD_INTERPRETATION_VERSION,
	type HostChecks,
} from "./types.ts";

/*
 * Material digest scheme "set-sum-v1" (order independent, incrementally
 * maintainable): digest = (sum over HEAD assertions of H(a)) mod 2^256, written
 * as `sha256:<64 hex>` so it fits the digest column. H(a) is the SHA-256 (the
 * injected hasher) of the canonical summary {id, revision, lifecycle, sorted
 * contradicts, sorted supersedes, sorted cited sources (identity key, revision,
 * digest)}. A head moving from `old` to `next` updates the sum by -H(old)+H(next),
 * so a write costs O(changed assertions) and a full rebuild from the ledger
 * yields the same value. The value is a multiset sum, not a preimage hash.
 * Freshness is evaluated at the write clock and is NOT part of the digest.
 */
const MODULUS = 1n << 256n;
const decoder = new TextDecoder();
const json = (value: unknown): string => {
	const bytes = canonicalBytes(value);
	if (!bytes.ok) throw new WorldIntegrityError("PROJECTION_PAYLOAD");
	return decoder.decode(bytes.value);
};

const refKey = (ref: AssertionRef) => JSON.stringify([ref.id, ref.revision]);
const compareRef = (a: AssertionRef, b: AssertionRef) =>
	a.id === b.id ? a.revision - b.revision : a.id < b.id ? -1 : 1;

function citedRefs(assertion: Assertion) {
	return [
		...assertion.evidence.map((e) => e.source),
		...assertion.inputManifest,
	];
}

/** H(a) as an integer; hashes only what defines the stored material. */
export function headHash(
	assertion: Assertion,
	hasher: CanonicalHasher,
): bigint {
	const sources = new Map<string, [string, string, string]>();
	for (const ref of citedRefs(assertion)) {
		const entry: [string, string, string] = [
			sourceIdentityKey(ref),
			ref.revision,
			ref.digest,
		];
		sources.set(JSON.stringify(entry), entry);
	}
	const digest = canonicalDigest(
		{
			id: assertion.id,
			revision: assertion.revision,
			lifecycle: assertion.lifecycle,
			contradicts: [...assertion.contradicts].sort(compareRef),
			supersedes: [...assertion.supersedes].sort(compareRef),
			sources: [...sources.entries()]
				.sort(([a], [b]) => (a < b ? -1 : 1))
				.map(([, value]) => value),
		},
		hasher,
	);
	if (!digest.ok) throw new WorldIntegrityError("PROJECTION_DIGEST");
	return BigInt(`0x${digest.value.slice("sha256:".length)}`);
}
const digestOf = (sum: bigint): string =>
	`sha256:${(((sum % MODULUS) + MODULUS) % MODULUS).toString(16).padStart(64, "0")}`;
const sumOf = (digest: string | undefined): bigint =>
	digest === undefined ? 0n : BigInt(`0x${digest.slice("sha256:".length)}`);

export interface LedgerProjection {
	readonly entries: readonly CurrentRow[];
	readonly edges: readonly EdgeRow[];
	readonly materialDigest: string;
}

interface ProjectContext {
	readonly hasher: CanonicalHasher;
	readonly clock: number;
	readonly hostChecks: HostChecks;
}

/** Sources exactly as each assertion cited them: the ledger knows nothing newer. */
function citedStates(
	assertions: readonly Assertion[],
	scope: ScopeRef,
): SourceState[] {
	const byKey = new Map<string, SourceState>();
	for (const assertion of assertions)
		for (const ref of citedRefs(assertion)) {
			const { range: _range, ...whole } = ref;
			byKey.set(sourceIdentityKey(ref), {
				...whole,
				principal: scope.principal,
				scopeKey: scope.scopeKey,
				status: "available",
			});
		}
	return [...byKey.values()];
}

/** Disputers per target (id, revision); terminal disputers still count. */
function disputersOf(
	assertions: readonly Assertion[],
	into = new Map<string, AssertionRef[]>(),
): Map<string, AssertionRef[]> {
	for (const assertion of assertions)
		for (const target of assertion.contradicts) {
			const list = into.get(refKey(target)) ?? [];
			list.push({ id: assertion.id, revision: assertion.revision });
			into.set(refKey(target), list);
		}
	return into;
}

/** True when `ref` names a CURRENT head of the ledger that is not terminal. */
type LiveHead = (ref: AssertionRef) => boolean;
const terminalSet = new Set<string>(terminalLifecycles);

/** Live-head lookup against the stored ledger (memoised per call). */
function dbLiveHead(db: WorldDb, scope: ScopeRef): LiveHead {
	const cache = new Map<string, boolean>();
	return (ref) => {
		const key = refKey(ref);
		let live = cache.get(key);
		if (live === undefined) {
			const head = getAssertion(db, scope, ref.id);
			live =
				head !== undefined &&
				head.revision === ref.revision &&
				!terminalSet.has(head.lifecycle);
			cache.set(key, live);
		}
		return live;
	};
}

/** buildProjection accepts at most this many assertions per call. */
const maxGroup = 500;

/** Groups assertions whose cited source versions never disagree (one state per source). */
function consistentGroups(assertions: readonly Assertion[]): Assertion[][] {
	const groups: { seen: Map<string, string>; items: Assertion[] }[] = [];
	for (const assertion of assertions) {
		const refs = citedRefs(assertion).map(
			(ref) =>
				[sourceIdentityKey(ref), `${ref.revision}\u0000${ref.digest}`] as const,
		);
		let group = groups.find(
			(g) =>
				g.items.length < maxGroup &&
				refs.every(
					([key, version]) => (g.seen.get(key) ?? version) === version,
				),
		);
		if (!group) {
			group = { seen: new Map(), items: [] };
			groups.push(group);
		}
		for (const [key, version] of refs) group.seen.set(key, version);
		group.items.push(assertion);
	}
	return groups.map((g) => g.items);
}

function rowsOfGroup(
	assertions: readonly Assertion[],
	scope: ScopeRef,
	context: ProjectContext,
	disputers: ReadonlyMap<string, AssertionRef[]>,
	liveHead: LiveHead,
): { entries: CurrentRow[]; edges: EdgeRow[] } {
	const built = buildProjection(
		{
			contractVersion: 1,
			snapshot: {
				scope,
				asOf: context.clock,
				worldEnabled: true,
				complete: true,
				checks: {
					authorized: true,
					correctionsResolved: true,
					restoreVerified: true,
				},
				scopeEpoch: 0,
				policyRevision: context.hostChecks.policyRevision,
				forgetEpoch: context.hostChecks.forgetEpoch,
				restoreEpoch: context.hostChecks.restoreEpoch,
				interpretationVersion: WORLD_INTERPRETATION_VERSION,
				assertions,
				sources: citedStates(assertions, scope),
			},
		},
		context.hasher,
	);
	if (!built.ok)
		throw new WorldIntegrityError(
			`PROJECTION_BUILD:${built.code}:${built.path}`,
		);
	const entries: CurrentRow[] = [];
	const edges: EdgeRow[] = [];
	for (const entry of built.value.entries) {
		const refutations = new Map<string, AssertionRef>();
		for (const ref of [
			...entry.refutations,
			...(disputers.get(refKey({ id: entry.id, revision: entry.revision })) ??
				[]),
		])
			refutations.set(refKey(ref), { id: ref.id, revision: ref.revision });
		// Scope-wide, page-independent: an active claim is causally eligible
		// only while none of its refutations (own contradicts + every recorded
		// disputer) is a live head of the ledger.
		const causalEligible =
			entry.status === "active" &&
			![...refutations.values()].some((ref) => liveHead(ref));
		const payload = entry.assertion.payload;
		if (payload.kind === "relation")
			edges.push({
				edgeId: entry.id,
				revision: entry.revision,
				fromId: entry.subjectId,
				toId: payload.objectId,
				relation: payload.relation,
				assertionId: entry.id,
				assertionRevision: entry.revision,
				payloadJson: json({
					status: entry.status,
					causalEligible,
					condition: entry.assertion.condition,
					validTime: entry.assertion.validTime ?? null,
				}),
			});
		entries.push({
			assertionId: entry.id,
			assertionRevision: entry.revision,
			subjectId: entry.subjectId,
			predicate: entry.predicate,
			lifecycle: entry.status,
			causalEligible,
			payloadJson: json({
				status: entry.status,
				freshness: entry.freshness,
				origin: entry.origin,
				refutations: [...refutations.values()].sort(compareRef),
				sources: entry.sources.map(sourceIdentityKey),
			}),
		});
	}
	return { entries, edges };
}

/**
 * Pure projection of a whole (small) ledger: the same assertions always give
 * the same rows and material digest. Used by tests and restore checks to
 * compare against the stored, incrementally maintained projection.
 */
export function projectLedger(
	assertions: readonly Assertion[],
	scope: ScopeRef,
	context: ProjectContext,
	_scopeEpoch = 0,
): LedgerProjection {
	const disputers = disputersOf(assertions);
	const heads = new Map(assertions.map((a) => [a.id, a] as const));
	const liveHead: LiveHead = (ref) => {
		const head = heads.get(ref.id);
		return (
			head !== undefined &&
			head.revision === ref.revision &&
			!terminalSet.has(head.lifecycle)
		);
	};
	const entries: CurrentRow[] = [];
	const edges: EdgeRow[] = [];
	for (const group of consistentGroups(assertions)) {
		const rows = rowsOfGroup(group, scope, context, disputers, liveHead);
		entries.push(...rows.entries);
		edges.push(...rows.edges);
	}
	const byKey = (
		a: { assertionId: string; assertionRevision: number },
		b: typeof a,
	) =>
		a.assertionId === b.assertionId
			? a.assertionRevision - b.assertionRevision
			: a.assertionId < b.assertionId
				? -1
				: 1;
	entries.sort(byKey);
	edges.sort((a, b) =>
		a.edgeId === b.edgeId
			? a.revision - b.revision
			: a.edgeId < b.edgeId
				? -1
				: 1,
	);
	let sum = 0n;
	for (const assertion of assertions)
		sum += headHash(assertion, context.hasher);
	return { entries, edges, materialDigest: digestOf(sum) };
}

/** Drops repository bookkeeping so the value is a pure Assertion again. */
function pureAssertion(assertion: Assertion): Assertion {
	const { lastTransition: _bookkeeping, ...pure } = assertion as Assertion & {
		lastTransition?: unknown;
	};
	return pure as Assertion;
}

/** Thrown (before any DML of a rebuild) when the ledger exceeds the ceiling. */
export class LedgerTooLargeError extends WorldIntegrityError {
	constructor() {
		super("LEDGER_TOO_LARGE");
	}
}

/** A head moving from `old` (absent for a new assertion) to `next`. */
export interface HeadChange {
	readonly old?: Assertion;
	readonly next: Assertion;
}

/**
 * Updates the projection for the changed heads only: stale rows out, new rows
 * in, refutation lists of contradiction targets patched, then ONE epoch step.
 * Requires that contradiction targets exist (checked before the write), which
 * is what makes this equal to a full rebuild.
 */
export function applyHeadChanges(
	db: WorldDb,
	scope: ScopeRef,
	context: ProjectContext,
	rawChanges: readonly HeadChange[],
): { readonly epoch: number; readonly changed: boolean } {
	const changes = rawChanges.map((change) => ({
		...(change.old ? { old: pureAssertion(change.old) } : {}),
		next: pureAssertion(change.next),
	}));
	let sum = sumOf(getEpoch(db, scope)?.materialDigest);
	const removed: AssertionRef[] = [];
	// Rows whose eligibility may change: everything the old/new heads relate to.
	const affected = new Map<string, AssertionRef>();
	const touch = (ref: AssertionRef) =>
		affected.set(refKey(ref), { id: ref.id, revision: ref.revision });
	for (const { old, next } of changes) {
		if (old) {
			sum -= headHash(old, context.hasher);
			removed.push({ id: old.id, revision: old.revision });
			const row = getCurrentRow(db, scope, old.id, old.revision);
			if (row)
				for (const ref of (
					JSON.parse(row.payloadJson) as { refutations: AssertionRef[] }
				).refutations)
					touch(ref);
			for (const ref of old.contradicts) touch(ref);
		}
		for (const ref of next.contradicts) touch(ref);
		touch({ id: next.id, revision: next.revision });
		sum += headHash(next, context.hasher);
	}
	if (removed.length > 0) deleteProjectionFor(db, scope, removed);
	const liveHead = dbLiveHead(db, scope);
	for (const { next } of changes) {
		const rows = rowsOfGroup([next], scope, context, new Map(), liveHead);
		insertProjectionRows(db, scope, rows);
	}
	const patches: {
		target: AssertionRef;
		add?: AssertionRef;
		drop?: AssertionRef;
	}[] = [];
	for (const { old, next } of changes) {
		if (old)
			for (const target of old.contradicts)
				patches.push({ target, drop: { id: old.id, revision: old.revision } });
		for (const target of next.contradicts)
			patches.push({ target, add: { id: next.id, revision: next.revision } });
	}
	for (const { target, add, drop } of patches) {
		const row = getCurrentRow(db, scope, target.id, target.revision);
		if (!row) continue;
		const payload = JSON.parse(row.payloadJson) as {
			refutations: AssertionRef[];
		};
		const refutations = new Map(
			payload.refutations.map((ref) => [refKey(ref), ref] as const),
		);
		if (drop) refutations.delete(refKey(drop));
		if (add) refutations.set(refKey(add), add);
		const next = json({
			...payload,
			refutations: [...refutations.values()].sort(compareRef),
		});
		if (next !== row.payloadJson)
			updateCurrentPayload(db, scope, target.id, target.revision, next);
	}
	recomputeEligibility(db, scope, affected.values(), liveHead);
	return advanceProjectionEpoch(db, scope, digestOf(sum));
}

/** Re-derives causal eligibility of the named projected rows from the ledger. */
function recomputeEligibility(
	db: WorldDb,
	scope: ScopeRef,
	refs: Iterable<AssertionRef>,
	liveHead: LiveHead,
): void {
	for (const ref of refs) {
		const row = getCurrentRow(db, scope, ref.id, ref.revision);
		if (!row) continue;
		const refutations = (
			JSON.parse(row.payloadJson) as { refutations: AssertionRef[] }
		).refutations;
		const eligible =
			row.lifecycle === "active" && !refutations.some((r) => liveHead(r));
		if (eligible !== row.causalEligible)
			setCausalEligible(db, scope, ref.id, ref.revision, eligible);
	}
}

/**
 * Forget path: takes erased heads out of the projection incrementally (rows,
 * digest sum, refutation lists of their contradiction targets, one epoch
 * step) so a forget never needs a whole-Scope rebuild and cannot be blocked
 * by the ledger ceiling. Equal to a full rebuild of the remaining ledger.
 */
export function removeHeads(
	db: WorldDb,
	scope: ScopeRef,
	context: ProjectContext,
	rawHeads: readonly Assertion[],
): { readonly epoch: number; readonly changed: boolean } | undefined {
	if (rawHeads.length === 0) return undefined;
	const heads = rawHeads.map(pureAssertion);
	let sum = sumOf(getEpoch(db, scope)?.materialDigest);
	for (const head of heads) sum -= headHash(head, context.hasher);
	const affected = new Map<string, AssertionRef>();
	const touch = (ref: AssertionRef) =>
		affected.set(refKey(ref), { id: ref.id, revision: ref.revision });
	for (const head of heads) {
		const row = getCurrentRow(db, scope, head.id, head.revision);
		if (row)
			for (const ref of (
				JSON.parse(row.payloadJson) as { refutations: AssertionRef[] }
			).refutations)
				touch(ref);
		for (const ref of head.contradicts) touch(ref);
	}
	deleteProjectionFor(
		db,
		scope,
		heads.map((head) => ({ id: head.id, revision: head.revision })),
	);
	const erased = new Set(heads.map((head) => head.id));
	for (const head of heads)
		for (const target of head.contradicts) {
			if (erased.has(target.id)) continue;
			const row = getCurrentRow(db, scope, target.id, target.revision);
			if (!row) continue;
			const payload = JSON.parse(row.payloadJson) as {
				refutations: AssertionRef[];
			};
			const refutations = payload.refutations.filter(
				(ref) => !(ref.id === head.id && ref.revision === head.revision),
			);
			if (refutations.length === payload.refutations.length) continue;
			updateCurrentPayload(
				db,
				scope,
				target.id,
				target.revision,
				json({ ...payload, refutations }),
			);
		}
	recomputeEligibility(db, scope, affected.values(), dbLiveHead(db, scope));
	return advanceProjectionEpoch(db, scope, digestOf(sum));
}

/** True when some contradiction target is neither stored nor part of the same write. */
export function hasMissingContradictionTarget(
	db: WorldDb,
	scope: ScopeRef,
	assertions: readonly Assertion[],
): boolean {
	const inBatch = new Set(
		assertions.map((a) => refKey({ id: a.id, revision: a.revision })),
	);
	for (const assertion of assertions)
		for (const target of assertion.contradicts) {
			if (inBatch.has(refKey(target))) continue;
			if (!getAssertion(db, scope, target.id, target.revision)) return true;
		}
	return false;
}

const pageSize = 500;

/**
 * Rebuilds the Scope projection from the ledger with keyset paging, so memory
 * stays bounded by one page plus the (small) contradiction map. Throws on any
 * inconsistency or when the ledger exceeds the configured ceiling.
 */
export function rebuildProjection(
	db: WorldDb,
	scope: ScopeRef,
	context: ProjectContext,
	ceiling: number = maxLedgerAssertions,
): { readonly epoch: number; readonly changed: boolean } {
	let sum = 0n;
	let count = 0;
	const disputers = new Map<string, AssertionRef[]>();
	for (let after: string | undefined; ;) {
		const page = listScopeAssertions(db, scope, {
			limit: pageSize,
			...(after === undefined ? {} : { afterId: after }),
		});
		for (const assertion of page.items)
			sum += headHash(assertion, context.hasher);
		disputersOf(page.items, disputers);
		count += page.items.length;
		if (count > ceiling) throw new LedgerTooLargeError();
		if (!page.truncated) break;
		after = page.items.at(-1)!.id;
	}
	clearProjection(db, scope);
	const liveHead = dbLiveHead(db, scope);
	for (let after: string | undefined; ;) {
		const page = listScopeAssertions(db, scope, {
			limit: pageSize,
			...(after === undefined ? {} : { afterId: after }),
		});
		for (const group of consistentGroups(page.items))
			insertProjectionRows(
				db,
				scope,
				rowsOfGroup(group, scope, context, disputers, liveHead),
			);
		if (!page.truncated) break;
		after = page.items.at(-1)!.id;
	}
	return advanceProjectionEpoch(db, scope, digestOf(sum));
}
