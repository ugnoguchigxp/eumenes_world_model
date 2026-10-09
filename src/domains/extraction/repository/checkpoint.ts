import {
	canonicalBytes,
	checkId,
	checkScope,
	type ScopeRef,
} from "../../../contracts/index.ts";
import {
	expectChanges,
	requireTransaction,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";

export const maxFeedScopeKeys = 64;

export interface FeedRef {
	/** Every Scope the feed spans; sorted and de-duplicated into the key. */
	readonly scopeKeys: readonly string[];
	readonly kind: string;
}
export interface Checkpoint {
	readonly feedKey: string;
	/** Intake position: last cursor durably accepted into the inbox. */
	readonly receivedCursor: string | null;
	/** Semantic position: last cursor whose events were applied/settled. */
	readonly appliedCursor: string | null;
	readonly restoreEpoch: string;
}
export type CheckpointRejectCode =
	| "INVALID_INPUT"
	| "STALE_RESTORE_EPOCH"
	| "APPLIED_WITHOUT_RECEIVED";
export type AdvanceCheckpointResult =
	| { readonly status: "advanced" | "unchanged" }
	| { readonly status: "rejected"; readonly reasonCode: CheckpointRejectCode };

const decoder = new TextDecoder();

/**
 * Feed key = principal + sorted Scope set + restoreEpoch + feed kind (C9).
 * Cursors are opaque to the World: they are stored, never incremented.
 */
export function feedKeyOf(
	principal: string,
	feed: FeedRef,
	restoreEpoch: string,
): string | undefined {
	if (
		!checkId(principal).ok ||
		!checkId(feed.kind).ok ||
		!checkId(restoreEpoch).ok ||
		!Array.isArray(feed.scopeKeys) ||
		feed.scopeKeys.length === 0 ||
		feed.scopeKeys.length > maxFeedScopeKeys ||
		!feed.scopeKeys.every((key) => checkId(key).ok)
	)
		return undefined;
	const scopeKeys = [...new Set(feed.scopeKeys)].sort();
	const bytes = canonicalBytes([principal, scopeKeys, restoreEpoch, feed.kind]);
	return bytes.ok ? decoder.decode(bytes.value) : undefined;
}

type Row = {
	feed_key: string;
	received_cursor: string | null;
	applied_cursor: string | null;
	restore_epoch: string;
};

export function getCheckpoint(
	db: WorldDb,
	scope: ScopeRef,
	feedKey: string,
): Checkpoint | undefined {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	const row = db
		.query(
			"SELECT feed_key, received_cursor, applied_cursor, restore_epoch FROM world_checkpoint WHERE principal = ? AND scope_key = ? AND feed_key = ?",
		)
		.get(scope.principal, scope.scopeKey, feedKey) as Row | null | undefined;
	return row
		? {
				feedKey: row.feed_key,
				receivedCursor: row.received_cursor,
				appliedCursor: row.applied_cursor,
				restoreEpoch: row.restore_epoch,
			}
		: undefined;
}

/** Checkpoints of many feed keys in few bounded queries (restore verification). */
export function getCheckpointsByKeys(
	db: WorldDb,
	scope: ScopeRef,
	feedKeys: readonly string[],
): ReadonlyMap<string, Checkpoint> {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	const found = new Map<string, Checkpoint>();
	for (let i = 0; i < feedKeys.length; i += 200) {
		const slice = feedKeys.slice(i, i + 200);
		const rows = db
			.query(
				`SELECT feed_key, received_cursor, applied_cursor, restore_epoch FROM world_checkpoint WHERE principal = ? AND scope_key = ? AND feed_key IN (${slice.map(() => "?").join(", ")})`,
			)
			.all(scope.principal, scope.scopeKey, ...slice) as Row[];
		for (const row of rows)
			found.set(row.feed_key, {
				feedKey: row.feed_key,
				receivedCursor: row.received_cursor,
				appliedCursor: row.applied_cursor,
				restoreEpoch: row.restore_epoch,
			});
	}
	return found;
}

export interface AdvanceCheckpointInput {
	readonly feed: FeedRef;
	/** The host's current restore epoch. */
	readonly restoreEpoch: string;
	/** The epoch under which the host issued the cursors being saved. */
	readonly cursorRestoreEpoch: string;
	readonly receivedCursor?: string;
	readonly appliedCursor?: string;
}

/**
 * Saves opaque cursors. A cursor issued under an older restoreEpoch is
 * refused; the intake and applied positions are separate columns. Atomicity
 * with the inbox row is the host transaction's job: a failed save rolls the
 * whole operation back so the intake cursor never advances alone.
 */
export function advanceCheckpoint(
	db: WorldDb,
	scope: ScopeRef,
	input: AdvanceCheckpointInput,
): AdvanceCheckpointResult {
	requireTransaction(db);
	const feedKey = feedKeyOf(scope.principal, input.feed, input.restoreEpoch);
	if (
		!checkScope(scope).ok ||
		feedKey === undefined ||
		!input.feed.scopeKeys.includes(scope.scopeKey) ||
		(input.receivedCursor === undefined && input.appliedCursor === undefined) ||
		(input.receivedCursor !== undefined &&
			!checkId(input.receivedCursor, "receivedCursor").ok) ||
		(input.appliedCursor !== undefined &&
			!checkId(input.appliedCursor, "appliedCursor").ok)
	)
		return { status: "rejected", reasonCode: "INVALID_INPUT" };
	if (input.cursorRestoreEpoch !== input.restoreEpoch)
		return { status: "rejected", reasonCode: "STALE_RESTORE_EPOCH" };
	const existing = getCheckpoint(db, scope, feedKey);
	if (!existing) {
		if (input.receivedCursor === undefined)
			return { status: "rejected", reasonCode: "APPLIED_WITHOUT_RECEIVED" };
		expectChanges(
			db
				.query(
					"INSERT INTO world_checkpoint (principal, scope_key, feed_key, received_cursor, applied_cursor, restore_epoch) VALUES (?, ?, ?, ?, ?, ?)",
				)
				.run(
					scope.principal,
					scope.scopeKey,
					feedKey,
					input.receivedCursor,
					input.appliedCursor ?? null,
					input.restoreEpoch,
				),
			1,
			"CHECKPOINT_INSERT",
		);
		return { status: "advanced" };
	}
	const received = input.receivedCursor ?? existing.receivedCursor;
	const applied = input.appliedCursor ?? existing.appliedCursor;
	if (
		received === existing.receivedCursor &&
		applied === existing.appliedCursor
	)
		return { status: "unchanged" };
	if (applied !== null && received === null)
		return { status: "rejected", reasonCode: "APPLIED_WITHOUT_RECEIVED" };
	expectChanges(
		db
			.query(
				"UPDATE world_checkpoint SET received_cursor = ?, applied_cursor = ? WHERE principal = ? AND scope_key = ? AND feed_key = ? AND restore_epoch = ?",
			)
			.run(
				received,
				applied,
				scope.principal,
				scope.scopeKey,
				feedKey,
				input.restoreEpoch,
			),
		1,
		"CHECKPOINT_UPDATE",
	);
	return { status: "advanced" };
}

/**
 * Restore: drops every feed cursor of the Scope (cursors from before a restore
 * must not be trusted). Returns the number of rows removed.
 */
export function discardCheckpoints(
	db: WorldDb,
	scope: ScopeRef,
): { readonly discarded: number } {
	requireTransaction(db);
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	const result = db
		.query("DELETE FROM world_checkpoint WHERE principal = ? AND scope_key = ?")
		.run(scope.principal, scope.scopeKey) as { changes: number };
	return { discarded: result.changes };
}
