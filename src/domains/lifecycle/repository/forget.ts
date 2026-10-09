import {
	checkId,
	checkScope,
	type DependentKind,
	type DependentRef,
	type ScopeRef,
} from "../../../contracts/index.ts";
import { checkTargetRef } from "./target-ref.ts";
import {
	expectChanges,
	requireTransaction,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";
import { tombstoneReasons, type TombstoneReason } from "./tombstones.ts";

/** Largest number of targets one forget chunk processes or one call reads. */
export const maxForgetChunk = 500;
/** Targets one call may persist (discovery of dependents is bounded too). */
export const maxForgetSave = 5000;

export interface ForgetOperation {
	readonly forgetId: string;
	readonly state: "pending" | "complete";
	readonly reasonCode: TombstoneReason;
	readonly chunks: number;
}
export type ForgetWriteResult =
	| { readonly status: "applied" | "unchanged" }
	| {
			readonly status: "rejected";
			readonly reasonCode:
				| "INVALID_INPUT"
				| "FORGET_REASON_CONFLICT"
				| "FORGET_NOT_FOUND"
				| "FORGET_ALREADY_COMPLETE"
				| "TARGETS_STILL_PENDING";
	  };

/**
 * Leaf-first processing order: a derived kind is processed before the kind it
 * is derived from, so a truncated reverse-dependency read always finds its
 * dependents ahead of it in the queue and the forget makes progress.
 */
const order =
	"CASE kind WHEN 'outcome' THEN 0 WHEN 'prediction' THEN 1 WHEN 'candidate' THEN 2 WHEN 'manifest' THEN 3 WHEN 'assertion' THEN 4 WHEN 'entity' THEN 5 WHEN 'projection' THEN 6 WHEN 'slice' THEN 7 WHEN 'state' THEN 8 ELSE 9 END";

type OperationRow = {
	forget_id: string;
	state: "pending" | "complete";
	reason_code: TombstoneReason;
	chunks: number;
};

export function getForget(
	db: WorldDb,
	scope: ScopeRef,
	forgetId: string,
): ForgetOperation | undefined {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	const row = db
		.query(
			"SELECT forget_id, state, reason_code, chunks FROM world_forget_operation WHERE principal = ? AND scope_key = ? AND forget_id = ?",
		)
		.get(scope.principal, scope.scopeKey, forgetId) as
		| OperationRow
		| null
		| undefined;
	return row
		? {
				forgetId: row.forget_id,
				state: row.state,
				reasonCode: row.reason_code,
				chunks: row.chunks,
			}
		: undefined;
}

/** Starts (or re-enters) a forget. A different reason under one id conflicts. */
export function beginForget(
	db: WorldDb,
	scope: ScopeRef,
	input: { readonly forgetId: string; readonly reasonCode: TombstoneReason },
): ForgetWriteResult {
	requireTransaction(db);
	if (
		!checkScope(scope).ok ||
		!checkId(input.forgetId).ok ||
		!tombstoneReasons.includes(input.reasonCode)
	)
		return { status: "rejected", reasonCode: "INVALID_INPUT" };
	const existing = getForget(db, scope, input.forgetId);
	if (existing)
		return existing.reasonCode === input.reasonCode
			? { status: "unchanged" }
			: { status: "rejected", reasonCode: "FORGET_REASON_CONFLICT" };
	expectChanges(
		db
			.query(
				"INSERT INTO world_forget_operation (principal, scope_key, forget_id, state, reason_code, chunks) VALUES (?, ?, ?, 'pending', ?, 0)",
			)
			.run(scope.principal, scope.scopeKey, input.forgetId, input.reasonCode),
		1,
		"FORGET_INSERT",
	);
	return { status: "applied" };
}

/** Counts a processed chunk. */
export function recordForgetChunk(
	db: WorldDb,
	scope: ScopeRef,
	forgetId: string,
): void {
	requireTransaction(db);
	expectChanges(
		db
			.query(
				"UPDATE world_forget_operation SET chunks = chunks + 1 WHERE principal = ? AND scope_key = ? AND forget_id = ? AND state = 'pending'",
			)
			.run(scope.principal, scope.scopeKey, forgetId),
		1,
		"FORGET_CHUNK",
	);
}

/**
 * Persists targets as pending, keyed by (forgetId, kind, id, revision). A
 * target that already exists in any state is left alone (never overwritten),
 * so a repeat or an overlapping discovery adds nothing. Returns rows added.
 */
export function saveForgetTargets(
	db: WorldDb,
	scope: ScopeRef,
	forgetId: string,
	refs: readonly DependentRef[],
): { readonly added: number } | { readonly rejected: "INVALID_INPUT" } {
	requireTransaction(db);
	if (
		!checkScope(scope).ok ||
		refs.length > maxForgetSave ||
		!refs.every((ref) => checkTargetRef(ref).ok)
	)
		return { rejected: "INVALID_INPUT" };
	if (!getForget(db, scope, forgetId)) return { rejected: "INVALID_INPUT" };
	let added = 0;
	const insert = db.query(
		"INSERT INTO world_forget_target (principal, scope_key, forget_id, kind, id, revision, state) VALUES (?, ?, ?, ?, ?, ?, 'pending') ON CONFLICT (principal, scope_key, forget_id, kind, id, revision) DO NOTHING",
	);
	for (const ref of refs)
		added += (
			insert.run(
				scope.principal,
				scope.scopeKey,
				forgetId,
				ref.kind,
				ref.id,
				ref.revision,
			) as { changes: number }
		).changes;
	return { added };
}

/** Next pending targets in leaf-first, then kind/id/revision order. */
export function listPendingTargets(
	db: WorldDb,
	scope: ScopeRef,
	forgetId: string,
	limit: number,
): readonly DependentRef[] {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxForgetChunk)
		throw new RangeError("limit");
	const rows = db
		.query(
			`SELECT kind, id, revision FROM world_forget_target WHERE principal = ? AND scope_key = ? AND forget_id = ? AND state = 'pending' ORDER BY ${order}, kind, id, revision LIMIT ?`,
		)
		.all(scope.principal, scope.scopeKey, forgetId, limit) as {
		kind: DependentKind;
		id: string;
		revision: number;
	}[];
	return rows;
}

