import type { MigrationDescriptor } from "../../../../infrastructure/sqlite/db.ts";

/** Immutable once released: never edit; append a new migration instead. */
export const migration001: MigrationDescriptor = {
	id: "projection-001",
	sql: `
CREATE TABLE world_current (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	assertion_id TEXT NOT NULL,
	assertion_revision INTEGER NOT NULL CHECK (assertion_revision >= 1),
	subject_id TEXT NOT NULL,
	predicate TEXT NOT NULL,
	lifecycle TEXT NOT NULL CHECK (lifecycle IN ('candidate', 'active', 'disputed')),
	causal_eligible INTEGER NOT NULL CHECK (causal_eligible IN (0, 1)),
	payload_json TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key, assertion_id, assertion_revision)
) STRICT;

CREATE TABLE world_edge (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	edge_id TEXT NOT NULL CHECK (length(edge_id) > 0),
	revision INTEGER NOT NULL CHECK (revision >= 1),
	from_id TEXT NOT NULL,
	to_id TEXT NOT NULL,
	relation TEXT NOT NULL CHECK (relation IN ('increases', 'decreases', 'causes', 'enables', 'inhibits', 'correlates_with', 'depends_on', 'part_of', 'serves_goal', 'related_to')),
	assertion_id TEXT NOT NULL,
	assertion_revision INTEGER NOT NULL CHECK (assertion_revision >= 1),
	payload_json TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key, edge_id, revision)
) STRICT;

CREATE TABLE world_scope_epoch (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	epoch INTEGER NOT NULL CHECK (epoch >= 0),
	material_digest TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key)
) STRICT;

CREATE INDEX world_current_subject ON world_current (principal, scope_key, subject_id, predicate);
CREATE INDEX world_current_assertion ON world_current (principal, scope_key, assertion_id);
CREATE INDEX world_edge_from ON world_edge (principal, scope_key, from_id);
CREATE INDEX world_edge_to ON world_edge (principal, scope_key, to_id);
CREATE INDEX world_edge_assertion ON world_edge (principal, scope_key, assertion_id, assertion_revision);
`,
	sha256: "76ace9cdb6ab41e991650cdc3515f8f04d13100cf807ba37200b90b4c18b2ed8",
};
