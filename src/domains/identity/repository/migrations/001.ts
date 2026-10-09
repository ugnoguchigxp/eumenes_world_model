import type { MigrationDescriptor } from "../../../../infrastructure/sqlite/db.ts";

/** Immutable once released: never edit; append a new migration instead. */
export const migration001: MigrationDescriptor = {
	id: "identity-001",
	sql: `
CREATE TABLE world_entity (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	id TEXT NOT NULL CHECK (length(id) > 0),
	revision INTEGER NOT NULL CHECK (revision >= 1),
	status TEXT NOT NULL CHECK (status IN ('active', 'merged')),
	merged_into TEXT,
	payload_json TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key, id),
	FOREIGN KEY (principal, scope_key, merged_into)
		REFERENCES world_entity (principal, scope_key, id)
) STRICT;

CREATE TABLE world_alias (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	alias_norm TEXT NOT NULL CHECK (length(alias_norm) > 0),
	entity_id TEXT NOT NULL,
	alias_original TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key, alias_norm, entity_id),
	FOREIGN KEY (principal, scope_key, entity_id)
		REFERENCES world_entity (principal, scope_key, id)
) STRICT;

CREATE TABLE world_identity_event (
	principal TEXT NOT NULL CHECK (length(principal) > 0),
	scope_key TEXT NOT NULL CHECK (length(scope_key) > 0),
	event_id TEXT NOT NULL CHECK (length(event_id) > 0),
	kind TEXT NOT NULL CHECK (kind IN ('merge', 'split')),
	operation_id TEXT NOT NULL,
	revision INTEGER NOT NULL CHECK (revision >= 1),
	payload_json TEXT NOT NULL,
	PRIMARY KEY (principal, scope_key, event_id)
) STRICT;

CREATE INDEX world_entity_status ON world_entity (principal, scope_key, status);
CREATE INDEX world_alias_lookup ON world_alias (principal, scope_key, alias_norm);
CREATE INDEX world_identity_event_operation ON world_identity_event (principal, scope_key, operation_id);
`,
	sha256: "3fe776557fb6468ad5deabc0785192b803d4855487d1f197cba9bd3083353c0d",
};
