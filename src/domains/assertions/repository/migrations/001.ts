import type { MigrationDescriptor } from "../../../../infrastructure/sqlite/db.ts";

/** Immutable once released: never edit; append a new migration instead. */
export const migration001: MigrationDescriptor = {
	id: "assertions-001",
	sql: `
CREATE TABLE world_assertion (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	id TEXT NOT NULL CHECK (length(id) > 0),
	revision INTEGER NOT NULL CHECK (revision >= 1),
	subject_id TEXT NOT NULL,
	predicate TEXT NOT NULL,
	lifecycle TEXT NOT NULL CHECK (lifecycle IN ('candidate', 'active', 'disputed', 'superseded', 'retracted', 'invalidated')),
	origin TEXT NOT NULL CHECK (origin IN ('runtime_observation', 'user_report', 'document_claim', 'model_hypothesis')),
	recorded_at INTEGER NOT NULL,
	payload_json TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key, id, revision)
) STRICT;

CREATE TABLE world_assertion_head (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	id TEXT NOT NULL,
	current_revision INTEGER NOT NULL CHECK (current_revision >= 1),
	PRIMARY KEY (principal, scope_key, id),
	FOREIGN KEY (principal, scope_key, id, current_revision)
		REFERENCES world_assertion (principal, scope_key, id, revision)
) STRICT;

CREATE TABLE world_transition (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	assertion_id TEXT NOT NULL,
	to_revision INTEGER NOT NULL CHECK (to_revision >= 1),
	from_revision INTEGER NOT NULL CHECK (from_revision >= 1),
	action TEXT NOT NULL CHECK (action IN ('adopt', 'dispute', 'resolve', 'supersede', 'retract', 'invalidate')),
	reason_code TEXT,
	PRIMARY KEY (principal, scope_key, assertion_id, to_revision),
	FOREIGN KEY (principal, scope_key, assertion_id, to_revision)
		REFERENCES world_assertion (principal, scope_key, id, revision)
) STRICT;

CREATE TABLE world_evidence (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	assertion_id TEXT NOT NULL,
	assertion_revision INTEGER NOT NULL CHECK (assertion_revision >= 1),
	evidence_id TEXT NOT NULL CHECK (length(evidence_id) > 0),
	root_evidence_id TEXT NOT NULL,
	stance TEXT NOT NULL CHECK (stance IN ('supports', 'refutes')),
	source_key TEXT NOT NULL,
	source_revision TEXT NOT NULL,
	payload_json TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key, assertion_id, assertion_revision, evidence_id),
	FOREIGN KEY (principal, scope_key, assertion_id, assertion_revision)
		REFERENCES world_assertion (principal, scope_key, id, revision)
) STRICT;

CREATE TABLE world_assertion_input (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	assertion_id TEXT NOT NULL,
	assertion_revision INTEGER NOT NULL CHECK (assertion_revision >= 1),
	source_key TEXT NOT NULL,
	source_revision TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key, assertion_id, assertion_revision, source_key),
	FOREIGN KEY (principal, scope_key, assertion_id, assertion_revision)
		REFERENCES world_assertion (principal, scope_key, id, revision)
) STRICT;

CREATE INDEX world_assertion_subject ON world_assertion (principal, scope_key, subject_id, predicate, lifecycle);
CREATE INDEX world_evidence_source ON world_evidence (principal, scope_key, source_key);
CREATE INDEX world_assertion_input_source ON world_assertion_input (principal, scope_key, source_key);
`,
	sha256: "5ec1befcbdaa9c0d6ed06952c01961fb23f939a9d056315ee3e9efa7d65a4872",
};
