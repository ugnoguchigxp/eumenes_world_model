import {
	checkId,
	checkScope,
	type ScopeRef,
} from "../../../contracts/index.ts";
import {
	expectChanges,
	requireTransaction,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";

export interface GateState {
	readonly state: "open" | "closed";
	readonly reasonCode: string;
	readonly restoreEpoch: string;
}
export type GateWriteResult =
	| { readonly status: "applied" }
	| { readonly status: "rejected"; readonly reasonCode: "INVALID_INPUT" };

const bad = { status: "rejected", reasonCode: "INVALID_INPUT" } as const;

/** Stored gate row, or undefined. An absent row means the Scope was never closed. */
export function getGate(db: WorldDb, scope: ScopeRef): GateState | undefined {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	const row = db
		.query(
			"SELECT state, reason_code, restore_epoch FROM world_scope_gate WHERE principal = ? AND scope_key = ?",
		)
		.get(scope.principal, scope.scopeKey) as
		| { state: "open" | "closed"; reason_code: string; restore_epoch: string }
		| null
		| undefined;
	return row
		? {
				state: row.state,
				reasonCode: row.reason_code,
				restoreEpoch: row.restore_epoch,
			}
		: undefined;
}
/** Absent row = open. Anything but an explicit "open" row after a close is closed. */
export function isGateOpen(db: WorldDb, scope: ScopeRef): boolean {
	const gate = getGate(db, scope);
	return gate === undefined || gate.state === "open";
}

function write(
	db: WorldDb,
	scope: ScopeRef,
	state: "open" | "closed",
	reasonCode: string,
	restoreEpoch: string,
): GateWriteResult {
	requireTransaction(db);
	if (
		!checkScope(scope).ok ||
		!checkId(reasonCode).ok ||
		!checkId(restoreEpoch).ok
	)
		return bad;
	if (getGate(db, scope) === undefined) {
		expectChanges(
			db
				.query(
					"INSERT INTO world_scope_gate (principal, scope_key, state, reason_code, restore_epoch) VALUES (?, ?, ?, ?, ?)",
				)
				.run(scope.principal, scope.scopeKey, state, reasonCode, restoreEpoch),
			1,
			"GATE_INSERT",
		);
	} else {
		expectChanges(
			db
				.query(
					"UPDATE world_scope_gate SET state = ?, reason_code = ?, restore_epoch = ? WHERE principal = ? AND scope_key = ?",
				)
				.run(state, reasonCode, restoreEpoch, scope.principal, scope.scopeKey),
			1,
			"GATE_UPDATE",
		);
	}
	return { status: "applied" };
}

/** Idempotent: closing a closed gate only refreshes the reason/restore epoch. */
export const closeGate = (
	db: WorldDb,
	scope: ScopeRef,
	input: { readonly reasonCode: string; readonly restoreEpoch: string },
): GateWriteResult =>
	write(db, scope, "closed", input.reasonCode, input.restoreEpoch);
/** Reopening records the open state; reopening a never-closed Scope is a no-op row. */
export const openGate = (
	db: WorldDb,
	scope: ScopeRef,
	input: { readonly restoreEpoch: string },
): GateWriteResult => write(db, scope, "open", "REOPENED", input.restoreEpoch);
