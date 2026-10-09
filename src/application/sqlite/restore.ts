import {
	asRecord,
	canonicalDigest,
	checkId,
	firstUnknownKey,
	type CanonicalHasher,
	type DependentRef,
	type ScopeRef,
} from "../../contracts/index.ts";
import {
	listAssertionsBySourceKeys,
	listInputSourceKeys,
} from "../../domains/assertions/sqlite.ts";
import {
	advanceCheckpoint,
	discardCheckpoints,
	feedKeyOf,
	releaseUnsettledInbox,
	getCheckpoint,
	getCheckpointsByKeys,
	listManifestSourceKeys,
	listManifestsBySourceKeys,
	type Checkpoint,
	type FeedRef,
} from "../../domains/extraction/sqlite.ts";
import {
	checkTargetRef,
	closeGate,
	countAllPendingTargets,
	getGate,
	listTombstones,
	openGate,
	tombstoneReasons,
	type TombstoneReason,
	type TombstoneTarget,
} from "../../domains/lifecycle/sqlite.ts";
import {
	WorldIntegrityError,
	type WorldDb,
} from "../../infrastructure/sqlite/db.ts";
import { rejectedResult } from "./checks.ts";
import { applyForget } from "./forget.ts";
import { LedgerTooLargeError, rebuildProjection } from "./projection.ts";
import {
	RESTORE_GATE_REASON,
	type HostChecks,
	type RegistrationStatus,
	type RestoreProgress,
	type WorldOperation,
} from "./types.ts";

type Op = Extract<
	WorldOperation,
	{
		kind:
			| "restore.begin"
			| "restore.register"
			| "restore.reconcile"
			| "restore.finish"
			| "rebuild";
	}
>;
export type Refusal = {
	readonly status: "rejected" | "blocked";
	readonly reasonCode: string;
	readonly restore?: RestoreProgress;
};
interface Context {
	readonly hasher: CanonicalHasher;
	readonly clock: number;
	readonly hostChecks: HostChecks;
}

export { RESTORE_GATE_REASON };
export const maxRegistrations = 200;
export const maxJournalTombstones = 200;
/**
 * One restore.finish verifies at most this many distinct dependency keys
 * (bulk-read in pages of 500). More is a stated limit, not a hang.
 */
export const maxVerifiedDependencies = 1_000_000;
const pageSize = 500;

const blocked = (reasonCode: string, restore?: RestoreProgress): Refusal =>
	restore
		? { status: "blocked", reasonCode, restore }
		: { status: "blocked", reasonCode };

/** SQLite orders TEXT by UTF-8 bytes, so keys are compared the same way. */
const encoder = new TextEncoder();
function compareKeys(a: string, b: string): number {
	const x = encoder.encode(a);
	const y = encoder.encode(b);
	const n = Math.min(x.length, y.length);
	for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
	return x.length - y.length;
}

// --- persisted restore state (opaque cursors in world_checkpoint) -----------

const journalFeed = (scope: ScopeRef): FeedRef => ({
	scopeKeys: [scope.scopeKey],
	kind: "restore-journal",
});
function journalOf(
	db: WorldDb,
	scope: ScopeRef,
	epoch: string,
): Checkpoint | undefined {
	const key = feedKeyOf(scope.principal, journalFeed(scope), epoch);
	return key === undefined ? undefined : getCheckpoint(db, scope, key);
}
/** Dependency feed kinds use a digest, so long source keys fit the ID limit. */
function dependencyFeed(
	scope: ScopeRef,
	sourceKey: string,
	hasher: CanonicalHasher,
): FeedRef {
	const digest = canonicalDigest(["restore-dep", sourceKey], hasher);
	if (!digest.ok) throw new WorldIntegrityError("RESTORE_DEPENDENCY_DIGEST");
	return {
		scopeKeys: [scope.scopeKey],
		kind: `restore-dep:${digest.value.slice("sha256:".length)}`,
	};
}
function saveCursor(
	db: WorldDb,
	scope: ScopeRef,
	feed: FeedRef,
	epoch: string,
	cursors: { receivedCursor?: string; appliedCursor?: string },
): void {
	const result = advanceCheckpoint(db, scope, {
		feed,
		restoreEpoch: epoch,
		cursorRestoreEpoch: epoch,
		...cursors,
	});
	if (result.status === "rejected")
		throw new WorldIntegrityError(`RESTORE_CURSOR:${result.reasonCode}`);
}

function inProgress(db: WorldDb, scope: ScopeRef, hostChecks: HostChecks) {
	const gate = getGate(db, scope);
	return (
		gate !== undefined &&
		gate.state === "closed" &&
		gate.reasonCode === RESTORE_GATE_REASON &&
		gate.restoreEpoch === hostChecks.restoreEpoch
	);
}
const holdGate = (db: WorldDb, scope: ScopeRef, hostChecks: HostChecks) => {
	const result = closeGate(db, scope, {
		reasonCode: RESTORE_GATE_REASON,
		restoreEpoch: hostChecks.restoreEpoch,
	});
	if (result.status !== "applied")
		throw new WorldIntegrityError("RESTORE_GATE");
};