export function countPendingTargets(
	db: WorldDb,
	scope: ScopeRef,
	forgetId: string,
): number {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	const row = db
		.query(
			"SELECT COUNT(*) AS n FROM world_forget_target WHERE principal = ? AND scope_key = ? AND forget_id = ? AND state = 'pending'",
		)
		.get(scope.principal, scope.scopeKey, forgetId) as { n: number };
	return row.n;
}

export function countDoneTargets(
	db: WorldDb,
	scope: ScopeRef,
	forgetId: string,
): number {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	const row = db
		.query(
			"SELECT COUNT(*) AS n FROM world_forget_target WHERE principal = ? AND scope_key = ? AND forget_id = ? AND state = 'done'",
		)
		.get(scope.principal, scope.scopeKey, forgetId) as { n: number };
	return row.n;
}

/** Each ref must be pending: a missing or already-done target is a bug. */
export function markTargetsDone(
	db: WorldDb,
	scope: ScopeRef,
	forgetId: string,
	refs: readonly DependentRef[],
): void {
	requireTransaction(db);
	if (!checkScope(scope).ok || refs.length > maxForgetChunk)
		throw new RangeError("invalid_input");
	const update = db.query(
		"UPDATE world_forget_target SET state = 'done' WHERE principal = ? AND scope_key = ? AND forget_id = ? AND kind = ? AND id = ? AND revision = ? AND state = 'pending'",
	);
	for (const ref of refs)
		expectChanges(
			update.run(
				scope.principal,
				scope.scopeKey,
				forgetId,
				ref.kind,
				ref.id,
				ref.revision,
			),
			1,
			"FORGET_TARGET_DONE",
		);
}

/** Complete only with zero pending targets left. */
export function completeForget(
	db: WorldDb,
	scope: ScopeRef,
	forgetId: string,
): ForgetWriteResult {
	requireTransaction(db);
	const existing = checkScope(scope).ok
		? getForget(db, scope, forgetId)
		: undefined;
	if (!existing) return { status: "rejected", reasonCode: "FORGET_NOT_FOUND" };
	if (existing.state === "complete") return { status: "unchanged" };
	if (countPendingTargets(db, scope, forgetId) > 0)
		return { status: "rejected", reasonCode: "TARGETS_STILL_PENDING" };
	expectChanges(
		db
			.query(
				"UPDATE world_forget_operation SET state = 'complete' WHERE principal = ? AND scope_key = ? AND forget_id = ? AND state = 'pending'",
			)
			.run(scope.principal, scope.scopeKey, forgetId),
		1,
		"FORGET_COMPLETE",
	);
	return { status: "applied" };
}

/** Pending targets across every forget of the Scope (restore completion gate). */
export function countAllPendingTargets(db: WorldDb, scope: ScopeRef): number {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	const row = db
		.query(
			"SELECT COUNT(*) AS n FROM world_forget_target WHERE principal = ? AND scope_key = ? AND state = 'pending'",
		)
		.get(scope.principal, scope.scopeKey) as { n: number };
	return row.n;
}

/** Ids of forgets that still have pending targets, bounded (restore resumes them). */
export function listPendingForgetIds(
	db: WorldDb,
	scope: ScopeRef,
	limit: number,
): string[] {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	const rows = db
		.query(
			`SELECT DISTINCT forget_id FROM world_forget_target
			 WHERE principal = ? AND scope_key = ? AND state = 'pending'
			 ORDER BY forget_id LIMIT ?`,
		)
		.all(scope.principal, scope.scopeKey, Math.max(1, Math.trunc(limit))) as {
		forget_id: string;
	}[];
	return rows.map((row) => row.forget_id);
}
