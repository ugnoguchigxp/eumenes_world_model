import type { MigrationDescriptor } from "../../../../infrastructure/sqlite/db.ts";

/** Immutable once released: never edit; append a new migration instead. */
export const migration001: MigrationDescriptor = {
	id: "scenarios-001",
	sql: `
CREATE TABLE world_prediction (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	id TEXT NOT NULL CHECK (length(id) > 0),
	revision INTEGER NOT NULL CHECK (revision >= 1),
	comparison_id TEXT NOT NULL,
	metric TEXT NOT NULL,
	due_at INTEGER NOT NULL,
	basis_assertion_id TEXT,
	basis_assertion_revision INTEGER CHECK (basis_assertion_revision IS NULL OR basis_assertion_revision >= 1),
	payload_json TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key, id, revision)
) STRICT;

CREATE TABLE world_outcome (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	id TEXT NOT NULL CHECK (length(id) > 0),
	revision INTEGER NOT NULL CHECK (revision >= 1),
	comparison_id TEXT NOT NULL,
	prediction_id TEXT NOT NULL,
	prediction_revision INTEGER NOT NULL CHECK (prediction_revision >= 1),
	payload_json TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key, id, revision),
	FOREIGN KEY (principal, scope_key, prediction_id, prediction_revision)
		REFERENCES world_prediction (principal, scope_key, id, revision)
) STRICT;

CREATE INDEX world_prediction_comparison ON world_prediction (principal, scope_key, comparison_id);
CREATE INDEX world_prediction_metric ON world_prediction (principal, scope_key, metric, due_at);
CREATE INDEX world_prediction_basis ON world_prediction (principal, scope_key, basis_assertion_id, basis_assertion_revision);
CREATE INDEX world_outcome_comparison ON world_outcome (principal, scope_key, comparison_id);
`,
	sha256: "12f13a4665702f5b8e3b79dfa3269e1f6634080a333d3525d44eb711caa2b75c",
};
