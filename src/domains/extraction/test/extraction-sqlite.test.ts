import { describe, expect, test } from "bun:test";
import type { WorldDb } from "../../../infrastructure/sqlite/db.ts";
import { WorldTransactionRequiredError } from "../../../infrastructure/sqlite/db.ts";
import { openTestStore } from "../../../../test/support/sqlite-store.ts";
import {
	advanceCheckpoint,
	deleteInbox,
	deleteManifests,
	feedKeyOf,
	getCheckpoint,
	getInbox,
	getManifest,
	listInboxByFeed,
	listManifestsBySourceKeys,
	markInbox,
	markManifest,
	recordInbox,
	saveManifest,
} from "../sqlite.ts";

const A = { principal: "p-a", scopeKey: "scope-a" };
const B = { principal: "p-a", scopeKey: "scope-b" };
const feed = { scopeKeys: ["scope-b", "scope-a"], kind: "conversation" };
const key = feedKeyOf("p-a", feed, "r1")!;
const src = (n: number, extra: object = {}) => ({
	namespace: "conversation",
	kind: "message",
	id: `src-${n}`,
	revision: "rev-1",
	digest: `sha256:${String(n).padStart(64, "0")}`,
	...extra,
});
const count = (db: WorldDb, table: string) =>
	(db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

for (const mode of ["file", "memory"] as const) {
	describe(`extraction repository (${mode})`, () => {
		test("A28 feed key is stable under scope order; seq gaps and duplicates", () => {
			expect(
				feedKeyOf("p-a", { ...feed, scopeKeys: ["scope-a", "scope-b"] }, "r1"),
			).toBe(key);
			expect(feedKeyOf("p-a", feed, "r2")).not.toBe(key);
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					expect(
						recordInbox(db, A, {
							eventId: "e-100",
							feedKey: key,
							seq: 100,
							payload: { m: "あ" },
						}).status,
					).toBe("inserted");
					expect(
						recordInbox(db, A, {
							eventId: "e-105",
							feedKey: key,
							seq: 105,
							payload: { m: "い" },
						}).status,
					).toBe("inserted");
					// duplicate receipt: no second row
					expect(
						recordInbox(db, A, {
							eventId: "e-100",
							feedKey: key,
							seq: 100,
							payload: { m: "あ" },
						}).status,
					).toBe("unchanged");
					expect(count(db, "world_inbox")).toBe(2);
					// same id, different content: conflict
					expect(
						recordInbox(db, A, {
							eventId: "e-100",
							feedKey: key,
							seq: 100,
							payload: { m: "x" },
						}),
					).toEqual({ status: "rejected", reasonCode: "EVENT_CONFLICT" });
					const page = listInboxByFeed(db, A, key, { limit: 10 });
					expect(page.items.map((e) => e.seq)).toEqual([100, 105]);
					expect(listInboxByFeed(db, A, key, { limit: 1 }).truncated).toBe(
						true,
					);
					expect(
						listInboxByFeed(db, A, key, { afterSeq: 100, limit: 10 }).items.map(
							(e) => e.seq,
						),
					).toEqual([105]);
					// other Scope sees nothing
					expect(getInbox(db, B, "e-100")).toBeUndefined();
				});
			} finally {
				store.close();
			}
		});
		test("A28 received vs applied cursors are separate; opaque cursors; stale epoch refused", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					const base = { feed, restoreEpoch: "r1", cursorRestoreEpoch: "r1" };
					expect(
						advanceCheckpoint(db, A, { ...base, appliedCursor: "c-1" }),
					).toEqual({
						status: "rejected",
						reasonCode: "APPLIED_WITHOUT_RECEIVED",
					});
					expect(
						advanceCheckpoint(db, A, { ...base, receivedCursor: "c-105" })
							.status,
					).toBe("advanced");
					let cp = getCheckpoint(db, A, key)!;
					expect([cp.receivedCursor, cp.appliedCursor]).toEqual([
						"c-105",
						null,
					]);
					expect(
						advanceCheckpoint(db, A, { ...base, appliedCursor: "c-100" })
							.status,
					).toBe("advanced");
					cp = getCheckpoint(db, A, key)!;
					expect([cp.receivedCursor, cp.appliedCursor]).toEqual([
						"c-105",
						"c-100",
					]);
					expect(
						advanceCheckpoint(db, A, { ...base, appliedCursor: "c-100" })
							.status,
					).toBe("unchanged");
					expect(
						advanceCheckpoint(db, A, {
							...base,
							cursorRestoreEpoch: "r0",
							receivedCursor: "c-999",
						}),
					).toEqual({ status: "rejected", reasonCode: "STALE_RESTORE_EPOCH" });
					expect(getCheckpoint(db, A, key)!.receivedCursor).toBe("c-105");
					expect(
						advanceCheckpoint(db, A, { ...base, receivedCursor: "" }).status,
					).toBe("rejected");
					expect(
						advanceCheckpoint(db, A, {
							feed: { ...feed, scopeKeys: ["scope-b"] },
							restoreEpoch: "r1",
							cursorRestoreEpoch: "r1",
							receivedCursor: "x",
						}).status,
					).toBe("rejected");
				});
			} finally {
				store.close();
			}
		});
		test("inbox status machine: received -> held -> applied; final states stay final", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					recordInbox(db, A, {
						eventId: "e-1",
						feedKey: key,
						seq: 1,
						payload: 1,
					});
					expect(markInbox(db, A, "e-1", "held").status).toBe("updated");
					expect(markInbox(db, A, "e-1", "held").status).toBe("unchanged");
					expect(markInbox(db, A, "e-1", "applied").status).toBe("updated");
					expect(markInbox(db, A, "e-1", "rejected")).toEqual({
						status: "rejected",
						reasonCode: "INVALID_TRANSITION",
					});
					expect(markInbox(db, A, "e-nope", "applied")).toEqual({
						status: "rejected",
						reasonCode: "EVENT_NOT_FOUND",
					});
					expect(getInbox(db, A, "e-1")?.status).toBe("applied");
				});
			} finally {
				store.close();
			}
		});
		test("A20 manifest keeps ALL 32 dependencies (cited or not); 33 rejected; immutable", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					const deps = Array.from({ length: 32 }, (_, i) => src(i + 1));
					expect(
						saveManifest(db, A, { manifestId: "m-1", dependencies: deps })
							.status,
					).toBe("inserted");
					expect(count(db, "world_manifest_dependency")).toBe(32);
					expect(getManifest(db, A, "m-1")?.dependencies.length).toBe(32);
					// duplicates collapse to unique, range is not part of a dependency
					expect(
						saveManifest(db, A, {
							manifestId: "m-1",
							dependencies: [
								...deps,
								src(1, { range: { startByte: 0, endByte: 3 } }),
							].slice(0, 33),
						}).status,
					).toBe("unchanged");
					expect(
						saveManifest(db, A, {
							manifestId: "m-2",
							dependencies: [...deps, src(33)],
						}),
					).toEqual({ status: "rejected", reasonCode: "LIMIT_EXCEEDED" });
					expect(
						saveManifest(db, A, {
							manifestId: "m-1",
							dependencies: deps.slice(1),
						}),
					).toEqual({ status: "rejected", reasonCode: "MANIFEST_CONFLICT" });
					expect(
						saveManifest(db, A, {
							manifestId: "m-3",
							dependencies: [src(1), src(1, { revision: "rev-2" })],
						}),
					).toEqual({
						status: "rejected",
						reasonCode: "CONFLICTING_INPUT_REVISIONS",
					});
					expect(count(db, "world_input_manifest")).toBe(1);
					const found = listManifestsBySourceKeys(
						db,
						A,
						[JSON.stringify(["conversation", "message", "src-7", null])],
						10,
					);
					expect(found.manifestIds).toEqual(["m-1"]);
					expect(
						listManifestsBySourceKeys(
							db,
							B,
							[JSON.stringify(["conversation", "message", "src-7", null])],
							10,
						).manifestIds,
					).toEqual([]);
					expect(markManifest(db, A, "m-1", "applied").status).toBe("updated");
					expect(markManifest(db, A, "m-1", "held").status).toBe("rejected");
				});
			} finally {
				store.close();
			}
		});
		test("forget: inbox payloads and manifests are deleted; no body text remains", () => {
			const store = openTestStore({ mode });
			try {
				store.write((db) => {
					recordInbox(db, A, {
						eventId: "e-1",
						feedKey: key,
						seq: 1,
						payload: { text: "秘密の本文" },
					});
					saveManifest(db, A, { manifestId: "m-1", dependencies: [src(1)] });
					recordInbox(db, B, {
						eventId: "e-1",
						feedKey: key,
						seq: 1,
						payload: { text: "別Scope" },
					});
					expect(deleteInbox(db, A, ["e-1", "e-none"]).deleted).toBe(1);
					expect(deleteManifests(db, A, ["m-1"]).deleted).toBe(1);
					expect(deleteManifests(db, A, ["m-1"]).deleted).toBe(0);
					expect(count(db, "world_manifest_dependency")).toBe(0);
					expect(getInbox(db, B, "e-1")?.payloadJson).toContain("別Scope");
					const like = db
						.query(
							"SELECT count(*) AS n FROM world_inbox WHERE payload_json LIKE ?",
						)
						.get("%秘密%") as { n: number };
					expect(like.n).toBe(0);
				});
			} finally {
				store.close();
			}
		});
		test("A21 outside a transaction throws; constraints reject bad rows", () => {
			const store = openTestStore({ mode });
			try {
				const raw = {
					inTransaction: false,
					exec() {},
					query() {
						throw new Error("unreachable");
					},
				} as unknown as WorldDb;
				expect(() =>
					recordInbox(raw, A, {
						eventId: "e",
						feedKey: key,
						seq: 1,
						payload: 1,
					}),
				).toThrow(WorldTransactionRequiredError);
				expect(() =>
					saveManifest(raw, A, { manifestId: "m", dependencies: [] }),
				).toThrow(WorldTransactionRequiredError);
				expect(() =>
					advanceCheckpoint(raw, A, {
						feed,
						restoreEpoch: "r1",
						cursorRestoreEpoch: "r1",
						receivedCursor: "c",
					}),
				).toThrow(WorldTransactionRequiredError);
				store.write((db) => {
					expect(() =>
						db
							.query(
								"INSERT INTO world_inbox (principal, scope_key, event_id, feed_key, seq, status, payload_json) VALUES (NULL, 's', 'e', 'k', 1, 'received', '{}')",
							)
							.run(),
					).toThrow();
					expect(() =>
						db
							.query(
								"INSERT INTO world_inbox (principal, scope_key, event_id, feed_key, seq, status, payload_json) VALUES ('p', 's', 'e', 'k', 1, 'bogus', '{}')",
							)
							.run(),
					).toThrow();
					expect(() =>
						db
							.query(
								"INSERT INTO world_manifest_dependency (principal, scope_key, manifest_id, source_key, source_revision) VALUES ('p-a', 'scope-b', 'm-x', 'k', 'r')",
							)
							.run(),
					).toThrow();
				});
			} finally {
				store.close();
			}
		});
		test("A23 mid-write exception rolls back inbox, manifest and checkpoint together", () => {
			const store = openTestStore({ mode });
			try {
				expect(() =>
					store.write((db) => {
						recordInbox(db, A, {
							eventId: "e-1",
							feedKey: key,
							seq: 1,
							payload: 1,
						});
						saveManifest(db, A, { manifestId: "m-1", dependencies: [src(1)] });
						advanceCheckpoint(db, A, {
							feed,
							restoreEpoch: "r1",
							cursorRestoreEpoch: "r1",
							receivedCursor: "c-1",
						});
						throw new Error("boom");
					}),
				).toThrow("boom");
				store.read((db) => {
					for (const table of [
						"world_inbox",
						"world_input_manifest",
						"world_manifest_dependency",
						"world_checkpoint",
					])
						expect(count(db, table)).toBe(0);
				});
			} finally {
				store.close();
			}
		});
	});
}
