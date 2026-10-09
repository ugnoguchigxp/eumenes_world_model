import { requireTransaction, type WorldDb } from "../db.ts";
import {
	checkSchemaCompatibility,
	type AppliedMigration,
	type SchemaCompatibility,
} from "./verify.ts";

/** More rows than migrations can exist means a future schema anyway. */
const maxRows = 1000;

/**
 * Reads the applied-migration rows once (bounded) inside the host's
 * transaction and checks them against the pinned manifest. Anything but
 * "current" must refuse World use: a hash mismatch, a future schema, a wrong
 * order, or an upgrade the host has not finished yet.
 */
export function schemaCompatibility(db: WorldDb): SchemaCompatibility {
	requireTransaction(db);
	// No migrations applied yet: the table itself does not exist.
	const present = db
		.query(
			"SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'world_schema_info'",
		)
		.get();
	if (!present) return checkSchemaCompatibility([]);
	const rows = db
		.query(
			"SELECT ordinal, migration_id, sha256 FROM world_schema_info ORDER BY ordinal LIMIT ?",
		)
		.all(maxRows) as AppliedMigration[];
	return checkSchemaCompatibility(rows);
}
