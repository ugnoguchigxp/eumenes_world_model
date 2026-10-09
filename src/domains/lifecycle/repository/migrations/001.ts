import type { MigrationDescriptor } from "../../../../infrastructure/sqlite/db.ts";

/** Immutable once released: never edit; append a new migration instead. */
export const migration001: MigrationDescriptor = {
	id: "lifecycle-001",
	sql: `
CREATE TABLE world_tombstone (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	kind TEXT NOT NULL CHECK (kind IN ('source', 'state', 'entity', 'assertion', 'manifest', 'prediction', 'outcome', 'candidate', 'projection', 'slice')),
	id TEXT NOT NULL CHECK (length(id) > 0),
	forget_id TEXT NOT NULL,
	reason_code TEXT NOT NULL CHECK (reason_code IN ('FORGET_REQUESTED', 'SOURCE_FORGOTTEN', 'CORRECTION_APPLIED', 'AUTHORIZATION_REVOKED')),
	PRIMARY KEY (principal, scope_key, kind, id)
) STRICT;

CREATE TABLE world_forget_operation (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	forget_id TEXT NOT NULL CHECK (length(forget_id) > 0),
	state TEXT NOT NULL CHECK (state IN ('pending', 'complete')),
	reason_code TEXT NOT NULL CHECK (reason_code IN ('FORGET_REQUESTED', 'SOURCE_FORGOTTEN', 'CORRECTION_APPLIED', 'AUTHORIZATION_REVOKED')),
	chunks INTEGER NOT NULL DEFAULT 0 CHECK (chunks >= 0),
	PRIMARY KEY (principal, scope_key, forget_id)
) STRICT;

CREATE TABLE world_forget_target (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	forget_id TEXT NOT NULL,
	kind TEXT NOT NULL CHECK (kind IN ('source', 'state', 'entity', 'assertion', 'manifest', 'prediction', 'outcome', 'candidate', 'projection', 'slice')),
	id TEXT NOT NULL,
	revision INTEGER NOT NULL CHECK (revision >= 1),
	state TEXT NOT NULL CHECK (state IN ('pending', 'done')),
	PRIMARY KEY (principal, scope_key, forget_id, kind, id, revision),
	FOREIGN KEY (principal, scope_key, forget_id)
		REFERENCES world_forget_operation (principal, scope_key, forget_id)
) STRICT;

CREATE TABLE world_scope_gate (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
	reason_code TEXT NOT NULL,
	restore_epoch TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key)
) STRICT;

CREATE TABLE world_operation (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	operation_key TEXT NOT NULL CHECK (length(operation_key) > 0),
	kind TEXT NOT NULL,
	payload_digest TEXT NOT NULL CHECK (payload_digest LIKE 'sha256:%'),
	canonical_version INTEGER NOT NULL CHECK (canonical_version >= 1),
	result_status TEXT NOT NULL CHECK (result_status IN ('applied', 'no_op')),
	receipt_ref TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key, operation_key)
) STRICT;

CREATE INDEX world_forget_target_pending ON world_forget_target (principal, scope_key, forget_id, state, kind, id, revision);
CREATE INDEX world_forget_operation_state ON world_forget_operation (principal, scope_key, state);
`,
	sha256: "0e4c9d1a0087ac53e8a70a17689011bb6141083a177ab6dc9c4ebbcaf042b9c3",
};