// --- the dependencies the ledger itself records -----------------------------

/** Sorted distinct keys after `after`: the union of assertion and manifest dependencies. */
function nextDependencyKeys(
	db: WorldDb,
	scope: ScopeRef,
	after: string | undefined,
): string[] {
	const page = after === undefined ? {} : { afterKey: after };
	const merged = new Set([
		...listInputSourceKeys(db, scope, { ...page, limit: pageSize }),
		...listManifestSourceKeys(db, scope, { ...page, limit: pageSize }),
	]);
	return [...merged].sort(compareKeys).slice(0, pageSize);
}
const inLedger = (db: WorldDb, scope: ScopeRef, key: string): boolean =>
	listAssertionsBySourceKeys(db, scope, [key], 1).refs.length > 0 ||
	listManifestsBySourceKeys(db, scope, [key], 1).manifestIds.length > 0;

/** Tombstoned dependencies count as accounted (their derived items are gone). */
function tombstonedKeys(
	db: WorldDb,
	scope: ScopeRef,
	keys: readonly string[],
): Set<string> {
	const found = new Set<string>();
	for (let i = 0; i < keys.length; i += 200) {
		const slice = keys.slice(i, i + 200);
		const targets: TombstoneTarget[] = slice.flatMap((id) => [
			{ kind: "source", id },
			{ kind: "state", id },
		]);
		for (const tombstone of listTombstones(db, scope, targets))
			found.add(tombstone.id);
	}
	return found;
}

/**
 * Every recorded dependency must be registered or tombstoned. Walks the whole
 * ledger set (never just the edges an old database still remembers).
 */
function countUnaccounted(
	db: WorldDb,
	scope: ScopeRef,
	context: Context,
	ceiling: number = maxVerifiedDependencies,
): { unaccounted: number; tooLarge: boolean } {
	let after: string | undefined;
	let seen = 0;
	let unaccounted = 0;
	for (;;) {
		const keys = nextDependencyKeys(db, scope, after);
		if (keys.length === 0) return { unaccounted, tooLarge: false };
		seen += keys.length;
		if (seen > ceiling) return { unaccounted, tooLarge: true };
		const tombstoned = tombstonedKeys(db, scope, keys);
		const open = keys.filter((key) => !tombstoned.has(key));
		const feedKeys = new Map(
			open.map((key) => [
				feedKeyOf(
					scope.principal,
					dependencyFeed(scope, key, context.hasher),
					context.hostChecks.restoreEpoch,
				)!,
				key,
			]),
		);
		const registered = getCheckpointsByKeys(db, scope, [...feedKeys.keys()]);
		for (const feedKey of feedKeys.keys())
			if (registered.get(feedKey)?.receivedCursor !== "registered")
				unaccounted++;
		after = keys[keys.length - 1];
	}
}

/** Test seam: the same verification with an explicit ceiling. */
export const verifyDependencies = countUnaccounted;

// --- input parsing -----------------------------------------------------------

const registrationStatuses: readonly RegistrationStatus[] = [
	"registered",
	"unknown",
	"tombstoned",
];
interface Registration {
	readonly sourceKey: string;
	readonly status: RegistrationStatus;
}
function parseRegistrations(value: unknown): Registration[] | undefined {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > maxRegistrations
	)
		return undefined;
	const seen = new Set<string>();
	const out: Registration[] = [];
	for (const raw of value) {
		const item = asRecord(raw);
		if (
			!item ||
			firstUnknownKey(item, ["sourceKey", "status"]) !== undefined ||
			typeof item["sourceKey"] !== "string" ||
			item["sourceKey"].length === 0 ||
			!registrationStatuses.includes(item["status"] as RegistrationStatus) ||
			seen.has(item["sourceKey"])
		)
			return undefined;
		seen.add(item["sourceKey"]);
		out.push({
			sourceKey: item["sourceKey"],
			status: item["status"] as RegistrationStatus,
		});
	}
	return out;
}

