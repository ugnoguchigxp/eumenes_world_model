import type { MigrationDescriptor } from "../db.ts";

/** Immutable once released: never edit; append a new migration instead. */
export const schemaInfoMigration: MigrationDescriptor = {
	id: "infrastructure-001",
	sql: `
CREATE TABLE world_schema_info (
	ordinal INTEGER NOT NULL PRIMARY KEY CHECK (ordinal >= 1),
	migration_id TEXT NOT NULL UNIQUE,
	sha256 TEXT NOT NULL CHECK (length(sha256) = 64)
) STRICT;
`,
	sha256: "d4cb9527d8ed6edca77f864b17e2d6a36d3aedc852fb56dcaf70aee8cded6c5e",
};
