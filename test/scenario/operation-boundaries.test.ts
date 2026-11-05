import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	applyWorldOperation,
	readWorldSnapshot,
	readAssertionHistory,
	listEntities,
	validateWorldUsage,
	type WorldDb,
} from "../../src/sqlite.ts";
import {
	A,
	access,
	envelope,
	hasher,
	openWorld,
	registerClaim,
} from "./world-fixture.ts";
import { recordInbox, markInbox } from "../../src/domains/extraction/sqlite.ts";
import { forgetChunk, sourceRoot, states } from "./forget-fixture.ts";
const kinds = [
	"entity.register",
	"entity.merge",
	"entity.split",
	"assertion.register",
	"assertion.transition",
	"prediction.register",
	"outcome.register",
	"candidate.settle",
	"inbox.receive",
	"invalidate",
	"forget.chunk",
	"forget.reopen",
	"restore.begin",
	"restore.register",
	"restore.reconcile",
	"restore.finish",
	"rebuild",
] as const;
test("every declared update refuses unauthorized or malformed envelopes before reading content", () => {
	const declared = readFileSync(
		new URL("../../src/application/sqlite/checks.ts", import.meta.url),
		"utf8",
	)
		.match(/const operationKinds = \[([\s\S]*?)\] as const/)![1]!
		.match(/"[a-z.]+"/g)!
		.map((s) => JSON.parse(s));
	expect([...kinds]).toEqual(declared);
	const store = openWorld();
	try {
		store.write((db) => {
			expect(applyWorldOperation(db, registerClaim(), { hasher }).status).toBe(
				"applied",
			);
		});
		store.write((db) => {
			const guarded: WorldDb = {
				get inTransaction() {
					return db.inTransaction;
				},
				exec() {
					throw new Error("unexpected write");
				},
				query(sql) {
					if (
						!sql.includes("sqlite_master") &&
						!sql.includes("world_schema_info")
					)
						throw new Error("content read before authorization");
					const s = db.query(sql);
					return {
						all: (...p) => s.all(...p),
						get: (...p) => s.get(...p),
						run() {
							throw new Error("unexpected DML");
						},
					};
				},
			};
			for (const kind of kinds) {
				const op = {
					kind,
					id: "claim-1",
					eventId: "secret-existing",
					forgetId: "secret-existing",
				};
				const common = envelope(`boundary-${kind}`, op);
				expect(
					applyWorldOperation(
						guarded,
						{ ...common, access: { ...access(), principal: "other" } },
						{ hasher },
					),
				).toEqual({ status: "rejected", reasonCode: "SCOPE_NOT_PERMITTED" });
				expect(
					applyWorldOperation(
						guarded,
						{ ...common, access: { ...access(), scopeKeys: [] } },
						{ hasher },
					),
				).toEqual({ status: "rejected", reasonCode: "SCOPE_NOT_PERMITTED" });
				expect(
					applyWorldOperation(
						guarded,
						{ ...common, contractVersion: 2 },
						{ hasher },
					),
				).toMatchObject({ status: "rejected" });
				expect(
					applyWorldOperation(guarded, { ...common, access: null }, { hasher }),
				).toEqual({ status: "rejected", reasonCode: "INVALID_INPUT" });
			}
		});
	} finally {
		store.close();
	}
});
test("all public persistent entry points fail closed on schema tampering", () => {
	const store = openWorld();
	try {
		store.write((db) => {
			db.query("UPDATE world_schema_info SET sha256=? WHERE ordinal=1").run(
				"0".repeat(64),
			);
			for (const result of [
				applyWorldOperation(db, {}, { hasher }),
				readWorldSnapshot(db, {}),
				readAssertionHistory(db, {}),
				listEntities(db, {}),
				validateWorldUsage(db, {}, {}),
			])
				expect(result).toMatchObject({
					status: "blocked",
					reasonCode: "SCHEMA_INCOMPATIBLE",
				});
		});
	} finally {
		store.close();
	}
});
for (const status of ["received", "held", "rejected", "applied"] as const)
	test(`explicit host candidate root removes ${status} intake payload and rejects re-intake`, () => {
		const store = openWorld();
		try {
			store.write((db) => {
				expect(
					recordInbox(db, A, {
						eventId: "pending",
						feedKey: "feed",
						seq: 1,
						payload: { text: "synthetic private payload" },
					}).status,
				).toBe("inserted");
				if (status !== "received")
					expect(markInbox(db, A, "pending", status).status).toBe("updated");
				const result = applyWorldOperation(
					db,
					forgetChunk("forget-intake", "fg-intake", [
						sourceRoot(1),
						{ kind: "candidate", id: "pending", revision: 1 },
					]),
					{ hasher },
				);
				expect(result).toMatchObject({
					status: "applied",
					forget: { state: "complete" },
				});
				expect(
					db
						.query("SELECT payload_json FROM world_inbox WHERE event_id=?")
						.get("pending"),
				).toBeNull();
				const late = applyWorldOperation(
					db,
					envelope(
						"late",
						{
							kind: "inbox.receive",
							feed: {
								scopeKeys: [A.scopeKey],
								kind: "source",
								cursorRestoreEpoch: "r1",
							},
							event: {
								eventId: "pending",
								seq: 2,
								payload: { text: "synthetic private payload" },
							},
							receivedCursor: "later",
						},
						{ hostChecks: states() },
					),
					{ hasher },
				);
				expect(late).toMatchObject({
					status: "blocked",
					reasonCode: "GATE_CLOSED",
				});
			});
		} finally {
			store.close();
		}
	});
