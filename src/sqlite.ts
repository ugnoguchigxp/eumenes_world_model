/** Borrowed-connection surface. No connection is opened on import. */
export type {
	WorldDb,
	WorldStatement,
	SqlValue,
} from "./infrastructure/sqlite/db.ts";
export { migrations } from "./infrastructure/sqlite/migrations/index.ts";
export {
	WorldIntegrityError,
	WorldTransactionRequiredError,
} from "./infrastructure/sqlite/db.ts";
import type { WorldDb } from "./infrastructure/sqlite/db.ts";
import { schemaCompatibility } from "./infrastructure/sqlite/migrations/gate.ts";
import {
	applyWorldOperation as applyCoordinated,
	readAssertionHistory as readHistoryCoordinated,
	listEntities as listEntitiesCoordinated,
	readWorldSnapshot as readCoordinated,
	validateWorldUsage as validateCoordinated,
	type ApplyDeps,
	type ListEntitiesResult,
	type WorldHistoryResult,
	type WorldOperationResult,
	type WorldSnapshotResult,
	type WorldUsageResult,
} from "./application/sqlite/index.ts";
/**
 * The only update/read surface: coordinated operations, no raw repositories.
 * Every entry point first checks, in the host's transaction, that the schema
 * matches the pinned migrations; otherwise it answers blocked/SCHEMA_INCOMPATIBLE
 * without touching any World table. Applying migrations stays host-owned.
 */
const schemaBlocked = {
	status: "blocked",
	reasonCode: "SCHEMA_INCOMPATIBLE",
} as const;

export function applyWorldOperation(
	db: WorldDb,
	input: unknown,
	deps: ApplyDeps,
): WorldOperationResult {
	if (schemaCompatibility(db).status !== "current") return schemaBlocked;
	return applyCoordinated(db, input, deps);
}
export function readWorldSnapshot(
	db: WorldDb,
	request: unknown,
): WorldSnapshotResult {
	if (schemaCompatibility(db).status !== "current") return schemaBlocked;
	return readCoordinated(db, request);
}
export function readAssertionHistory(
	db: WorldDb,
	request: unknown,
): WorldHistoryResult {
	if (schemaCompatibility(db).status !== "current") return schemaBlocked;
	return readHistoryCoordinated(db, request);
}
/**
 * Bounded listing of one Scope's live entities (no assertions, no evidence).
 * Merged members resolve to their representative; forgotten entities are
 * never listed. Query: `aliasPrefix` (NFC-trimmed prefix of a name or alias)
 * and `ids`; `limit` is 1..maxListEntities and over-limit is rejected.
 */
export function listEntities(
	db: WorldDb,
	request: unknown,
): ListEntitiesResult {
	if (schemaCompatibility(db).status !== "current") return schemaBlocked;
	return listEntitiesCoordinated(db, request);
}
export function validateWorldUsage(
	db: WorldDb,
	receipt: unknown,
	current: unknown,
): WorldUsageResult {
	if (schemaCompatibility(db).status !== "current")
		return schemaBlocked as unknown as WorldUsageResult;
	return validateCoordinated(db, receipt, current);
}
export {
	maxListEntities,
	WORLD_INTERPRETATION_VERSION,
} from "./application/sqlite/index.ts";
export type {
	ApplyDeps,
	ForgetProgress,
	HostChecks,
	ListedEntity,
	ListEntitiesResult,
	RegistrationStatus,
	RestoreProgress,
	WorldOperation,
	WorldOperationInput,
	WorldOperationResult,
	SnapshotCoverage,
	WorldHistoryResult,
	WorldReceipt,
	WorldSnapshotResult,
	WorldUsageResult,
} from "./application/sqlite/index.ts";