interface JournalTombstone {
	readonly ref: DependentRef;
	readonly forgetId: string;
	readonly reasonCode: TombstoneReason;
}
interface Journal {
	readonly seq: number;
	readonly final: boolean;
	readonly tombstones: JournalTombstone[];
}
function parseJournal(value: unknown): Journal | undefined {
	const object = asRecord(value);
	if (
		!object ||
		firstUnknownKey(object, ["seq", "final", "tombstones"]) !== undefined ||
		typeof object["seq"] !== "number" ||
		!Number.isSafeInteger(object["seq"]) ||
		object["seq"] < 0 ||
		typeof object["final"] !== "boolean" ||
		!Array.isArray(object["tombstones"]) ||
		object["tombstones"].length > maxJournalTombstones
	)
		return undefined;
	const tombstones: JournalTombstone[] = [];
	for (const raw of object["tombstones"]) {
		const item = asRecord(raw);
		if (
			!item ||
			firstUnknownKey(item, ["ref", "forgetId", "reasonCode"]) !== undefined ||
			!checkId(item["forgetId"]).ok ||
			!tombstoneReasons.includes(item["reasonCode"] as TombstoneReason)
		)
			return undefined;
		const ref = checkTargetRef(item["ref"]);
		if (!ref.ok) return undefined;
		tombstones.push({
			ref: ref.value,
			forgetId: item["forgetId"] as string,
			reasonCode: item["reasonCode"] as TombstoneReason,
		});
	}
	return {
		seq: object["seq"],
		final: object["final"],
		tombstones,
	};
}

const sortRefs = (refs: readonly DependentRef[]) =>
	[...refs].sort(
		(a, b) =>
			compareKeys(a.kind, b.kind) ||
			compareKeys(a.id, b.id) ||
			a.revision - b.revision,
	);

/**
 * Derived forget IDs are deterministic functions of the epoch and the exact
 * root set, so a repeat of one page resumes the same forget, while a later page
 * never lands in an already completed forget (which would ignore its roots).
 */
function derivedForgetId(
	parts: readonly unknown[],
	hasher: CanonicalHasher,
): string {
	const digest = canonicalDigest(parts, hasher);
	if (!digest.ok) throw new WorldIntegrityError("RESTORE_FORGET_ID");
	return `restore-${digest.value.slice("sha256:".length, "sha256:".length + 40)}`;
}

function groupJournal(
	journal: Journal,
): Map<
	string,
	{ reasonCode: TombstoneReason; forgetId: string; refs: DependentRef[] }
> {
	const groups = new Map<
		string,
		{ reasonCode: TombstoneReason; forgetId: string; refs: DependentRef[] }
	>();
	for (const entry of journal.tombstones) {
		const key = JSON.stringify([entry.forgetId, entry.reasonCode]);
		const group = groups.get(key) ?? {
			reasonCode: entry.reasonCode,
			forgetId: entry.forgetId,
			refs: [],
		};
		group.refs.push(entry.ref);
		groups.set(key, group);
	}
	return new Map([...groups.entries()].sort(([a], [b]) => compareKeys(a, b)));
}

// --- precheck: reads only, every foreseeable refusal before the first DML ----

export function precheckRestore(
	db: WorldDb,
	op: Op,
	scope: ScopeRef,
	context: Context,
): Refusal | null {
	const epoch = context.hostChecks.restoreEpoch;
	switch (op.kind) {
		case "restore.begin":
			return null;
		case "rebuild":
			return null;
		case "restore.register": {
			if (!inProgress(db, scope, context.hostChecks))
				return blocked("RESTORE_NOT_IN_PROGRESS");
			const registrations = parseRegistrations(op.registrations);
			if (!registrations) return rejectedResult("INVALID_INPUT");
			for (const item of registrations)
				if (!inLedger(db, scope, item.sourceKey))
					return rejectedResult("DEPENDENCY_NOT_IN_LEDGER");
			return null;
		}
		case "restore.reconcile": {
			if (!inProgress(db, scope, context.hostChecks))
				return blocked("RESTORE_NOT_IN_PROGRESS");
			const journal = parseJournal(op.journal);
			if (!journal) return rejectedResult("INVALID_INPUT");
			const lastSeen = journalOf(db, scope, epoch)?.receivedCursor;
			if (lastSeen != null && journal.seq < Number(lastSeen))
				return blocked("JOURNAL_ROLLED_BACK");
			return null;
		}
		case "restore.finish": {
			if (!inProgress(db, scope, context.hostChecks))
				return blocked("RESTORE_NOT_IN_PROGRESS");
			const journal = journalOf(db, scope, epoch);
			if (
				!journal ||
				journal.receivedCursor === null ||
				journal.appliedCursor !== `reconciled:${journal.receivedCursor}`
			)
				return blocked("JOURNAL_NOT_RECONCILED");
			const pendingForget = countAllPendingTargets(db, scope);
			if (pendingForget > 0)
				return blocked("FORGET_PENDING", { state: "pending", pendingForget });
			const counted = countUnaccounted(db, scope, context);
			if (counted.tooLarge) return blocked("VERIFICATION_TOO_LARGE");
			if (counted.unaccounted > 0)
				return blocked("DEPENDENCIES_UNACCOUNTED", {
					state: "pending",
					unaccounted: counted.unaccounted,
				});
			return null;
		}
	}
}

// --- apply -------------------------------------------------------------------

