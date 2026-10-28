import { expect, test } from "bun:test";
import { WorldIntegrityError } from "../../src/infrastructure/sqlite/db.ts";
import {
	getEntity,
	registerEntity,
	listEvents,
} from "../../src/domains/identity/sqlite.ts";
import {
	getAssertion,
	listEvidence,
} from "../../src/domains/assertions/sqlite.ts";
import { A, apply, openWorld, registerClaim } from "./world-fixture.ts";

for (const invalid of ["{", "null", "{}", '{"contractVersion":999}'])
	test(`corrupt stored payload fails closed: ${invalid}`, () => {
		const store = openWorld();
		try {
			store.write((db) => {
				expect(apply(db, registerClaim()).status).toBe("applied");
				expect(
					registerEntity(db, A, {
						id: "e",
						displayName: "対象",
						aliases: [],
						externalRefs: [],
					}).status,
				).toBe("applied");
				db.query("UPDATE world_entity SET payload_json = ?").run(invalid);
				db.query("UPDATE world_assertion SET payload_json = ?").run(invalid);
				db.query("UPDATE world_evidence SET payload_json = ?").run(invalid);
				// Valid indexed columns isolate payload validation from SQLite constraints.
				db.query(
					"INSERT INTO world_identity_event (principal, scope_key, event_id, kind, operation_id, revision, payload_json) VALUES (?, ?, 'event', 'merge', 'e', 1, ?)",
				).run(A.principal, A.scopeKey, invalid);
			});
			store.read((db) => {
				for (const read of [
					() => getEntity(db, A, "e"),
					() => getAssertion(db, A, "claim-1"),
					() => listEvidence(db, A, { id: "claim-1", revision: 1 }),
					() => listEvents(db, A, 10),
				])
					expect(read).toThrow(WorldIntegrityError);
			});
		} finally {
			store.close();
		}
	});
