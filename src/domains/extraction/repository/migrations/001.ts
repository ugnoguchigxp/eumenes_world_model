import type { MigrationDescriptor } from "../../../../infrastructure/sqlite/db.ts";

/** Immutable once released: never edit; append a new migration instead. */
export const migration001: MigrationDescriptor = {
	id: "extraction-001",
	sql: `
CREATE TABLE world_inbox (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	event_id TEXT NOT NULL CHECK (length(event_id) > 0),
	feed_key TEXT NOT NULL,
	seq INTEGER NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('received', 'applied', 'held', 'rejected')),
	payload_json TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key, event_id)
) STRICT;

CREATE TABLE world_input_manifest (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	manifest_id TEXT NOT NULL CHECK (length(manifest_id) > 0),
	status TEXT NOT NULL CHECK (status IN ('prepared', 'applied', 'held', 'rejected')),
	payload_json TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key, manifest_id)
) STRICT;

CREATE TABLE world_manifest_dependency (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	manifest_id TEXT NOT NULL,
	source_key TEXT NOT NULL,
	source_revision TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key, manifest_id, source_key),
	FOREIGN KEY (principal, scope_key, manifest_id)
		REFERENCES world_input_manifest (principal, scope_key, manifest_id)
) STRICT;

CREATE TABLE world_checkpoint (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	feed_key TEXT NOT NULL CHECK (length(feed_key) > 0),
	received_cursor TEXT,
	applied_cursor TEXT,
	restore_epoch TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key, feed_key)
) STRICT;

CREATE INDEX world_inbox_feed ON world_inbox (principal, scope_key, feed_key, seq);
CREATE INDEX world_manifest_dependency_source ON world_manifest_dependency (principal, scope_key, source_key);
`,
	sha256: "ba7dfc107888e1f47465cf42e3409b784bf255fbaf7e32db808125613e4b1a58",
};
