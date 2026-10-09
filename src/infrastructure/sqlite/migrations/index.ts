import { assertionsMigrations } from "../../../domains/assertions/sqlite.ts";
import { extractionMigrations } from "../../../domains/extraction/sqlite.ts";
import { identityMigrations } from "../../../domains/identity/sqlite.ts";
import { lifecycleMigrations } from "../../../domains/lifecycle/sqlite.ts";
import { projectionMigrations } from "../../../domains/projection/sqlite.ts";
import { scenariosMigrations } from "../../../domains/scenarios/sqlite.ts";
import type { MigrationDescriptor } from "../db.ts";
import { schemaInfoMigration } from "./schema-info.ts";

/**
 * Fixed order. Append only; never reorder or edit a released descriptor.
 * world_schema_info comes first so every later migration can record itself.
 */
export const migrationDescriptors: readonly MigrationDescriptor[] =
	Object.freeze([
		schemaInfoMigration,
		...identityMigrations,
		...lifecycleMigrations,
		...assertionsMigrations,
		...projectionMigrations,
		...scenariosMigrations,
		...extractionMigrations,
	]);

const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;

/** The host runs each entry in its own transaction: DDL plus its own record. */
export function migrationStatement(
	descriptor: MigrationDescriptor,
	ordinal: number,
): string {
	return `${descriptor.sql}\nINSERT INTO world_schema_info (ordinal, migration_id, sha256) VALUES (${ordinal}, ${quote(descriptor.id)}, ${quote(descriptor.sha256)});\n`;
}

/** Host-compatible readonly SQL string array (P0 contract), derived from the descriptors. */
export const migrations: readonly string[] = Object.freeze(
	migrationDescriptors.map((descriptor, index) =>
		migrationStatement(descriptor, index + 1),
	),
);
