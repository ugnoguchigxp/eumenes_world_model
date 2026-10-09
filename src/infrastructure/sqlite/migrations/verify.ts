import { migrationManifest } from "./manifest.ts";

export interface AppliedMigration {
	readonly ordinal: number;
	readonly migration_id: string;
	readonly sha256: string;
}
export type SchemaCompatibility =
	| { readonly status: "current" }
	| { readonly status: "upgrade_needed"; readonly from: number }
	| { readonly status: "incompatible"; readonly reasonCode: SchemaReason };
export type SchemaReason =
	| "FUTURE_SCHEMA"
	| "MIGRATION_HASH_MISMATCH"
	| "MIGRATION_ORDER_MISMATCH";

/**
 * Pure check of the rows the host read from world_schema_info against the
 * pinned manifest. Anything but "current" must refuse writes and World use,
 * except upgrade_needed which only permits applying the missing migrations.
 */
export function checkSchemaCompatibility(
	applied: readonly AppliedMigration[],
): SchemaCompatibility {
	const rows = [...applied].sort((a, b) => a.ordinal - b.ordinal);
	if (rows.length > migrationManifest.length)
		return { status: "incompatible", reasonCode: "FUTURE_SCHEMA" };
	for (const [index, row] of rows.entries()) {
		const expected = migrationManifest[index]!;
		if (row.ordinal !== expected.ordinal || row.migration_id !== expected.id)
			return { status: "incompatible", reasonCode: "MIGRATION_ORDER_MISMATCH" };
		if (row.sha256 !== expected.sha256)
			return { status: "incompatible", reasonCode: "MIGRATION_HASH_MISMATCH" };
	}
	return rows.length === migrationManifest.length
		? { status: "current" }
		: { status: "upgrade_needed", from: rows.length };
}
