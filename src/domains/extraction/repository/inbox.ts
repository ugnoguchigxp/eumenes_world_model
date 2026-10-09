import {
	canonicalBytes,
	checkId,
	checkOpaque,
	checkScope,
	type ScopeRef,
} from "../../../contracts/index.ts";
import {
	expectChanges,
	requireTransaction,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";

export const inboxStatuses = [
	"received",
	"applied",
	"held",
	"rejected",
] as const;
export type InboxStatus = (typeof inboxStatuses)[number];
export const maxInboxPage = 500;
export const maxInboxDelete = 500;

export interface InboxEvent {
	readonly eventId: string;
	readonly feedKey: string;
	/** Gaps are legal (100 -> 105); the World never infers seq + 1. */
	readonly seq: number;
	readonly status: InboxStatus;
	readonly payloadJson: string;
}
export interface NewInboxEvent {
	readonly eventId: string;
	readonly feedKey: string;
	readonly seq: number;
	readonly payload: unknown;
}
export type InboxRejectCode =
	| "INVALID_INPUT"
	| "EVENT_CONFLICT"
	| "EVENT_NOT_FOUND"
	| "INVALID_TRANSITION";
export type InboxResult =
	| { readonly status: "inserted" | "unchanged" | "updated" }
	| { readonly status: "rejected"; readonly reasonCode: InboxRejectCode };

const decoder = new TextDecoder();
type Row = {
	event_id: string;
	feed_key: string;
	seq: number;
	status: InboxStatus;
	payload_json: string;
};
const fromRow = (row: Row): InboxEvent => ({
	eventId: row.event_id,
	feedKey: row.feed_key,
	seq: row.seq,
	status: row.status,
	payloadJson: row.payload_json,
});
const columns = "event_id, feed_key, seq, status, payload_json";

export function getInbox(
	db: WorldDb,
	scope: ScopeRef,
	eventId: string,
): InboxEvent | undefined {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	const row = db
		.query(
			`SELECT ${columns} FROM world_inbox WHERE principal = ? AND scope_key = ? AND event_id = ?`,
		)
		.get(scope.principal, scope.scopeKey, eventId) as Row | null | undefined;
	return row ? fromRow(row) : undefined;
}

/** Events of one feed after `afterSeq`, bounded by limit + 1 sentinel. */
export function listInboxByFeed(
	db: WorldDb,
	scope: ScopeRef,
	feedKey: string,
	options: { afterSeq?: number; limit: number },
): { readonly items: readonly InboxEvent[]; readonly truncated: boolean } {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	if (
		!Number.isSafeInteger(options.limit) ||
		options.limit < 1 ||
		options.limit > maxInboxPage
	)
		throw new RangeError("limit");
	const rows = db
		.query(
			`SELECT ${columns} FROM world_inbox WHERE principal = ? AND scope_key = ? AND feed_key = ? AND seq > ? ORDER BY seq, event_id LIMIT ?`,
		)
		.all(
			scope.principal,
			scope.scopeKey,
			feedKey,
			options.afterSeq ?? Number.MIN_SAFE_INTEGER,
			options.limit + 1,
		) as Row[];
	return {
		items: rows.slice(0, options.limit).map(fromRow),
		truncated: rows.length > options.limit,
	};
}

/**
 * Durable intake. The same eventId with the same content is "unchanged"
 * (duplicate receipt adds no row); different content is a conflict.
 */
export function recordInbox(
	db: WorldDb,
	scope: ScopeRef,
	event: NewInboxEvent,
): InboxResult {
	requireTransaction(db);
	const payload = canonicalBytes(event.payload);
	if (
		!checkScope(scope).ok ||
		!checkId(event.eventId).ok ||
		!checkOpaque(event.feedKey, "feedKey", 4096).ok ||
		!Number.isSafeInteger(event.seq) ||
		!payload.ok
	)
		return { status: "rejected", reasonCode: "INVALID_INPUT" };
	const payloadJson = decoder.decode(payload.value);
	const existing = getInbox(db, scope, event.eventId);
	// A final event (applied/rejected) is recognised as a duplicate by eventId and
	// content alone, so a re-delivery under a new restore epoch (new feed key and
	// sequence) is skipped rather than reported as a conflict.
	if (
		existing &&
		(existing.status === "applied" || existing.status === "rejected") &&
		existing.payloadJson === payloadJson
	)
		return { status: "unchanged" };
	if (existing)
		return existing.feedKey === event.feedKey &&
			existing.seq === event.seq &&
			existing.payloadJson === payloadJson
			? { status: "unchanged" }
			: { status: "rejected", reasonCode: "EVENT_CONFLICT" };
	expectChanges(
		db
			.query(
				"INSERT INTO world_inbox (principal, scope_key, event_id, feed_key, seq, status, payload_json) VALUES (?, ?, ?, ?, ?, 'received', ?)",
			)
			.run(
				scope.principal,
				scope.scopeKey,
				event.eventId,
				event.feedKey,
				event.seq,
				payloadJson,
			),
		1,
		"INBOX_INSERT",
	);
	return { status: "inserted" };
}

const allowedNext: Readonly<Record<InboxStatus, readonly InboxStatus[]>> = {
	received: ["applied", "held", "rejected"],
	held: ["applied", "rejected"],
	applied: [],
	rejected: [],
};

/** received/held -> applied|held|rejected; applied and rejected are final. */
export function markInbox(
	db: WorldDb,
	scope: ScopeRef,
	eventId: string,
	next: InboxStatus,
): InboxResult {
	requireTransaction(db);
	if (!checkScope(scope).ok || !checkId(eventId).ok || next === "received")
		return { status: "rejected", reasonCode: "INVALID_INPUT" };
	const existing = getInbox(db, scope, eventId);
	if (!existing) return { status: "rejected", reasonCode: "EVENT_NOT_FOUND" };
	if (existing.status === next) return { status: "unchanged" };
	if (!allowedNext[existing.status].includes(next))
		return { status: "rejected", reasonCode: "INVALID_TRANSITION" };
	expectChanges(
		db
			.query(
				"UPDATE world_inbox SET status = ? WHERE principal = ? AND scope_key = ? AND event_id = ? AND status = ?",
			)
			.run(next, scope.principal, scope.scopeKey, eventId, existing.status),
		1,
		"INBOX_UPDATE",
	);
	return { status: "updated" };
}

/** Forget: removes events including their payload. Missing ids are fine. */
export function deleteInbox(
	db: WorldDb,
	scope: ScopeRef,
	eventIds: readonly string[],
): { readonly deleted: number } {
	requireTransaction(db);
	if (!checkScope(scope).ok || eventIds.length > maxInboxDelete)
		throw new RangeError("invalid_delete");
	let deleted = 0;
	for (const eventId of eventIds) {
		const result = db
			.query(
				"DELETE FROM world_inbox WHERE principal = ? AND scope_key = ? AND event_id = ?",
			)
			.run(scope.principal, scope.scopeKey, eventId) as { changes: number };
		deleted += result.changes;
	}
	return { deleted };
}

/**
 * Restore: events that were received or held under the pre-restore feed can no
 * longer be settled (their feed key embeds the old restore epoch). They are
 * deleted WITH their payload; the host re-delivers them from the reset cursor.
 * Applied and rejected events are final and stay (as duplicate guards).
 */
export function releaseUnsettledInbox(
	db: WorldDb,
	scope: ScopeRef,
): { readonly released: number } {
	requireTransaction(db);
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	const result = db
		.query(
			"DELETE FROM world_inbox WHERE principal = ? AND scope_key = ? AND status IN ('received', 'held')",
		)
		.run(scope.principal, scope.scopeKey) as { changes: number };
	return { released: result.changes };
}
