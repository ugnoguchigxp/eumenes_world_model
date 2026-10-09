import {
	checkId,
	checkScope,
	type DependentKind,
	type ScopeRef,
} from "../../../contracts/index.ts";
import { checkTargetRef } from "./target-ref.ts";
import {
	expectChanges,
	requireTransaction,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";

export const tombstoneReasons = [
	"FORGET_REQUESTED",
	"SOURCE_FORGOTTEN",
	"CORRECTION_APPLIED",
	"AUTHORIZATION_REVOKED",
] as const;
export type TombstoneReason = (typeof tombstoneReasons)[number];
export const maxTombstoneLookup = 500;

export interface Tombstone {
	readonly kind: DependentKind;
	readonly id: string;
	readonly forgetId: string;
	readonly reasonCode: TombstoneReason;
}
export interface TombstoneTarget {
	readonly kind: DependentKind;
	readonly id: string;
}
export type InsertTombstoneResult =
	| { readonly status: "inserted" | "unchanged" }
	| {
			readonly status: "rejected";
			readonly reasonCode: "INVALID_INPUT" | "TOMBSTONE_CONFLICT";
	  };

type Row = {
	kind: DependentKind;
	id: string;
	forget_id: string;
	reason_code: TombstoneReason;
};
const fromRow = (row: Row): Tombstone => ({
	kind: row.kind,
	id: row.id,
	forgetId: row.forget_id,
	reasonCode: row.reason_code,
});

export function getTombstone(
	db: WorldDb,
	scope: ScopeRef,
	target: TombstoneTarget,
): Tombstone | undefined {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	const row = db
		.query(
			"SELECT kind, id, forget_id, reason_code FROM world_tombstone WHERE principal = ? AND scope_key = ? AND kind = ? AND id = ?",
		)
		.get(scope.principal, scope.scopeKey, target.kind, target.id) as
		| Row
		| null
		| undefined;
	return row ? fromRow(row) : undefined;
}

/** Tombstones among at most 500 targets; one bound lookup per target. */
export function listTombstones(
	db: WorldDb,
	scope: ScopeRef,
	targets: readonly TombstoneTarget[],
): readonly Tombstone[] {
	if (targets.length > maxTombstoneLookup) throw new RangeError("limit");
	return targets.flatMap((target) => getTombstone(db, scope, target) ?? []);
}

/**
 * Re-appearance guard record: kind/id/forgetId/enum reason only. The same
 * target is idempotent ("unchanged"); a tombstone is never rewritten.
 */
export function insertTombstone(
	db: WorldDb,
	scope: ScopeRef,
	tombstone: Tombstone,
): InsertTombstoneResult {
	requireTransaction(db);
	const ref = checkTargetRef({
		kind: tombstone.kind,
		id: tombstone.id,
		revision: 1,
	});
	if (
		!checkScope(scope).ok ||
		!ref.ok ||
		!checkId(tombstone.forgetId).ok ||
		!tombstoneReasons.includes(tombstone.reasonCode)
	)
		return { status: "rejected", reasonCode: "INVALID_INPUT" };
	const existing = getTombstone(db, scope, tombstone);
	if (existing)
		return existing.forgetId === tombstone.forgetId &&
			existing.reasonCode === tombstone.reasonCode
			? { status: "unchanged" }
			: { status: "rejected", reasonCode: "TOMBSTONE_CONFLICT" };
	expectChanges(
		db
			.query(
				"INSERT INTO world_tombstone (principal, scope_key, kind, id, forget_id, reason_code) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run(
				scope.principal,
				scope.scopeKey,
				tombstone.kind,
				tombstone.id,
				tombstone.forgetId,
				tombstone.reasonCode,
			),
		1,
		"TOMBSTONE_INSERT",
	);
	return { status: "inserted" };
}