function forgetBatch(
	db: WorldDb,
	scope: ScopeRef,
	context: Context,
	forgetId: string,
	reasonCode: TombstoneReason,
	refs: readonly DependentRef[],
): void {
	const rejected = applyForget(
		db,
		{ kind: "forget.chunk", forgetId, reasonCode, roots: sortRefs(refs) },
		scope,
		context,
	);
	if (rejected)
		throw new WorldIntegrityError(`RESTORE_FORGET:${rejected.reasonCode}`);
}

/** A ledger beyond the ceiling is refused (blocked), never thrown after DML. */
function rebuildOrRefuse(
	db: WorldDb,
	scope: ScopeRef,
	context: Context,
): Refusal | null {
	try {
		rebuildProjection(db, scope, context);
		return null;
	} catch (error) {
		if (error instanceof LedgerTooLargeError)
			return { status: "blocked", reasonCode: "LEDGER_TOO_LARGE" };
		throw error;
	}
}

export function applyRestore(
	db: WorldDb,
	op: Op,
	scope: ScopeRef,
	context: Context,
): Refusal | null {
	const epoch = context.hostChecks.restoreEpoch;
	switch (op.kind) {
		case "rebuild":
			return rebuildOrRefuse(db, scope, context);
		case "restore.begin": {
			if (inProgress(db, scope, context.hostChecks)) return null;
			// The journal position seen before this restore survives it: it is
			// the only defence against reading a rolled-back journal.
			const previous = getGate(db, scope)?.restoreEpoch;
			const lastSeen =
				journalOf(db, scope, previous ?? epoch)?.receivedCursor ??
				journalOf(db, scope, epoch)?.receivedCursor ??
				null;
			discardCheckpoints(db, scope);
			releaseUnsettledInbox(db, scope);
			holdGate(db, scope, context.hostChecks);
			if (lastSeen !== null)
				saveCursor(db, scope, journalFeed(scope), epoch, {
					receivedCursor: lastSeen,
				});
			return null;
		}
		case "restore.register": {
			const registrations = parseRegistrations(op.registrations)!;
			const gone: DependentRef[] = [];
			for (const item of registrations) {
				if (item.status === "registered")
					saveCursor(
						db,
						scope,
						dependencyFeed(scope, item.sourceKey, context.hasher),
						epoch,
						{ receivedCursor: "registered" },
					);
				else if (item.status === "tombstoned")
					gone.push({ kind: "source", id: item.sourceKey, revision: 1 });
			}
			// Externally tombstoned is never "registered": derived items go.
			if (gone.length > 0)
				forgetBatch(
					db,
					scope,
					context,
					derivedForgetId(["register", epoch, sortRefs(gone)], context.hasher),
					"SOURCE_FORGOTTEN",
					gone,
				);
			holdGate(db, scope, context.hostChecks);
			return null;
		}
		case "restore.reconcile": {
			const journal = parseJournal(op.journal)!;
			// Re-apply the newest tombstones; an older database never un-forgets.
			for (const group of groupJournal(journal).values())
				forgetBatch(
					db,
					scope,
					context,
					derivedForgetId(
						[
							"journal",
							epoch,
							group.forgetId,
							group.reasonCode,
							sortRefs(group.refs),
						],
						context.hasher,
					),
					group.reasonCode,
					group.refs,
				);
			saveCursor(db, scope, journalFeed(scope), epoch, {
				receivedCursor: String(journal.seq),
			});
			if (journal.final && countAllPendingTargets(db, scope) === 0)
				saveCursor(db, scope, journalFeed(scope), epoch, {
					appliedCursor: `reconciled:${journal.seq}`,
				});
			holdGate(db, scope, context.hostChecks);
			return null;
		}
		case "restore.finish": {
			// Nothing was written before the (read-only) size pass: a refusal here
			// leaves the gate closed and the ledger untouched.
			const refused = rebuildOrRefuse(db, scope, context);
			if (refused) return refused;
			const opened = openGate(db, scope, { restoreEpoch: epoch });
			if (opened.status !== "applied")
				throw new WorldIntegrityError("RESTORE_REOPEN");
			return null;
		}
	}
}

/** Counts and state only. */
export function restoreProgress(
	db: WorldDb,
	op: WorldOperation,
	scope: ScopeRef,
): RestoreProgress | undefined {
	switch (op.kind) {
		case "restore.finish":
			return { state: "complete" };
		case "restore.begin":
			return { state: "pending" };
		case "restore.register":
			return {
				state: "pending",
				pendingForget: countAllPendingTargets(db, scope),
				unknown: op.registrations.filter((item) => item.status === "unknown")
					.length,
			};
		case "restore.reconcile":
			return {
				state: "pending",
				pendingForget: countAllPendingTargets(db, scope),
			};
		default:
			return undefined;
	}
}
