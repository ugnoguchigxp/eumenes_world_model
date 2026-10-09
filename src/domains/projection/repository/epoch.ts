import {
	expectChanges,
	requireTransaction,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";
import { checkScope, type ScopeRef } from "../../../contracts/index.ts";
import { planScopeEpoch } from "../service/project.ts";

export interface EpochState {
	readonly epoch: number;
	readonly materialDigest: string;
}

/** Scope epoch; undefined when the Scope has never had any material. */
export function getEpoch(db: WorldDb, scope: ScopeRef): EpochState | undefined {
	const checked = checkScope(scope);
	if (!checked.ok) throw new RangeError("invalid_scope");
	const row = db
		.query(
			"SELECT epoch, material_digest FROM world_scope_epoch WHERE principal = ? AND scope_key = ?",
		)
		.get(scope.principal, scope.scopeKey) as
		| { epoch: number; material_digest: string }
		| null
		| undefined;
	// bun:sqlite returns null for no row.
	return row
		? { epoch: row.epoch, materialDigest: row.material_digest }
		: undefined;
}

/**
 * Advances the epoch iff the material digest changed. The first material of a
 * Scope yields epoch 1 (no row = epoch 0 with no digest). A replay of the same
 * change keeps the epoch. Caller must already have checked the transaction.
 */
export function advanceEpoch(
	db: WorldDb,
	scope: ScopeRef,
	materialDigest: string,
): { readonly epoch: number; readonly changed: boolean } {
	requireTransaction(db);
	const current = getEpoch(db, scope);
	const plan = planScopeEpoch(
		current?.epoch ?? 0,
		current?.materialDigest,
		materialDigest,
	);
	if (!plan.changed) return plan;
	if (current === undefined) {
		expectChanges(
			db
				.query(
					"INSERT INTO world_scope_epoch (principal, scope_key, epoch, material_digest) VALUES (?, ?, ?, ?)",
				)
				.run(scope.principal, scope.scopeKey, plan.epoch, materialDigest),
			1,
			"EPOCH_INSERT",
		);
	} else {
		expectChanges(
			db
				.query(
					"UPDATE world_scope_epoch SET epoch = ?, material_digest = ? WHERE principal = ? AND scope_key = ? AND epoch = ?",
				)
				.run(
					plan.epoch,
					materialDigest,
					scope.principal,
					scope.scopeKey,
					current.epoch,
				),
			1,
			"EPOCH_UPDATE",
		);
	}
	return plan;
}
