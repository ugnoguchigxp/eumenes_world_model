/**
 * Regression tests for review round 3 of the persistence layer (numbered as
 * in that review). Each test fails without its fix.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { rebuildProjection } from "../../src/application/sqlite/projection.ts";
import {
	planAssertionTransition,
	type TransitionRequest,
} from "../../src/domains/assertions/index.ts";
import { getAssertion } from "../../src/domains/assertions/sqlite.ts";
import {
	countCheckpointsByKindPrefix,
	protectedKinds,
	markInbox,
	recordInbox,
} from "../../src/domains/extraction/sqlite.ts";
import { getInbox } from "../../src/domains/extraction/sqlite.ts";
import {
	beginForget,
	closeGate,
	completeForget,
	getGate,
	getTombstone,
	insertTombstone,
} from "../../src/domains/lifecycle/sqlite.ts";
import {
	readWorldSnapshot,
	validateWorldUsage,
	type WorldDb,
	type WorldOperationResult,
} from "../../src/sqlite.ts";
import {
	toSliceReceipt,
	buildWorldSlice,
} from "../../src/domains/projection/index.ts";
import { createJournal } from "../support/restore-fixture.ts";
import type { TestStore } from "../support/sqlite-store.ts";
import {
	count,
	forgetChunk,
	leaks,
	markedClaim,
	MARKER,
	seedAssertion,
	srcKey,
	srcState,
	states,
} from "./forget-fixture.ts";
import {
	A,
	NOW,
	access,
	apply,
	envelope,
	hasher,
	hostChecks,
	openWorld,
	ref,
	state,
} from "./world-fixture.ts";

const stores: TestStore[] = [];
const journals: { dispose(): void }[] = [];
afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	for (const journal of journals.splice(0)) journal.dispose();
});
function world(mode: "file" | "memory" = "memory"): TestStore {
	const store = openWorld(mode);
	stores.push(store);
	return store;
}
const run = (store: TestStore, input: unknown) =>
	store.write((db) => apply(db, input));
const register = (key: string, assertion: unknown, host = states()) =>
	envelope(
		key,
		{ kind: "assertion.register", assertion },
		{ hostChecks: host },
	);
const transition = (key: string, plan: unknown, host = states()) =>
	envelope(key, { kind: "assertion.transition", plan }, { hostChecks: host });
function plan(store: TestStore, id: string, request: TransitionRequest) {
	return store.read((db) => {
		const head = getAssertion(db, A, id)!;
		const planned = planAssertionTransition({
			contractVersion: 1,
			scope: A,
			current: {
				id,
				revision: head.revision,
				scope: A,
				lifecycle: head.lifecycle,
				origin: head.origin,
			},
			expectedRevision: head.revision,
			request,
			registeredAdoptionRules: [],
		});
		if (!planned.ok || planned.value.status !== "planned")
			throw new Error(`plan ${id}: ${JSON.stringify(planned)}`);
		return planned.value.plan;
	});
}
const adoptReq = (op: string): TransitionRequest => ({
	action: "adopt",
	adoption: { kind: "explicit", operationId: `adopt-${op}` },
	subjectConfirmedByHost: true,
});
const reopenOp = (key: string, forgetId: string, epoch?: string) =>
	envelope(
		key,
		{ kind: "forget.reopen", forgetId, externalDeletionConfirmed: true },
		{
			hostChecks:
				epoch === undefined ? states() : { ...states(), restoreEpoch: epoch },
		},
	);
const context = { hasher, clock: NOW, hostChecks: hostChecks() as never };
const columns = (st: TestStore) =>
	st.read((db) => ({
		current: db
			.query(
				"SELECT * FROM world_current ORDER BY assertion_id, assertion_revision",
			)
			.all(),
		edges: db
			.query("SELECT * FROM world_edge ORDER BY edge_id, revision")
			.all(),
		epoch: db.query("SELECT * FROM world_scope_epoch").all(),
	}));

describe("1 forgetting a contradiction TARGET keeps the projection equal to a rebuild", () => {
	test("the disputer is eligible again and its edge payload follows", () => {
		const store = world();
		const rel = (id: string, to: string) =>
			markedClaim(id, 1, [1], false, {
				subjectId: id,
				payload: { kind: "relation", relation: "causes", objectId: to },
			});
		run(store, register("r-h", rel("h", "x")));
		run(
			store,
			register("r-x", {
				...rel("x", "y"),
				contradicts: [{ id: "h", revision: 1 }],
			}),
		);
		run(store, transition("a-x", plan(store, "x", adoptReq("x"))));
		expect(
			run(
				store,
				forgetChunk("f1", "fg-h", [
					{ kind: "assertion", id: "h", revision: 1 },
				]),
			).status,
		).toBe("applied");
		const before = columns(store);
		store.write((db) => rebuildProjection(db, A, context));
		expect(columns(store)).toEqual(before);
	});

	test("seeded sequences that also forget assertions: incremental == rebuild in every column", () => {
		for (let seed0 = 1; seed0 <= 10; seed0++) {
			let seed = seed0 * 7919;
			const rnd = (n: number) => {
				seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
				return seed % n;
			};
			const store = world();
			const ids = Array.from({ length: 8 }, (_, i) => `c${i}`);
			const live = new Set(ids);
			ids.forEach((id, i) =>
				run(
					store,
					register(
						`r-${id}`,
						markedClaim(id, 1 + (i % 3), [1], false, {
							subjectId: `s${i}`,
							payload: {
								kind: "relation",
								relation: "causes",
								objectId: `s${(i + 1) % 8}`,
							},
						}),
					),
				),
			);
			let key = 0;
			let forgets = 0;
			for (let step = 0; step < 36; step++) {
				const id = ids[rnd(ids.length)]!;
				if (!live.has(id)) continue;
				const head = store.read((db) => getAssertion(db, A, id)!);
				const k = `s-${key++}`;
				const choice = rnd(5);
				if (head.lifecycle === "candidate") {
					run(store, transition(k, plan(store, id, adoptReq(k))));
				} else if (choice === 0 && head.lifecycle === "active") {
					const others = [...live].filter((o) => o !== id);
					const other = others[rnd(others.length)];
					if (other === undefined) continue;
					const target = store.read((db) => getAssertion(db, A, other)!);
					run(
						store,
						transition(
							k,
							plan(store, id, {
								action: "dispute",
								contradicts: [{ id: other, revision: target.revision }],
							}),
						),
					);
				} else if (choice === 1 && live.size > 2) {
					// Forget an assertion (possibly a contradiction target).
					const result = run(
						store,
						forgetChunk(k, `fg-${key}`, [
							{ kind: "assertion", id, revision: head.revision },
						]),
					);
					expect(result.status).toBe("applied");
					live.delete(id);
					forgets++;
					expect(run(store, reopenOp(`ro-${k}`, `fg-${key}`)).status).toBe(
						"applied",
					);
				}
			}
			expect(forgets + seed0).toBeGreaterThan(0);
			const before = columns(store);
			store.write((db) => rebuildProjection(db, A, context));
			expect(columns(store)).toEqual(before);
		}
	});
});

describe("2 a restore never wedges on a source whose derived forget is still draining", () => {
	test("300 assertions + predictions from one source: resends advance the derived forget and finish opens the Scope", () => {
		const store = world("file");
		store.write((db) => {
			for (let i = 0; i < 300; i++)
				seedAssertion(db, markedClaim(`c${i}`, 1, [1], false), true);
		});
		const step = (key: string, operation: unknown) =>
			run(
				store,
				envelope(key, operation, {
					hostChecks: { ...states(), restoreEpoch: "r2" },
				}),
			) as Extract<WorldOperationResult, { receipt: unknown }>;
		expect(step("b", { kind: "restore.begin" }).status).toBe("applied");
		const register1 = step("g1", {
			kind: "restore.register",
			registrations: [{ sourceKey: srcKey(1), status: "tombstoned" }],
		});
		expect(register1.status).toBe("applied");
		expect(register1.restore?.pendingForget).toBeGreaterThan(0);
		expect(register1.restore?.derivedForgets?.length).toBe(1);
		const inLedger = () =>
			store.read(
				(db) =>
					(
						db
							.query(
								"SELECT count(*) AS n FROM world_assertion_input WHERE source_key = ?",
							)
							.get(srcKey(1)) as { n: number }
					).n,
			);
		let sawGone = inLedger() === 0 && register1.restore!.pendingForget! > 0;
		// finish is blocked while the derived forget still has targets.
		expect(step("f0", { kind: "restore.finish" })).toMatchObject({
			status: "blocked",
		});
		for (let n = 0; n < 10; n++) {
			const again = step(`g${n + 2}`, {
				kind: "restore.register",
				registrations: [{ sourceKey: srcKey(1), status: "tombstoned" }],
			});
			expect(again.status).toBe("applied");
			if (inLedger() === 0 && again.restore!.pendingForget! > 0) sawGone = true;
			if (again.restore!.pendingForget === 0) break;
		}
		expect(sawGone).toBe(true);
		expect(
			step("j", {
				kind: "restore.reconcile",
				journal: { seq: 1, final: true, tombstones: [] },
			}).status,
		).toBe("applied");
		expect(step("fin", { kind: "restore.finish" }).status).toBe("applied");
		expect(count(store, "world_assertion")).toBe(0);
		expect(count(store, "world_prediction")).toBe(0);
	});
});

describe("3 entity references inside a condition are part of the entity closure", () => {
	const conditioned = (id: string, entityId: string) =>
		markedClaim(id, 1, [1], false, {
			condition: {
				kind: "expression",
				expression: {
					kind: "compare",
					key: "k",
					op: "eq",
					value: { kind: "entity", entityId },
				},
			},
		});
	test("forget reaches it; the tombstone then blocks a new one", () => {
		const store = world();
		expect(run(store, register("r1", conditioned("c1", "ent-c"))).status).toBe(
			"applied",
		);
		expect(
			run(store, register("r2", markedClaim("c2", 1, [1], false))).status,
		).toBe("applied");
		expect(
			run(
				store,
				forgetChunk("f1", "fg-e", [
					{ kind: "entity", id: "ent-c", revision: 1 },
				]),
			).status,
		).toBe("applied");
		expect(store.read((db) => getAssertion(db, A, "c1"))).toBeUndefined();
		expect(store.read((db) => getAssertion(db, A, "c2"))).toBeDefined();
		expect(run(store, reopenOp("ro", "fg-e")).status).toBe("applied");
		expect(run(store, register("r3", conditioned("c3", "ent-c")))).toEqual({
			status: "rejected",
			reasonCode: "TOMBSTONED",
		});
	});
	test("a snapshot never returns an assertion whose condition names a forgotten entity", () => {
		const store = world();
		run(store, register("r1", conditioned("c1", "ent-c")));
		run(store, transition("a1", plan(store, "c1", adoptReq("1"))));
		store.write((db) =>
			insertTombstone(db, A, {
				kind: "entity",
				id: "ent-c",
				forgetId: "fg-x",
				reasonCode: "FORGET_REQUESTED",
			}),
		);
		const result = store.read((db) =>
			readWorldSnapshot(db, {
				contractVersion: 1,
				access: access(),
				scope: A,
				asOf: NOW,
				hostChecks: states(),
			}),
		);
		expect(result).toEqual({ status: "blocked", reasonCode: "TOMBSTONED" });
	});
});

describe("4 every complete forget needs its own external-deletion confirmation", () => {
	const open = (store: TestStore) => store.read((db) => getGate(db, A));
	test("forget B completing does not cancel forget A's obligation", () => {
		const store = world();
		run(store, register("r1", markedClaim("c1", 1, [1], false)));
		run(store, register("r2", markedClaim("c2", 2, [2], false)));
		run(
			store,
			forgetChunk("fa", "fg-a", [
				{ kind: "source", id: srcKey(1), revision: 1 },
			]),
		);
		run(
			store,
			forgetChunk("fb", "fg-b", [
				{ kind: "source", id: srcKey(2), revision: 1 },
			]),
		);
		// B confirms first: A is still owed, the Scope stays closed.
		const first = run(store, reopenOp("ro-b", "fg-b")) as Extract<
			WorldOperationResult,
			{ receipt: unknown }
		>;
		expect(first.status).toBe("applied");
		expect(first.forget?.awaitingConfirmation).toBe(1);
		expect(open(store)?.state).toBe("closed");
		const second = run(store, reopenOp("ro-a", "fg-a")) as Extract<
			WorldOperationResult,
			{ receipt: unknown }
		>;
		expect(second.forget?.awaitingConfirmation).toBe(0);
		expect(open(store)?.state).toBe("open");
	});
	test("a gate left by an older build (no forget tag) is reopened by any complete forget's confirmation", () => {
		const store = world();
		store.write((db) => {
			beginForget(db, A, {
				forgetId: "fg-old",
				reasonCode: "FORGET_REQUESTED",
			});
			completeForget(db, A, "fg-old");
			closeGate(db, A, {
				reasonCode: "FORGET_COMPLETE_AWAITING_REOPEN",
				restoreEpoch: "r1",
			});
		});
		expect(run(store, reopenOp("ro", "fg-old")).status).toBe("applied");
		expect(open(store)?.state).toBe("open");
	});
	test("the awaiting marks survive restore.begin", () => {
		const store = world();
		run(store, register("r1", markedClaim("c1", 1, [1], false)));
		run(
			store,
			forgetChunk("fa", "fg-a", [
				{ kind: "source", id: srcKey(1), revision: 1 },
			]),
		);
		const before = store.read((db) =>
			countCheckpointsByKindPrefix(db, A, protectedKinds.awaitingForget),
		);
		expect(before).toBe(1);
		run(
			store,
			envelope(
				"rb",
				{ kind: "restore.begin" },
				{ hostChecks: { ...states(), restoreEpoch: "r2" } },
			),
		);
		expect(
			store.read((db) =>
				countCheckpointsByKindPrefix(db, A, protectedKinds.awaitingForget),
			),
		).toBe(1);
	});
});

describe("5 the journal rollback guard survives gate rewrites under a newer epoch", () => {
	test("forget + reopen at r3 before restore.begin does not forget the journal position", () => {
		const store = world();
		const at = (epoch: string, key: string, operation: unknown) =>
			run(
				store,
				envelope(key, operation, {
					hostChecks: { ...states(), restoreEpoch: epoch },
				}),
			);
		expect(at("r2", "b2", { kind: "restore.begin" }).status).toBe("applied");
		expect(
			at("r2", "j2", {
				kind: "restore.reconcile",
				journal: { seq: 10, final: true, tombstones: [] },
			}).status,
		).toBe("applied");
		expect(at("r2", "f2", { kind: "restore.finish" }).status).toBe("applied");
		// A forget at the NEWER epoch rewrites the gate row with epoch r3.
		expect(
			at("r3", "fg", {
				kind: "forget.chunk",
				forgetId: "fg-1",
				reasonCode: "FORGET_REQUESTED",
				roots: [{ kind: "source", id: srcKey(9), revision: 1 }],
			}).status,
		).toBe("applied");
		expect(
			at("r3", "ro", {
				kind: "forget.reopen",
				forgetId: "fg-1",
				externalDeletionConfirmed: true,
			}).status,
		).toBe("applied");
		expect(at("r3", "b3", { kind: "restore.begin" }).status).toBe("applied");
		expect(
			at("r3", "j3", {
				kind: "restore.reconcile",
				journal: { seq: 5, final: true, tombstones: [] },
			}),
		).toEqual({ status: "blocked", reasonCode: "JOURNAL_ROLLED_BACK" });
	});
});

describe("6 entity forget scans the Scope once per chunk, not once per entity", () => {
	test("20 entity roots over 5,000 assertions: bounded scans and time", () => {
		const store = world("file");
		store.write((db) => {
			for (let i = 0; i < 5000; i++)
				seedAssertion(
					db,
					markedClaim(`c${i}`, 1, [1], false, {
						subjectId: `s${i}`,
						payload: {
							kind: "relation",
							relation: "causes",
							objectId: `ent-${i % 40}`,
						},
					}),
				);
		});
		const roots = Array.from({ length: 20 }, (_, i) => ({
			kind: "entity",
			id: `ent-${i}`,
			revision: 1,
		}));
		let scans = 0;
		const started = performance.now();
		const result = store.write((db) => {
			const counting: WorldDb = {
				get inTransaction() {
					return db.inTransaction;
				},
				exec: (sql) => db.exec(sql),
				query: (sql) => {
					if (sql.includes("world_assertion") && sql.includes('"objectId":%'))
						scans++;
					return db.query(sql);
				},
			};
			return apply(
				counting,
				forgetChunk("f", "fg-many", roots),
			) as WorldOperationResult;
		});
		const elapsed = performance.now() - started;
		expect(result.status).toBe("applied");
		// Without batching this is 20+ scans (one per entity target, per pass).
		expect(scans).toBeLessThanOrEqual(10);
		expect(elapsed).toBeLessThan(20_000);
	});
});

describe("7 surviving mutants of round 2 are pinned", () => {
	const at = (store: TestStore, epoch: string, key: string, op: unknown) =>
		run(
			store,
			envelope(key, op, { hostChecks: { ...states(), restoreEpoch: epoch } }),
		) as Extract<WorldOperationResult, { receipt: unknown }>;

	test("journal pages with the same forgetId keep their own roots (200 + 50 tombstones)", () => {
		const store = world();
		at(store, "r2", "b", { kind: "restore.begin" });
		const entry = (n: number) => ({
			ref: { kind: "source", id: `["ns","k","id-${n}",null]`, revision: 1 },
			forgetId: "forget-J",
			reasonCode: "SOURCE_FORGOTTEN",
		});
		at(store, "r2", "p1", {
			kind: "restore.reconcile",
			journal: {
				seq: 1,
				final: false,
				tombstones: Array.from({ length: 200 }, (_, i) => entry(i)),
			},
		});
		at(store, "r2", "p2", {
			kind: "restore.reconcile",
			journal: {
				seq: 1,
				final: true,
				tombstones: Array.from({ length: 50 }, (_, i) => entry(200 + i)),
			},
		});
		expect(count(store, "world_tombstone")).toBe(250);
	});

	test("the same journal under a NEW restore epoch re-erases what an older database brought back", () => {
		const store = world();
		const journal = createJournal();
		journals.push(journal);
		journal.append([
			{
				ref: { kind: "source", id: srcKey(2), revision: 1 },
				forgetId: "forget-J",
				reasonCode: "SOURCE_FORGOTTEN",
			},
		]);
		const head = journal.head();
		const rec = { seq: head.seq, final: true, tombstones: head.tombstones };
		at(store, "r2", "b2", { kind: "restore.begin" });
		at(store, "r2", "j2", { kind: "restore.reconcile", journal: rec });
		expect(at(store, "r2", "f2", { kind: "restore.finish" }).status).toBe(
			"applied",
		);
		// An older copy of the database comes back with a claim from that source.
		store.write((db) => seedAssertion(db, markedClaim("old", 2, [2], true)));
		at(store, "r3", "b3", { kind: "restore.begin" });
		// reconcile first: the claim must be re-erased even though the journal
		// page content is identical to the one applied under r2.
		at(store, "r3", "j3", { kind: "restore.reconcile", journal: rec });
		expect(leaks(store, MARKER)).toEqual([]);
	});

	test("a 262-byte source key is registered, accounted for and finish opens the Scope", () => {
		const store = world();
		const longRef = ref({ id: "x".repeat(240) });
		const longState = state({ id: "x".repeat(240) });
		const host = hostChecks([longState]);
		expect(
			run(
				store,
				register(
					"r1",
					markedClaim("c1", 1, [1], false, {
						evidence: [
							{
								evidenceId: "ev-c1",
								kind: "user_statement",
								stance: "supports",
								source: longRef,
								rootEvidenceId: "root-c1",
							},
						],
						inputManifest: [longRef],
					}),
					host,
				),
			).status,
		).toBe("applied");
		const key = store.read(
			(db) =>
				(
					db
						.query("SELECT source_key FROM world_assertion_input LIMIT 1")
						.get() as { source_key: string }
				).source_key,
		);
		expect(new TextEncoder().encode(key).length).toBeGreaterThan(256);
		at(store, "r2", "b", { kind: "restore.begin" });
		expect(
			at(store, "r2", "j", {
				kind: "restore.reconcile",
				journal: { seq: 1, final: true, tombstones: [] },
			}).status,
		).toBe("applied");
		expect(at(store, "r2", "f1", { kind: "restore.finish" })).toMatchObject({
			status: "blocked",
			reasonCode: "DEPENDENCIES_UNACCOUNTED",
		});
		expect(
			at(store, "r2", "g", {
				kind: "restore.register",
				registrations: [{ sourceKey: key, status: "registered" }],
			}).status,
		).toBe("applied");
		expect(at(store, "r2", "f2", { kind: "restore.finish" }).status).toBe(
			"applied",
		);
	});

	test("restore.begin releases held inbox events with their payload", () => {
		const store = world();
		store.write((db) => {
			recordInbox(db, A, {
				eventId: "ev-h",
				feed: {
					scopeKeys: ["scope-a"],
					kind: "conversation",
					cursorRestoreEpoch: "r1",
				},
				seq: 1,
				payload: { text: MARKER },
			} as never);
			markInbox(db, A, "ev-h", "held" as never);
		});
		at(store, "r2", "b", { kind: "restore.begin" });
		expect(store.read((db) => getInbox(db, A, "ev-h"))).toBeUndefined();
		expect(leaks(store, MARKER)).toEqual([]);
	});

	test("a state-kind forget root reaches the assertions that read that state", () => {
		const store = world();
		run(store, register("r1", markedClaim("c1", 1, [1], true)));
		expect(
			run(
				store,
				forgetChunk("f", "fg-s", [
					{ kind: "state", id: srcKey(1), revision: 1 },
				]),
			).status,
		).toBe("applied");
		expect(store.read((db) => getAssertion(db, A, "c1"))).toBeUndefined();
		expect(leaks(store, MARKER)).toEqual([]);
		expect(
			store.read((db) => getTombstone(db, A, { kind: "state", id: srcKey(1) })),
		).toBeDefined();
	});

	test("usage validation rejects a slice whose assertion or source was forgotten", () => {
		const store = world();
		run(store, register("r1", markedClaim("c1", 1, [1], false)));
		run(store, transition("a1", plan(store, "c1", adoptReq("1"))));
		const request = {
			contractVersion: 1,
			access: access(),
			scope: A,
			asOf: NOW,
			hostChecks: states(),
		};
		const receipt = store.read((db) => {
			const snapshot = readWorldSnapshot(db, request);
			if (snapshot.status !== "ready") throw new Error(snapshot.reasonCode);
			const slice = buildWorldSlice(
				{ contractVersion: 1, snapshot: snapshot.snapshot, request: {} },
				hasher,
			);
			if (!slice.ok) throw new Error(JSON.stringify(slice));
			return toSliceReceipt(slice.value);
		});
		const current = {
			contractVersion: 1,
			access: access(),
			scope: A,
			hostChecks: states(),
		};
		expect(
			store.write((db) => validateWorldUsage(db, receipt, current)),
		).toMatchObject({ status: "valid" });
		store.write((db) =>
			insertTombstone(db, A, {
				kind: "source",
				id: srcKey(1),
				forgetId: "fg-z",
				reasonCode: "FORGET_REQUESTED",
			}),
		);
		expect(
			store.write((db) => validateWorldUsage(db, receipt, current)).status,
		).toBe("blocked");
	});
});

describe("8 the public API document matches the code", () => {
	test("the operation count in the document equals operationKinds", () => {
		const root = resolve(import.meta.dir, "../..");
		const source = readFileSync(
			resolve(root, "src/application/sqlite/checks.ts"),
			"utf8",
		);
		const list = /const operationKinds = \[([\s\S]*?)\] as const/.exec(
			source,
		)![1]!;
		const kinds = [...list.matchAll(/"([a-z.]+)"/g)].map((m) => m[1]!);
		const doc = readFileSync(
			resolve(root, "spec/world-sqlite-public-api.md"),
			"utf8",
		);
		expect(doc).toContain(`operation ${kinds.length}種`);
		const api = readFileSync(resolve(root, "spec/sqlite-api-v1.md"), "utf8");
		// Documents group families ("entity.register / merge / split").
		for (const kind of kinds) {
			const [family, suffix = ""] = kind.split(".");
			const text = api + doc;
			expect(
				text.includes(kind) ||
					(text.includes(`${family}.`) && text.includes(suffix)),
			).toBe(true);
		}
	});
});

void srcState;
