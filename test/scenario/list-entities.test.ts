import { afterEach, describe, expect, test } from "bun:test";
import { planMerge } from "../../src/domains/identity/index.ts";
import { getEntity } from "../../src/domains/identity/sqlite.ts";
import {
	closeGate,
	insertTombstone,
} from "../../src/domains/lifecycle/sqlite.ts";
import {
	listEntities,
	maxListEntities,
	type ListEntitiesResult,
} from "../../src/sqlite.ts";
import type { TestStore } from "../support/sqlite-store.ts";
import { forgetChunk } from "./forget-fixture.ts";
import {
	A,
	B,
	access,
	apply,
	envelope,
	hostChecks,
	openWorld,
	state,
} from "./world-fixture.ts";

const stores: TestStore[] = [];
afterEach(() => {
	for (const store of stores.splice(0)) store.close();
});
function world(): TestStore {
	const store = openWorld("file");
	stores.push(store);
	return store;
}
const run = (store: TestStore, input: unknown) =>
	store.write((db) => apply(db, input));

function register(
	store: TestStore,
	id: string,
	displayName: string,
	aliases: string[] = [],
	externalRefs: { system: string; id: string }[] = [],
	scope: "a" | "b" = "a",
) {
	const over =
		scope === "a"
			? {}
			: {
					scope: B,
					access: access(["scope-b"]),
					hostChecks: hostChecks([state({ scopeKey: "scope-b" })]),
				};
	expect(
		run(
			store,
			envelope(
				`reg-${scope}-${id}`,
				{
					kind: "entity.register",
					entity: { id, displayName, aliases, externalRefs },
				},
				over,
			),
		).status,
	).toBe("applied");
}
function merge(store: TestStore, key: string, rep: string, member: string) {
	const plan = store.read((db) => {
		const planned = planMerge({
			scope: A,
			operationId: key,
			representativeId: rep,
			targetIds: [rep, member],
			expectedRevisions: {
				[rep]: getEntity(db, A, rep)!.revision,
				[member]: getEntity(db, A, member)!.revision,
			},
			evidence: ["ev"],
			entities: [getEntity(db, A, rep)!, getEntity(db, A, member)!],
		});
		if (!planned.ok || planned.value.status !== "planned")
			throw new Error(JSON.stringify(planned));
		return planned.value.plan;
	});
	expect(run(store, envelope(key, { kind: "entity.merge", plan })).status).toBe(
		"applied",
	);
}

const request = (extra: Record<string, unknown> = {}) => ({
	contractVersion: 1,
	access: access(),
	scopeKey: A.scopeKey,
	limit: 50,
	...extra,
});
const list = (store: TestStore, extra: Record<string, unknown> = {}) =>
	store.read((db) => listEntities(db, request(extra)));
const ready = (result: ListEntitiesResult) => {
	if (result.status !== "ready") throw new Error(JSON.stringify(result));
	return result;
};
const idsOf = (result: ListEntitiesResult) =>
	ready(result).entities.map((e) => e.id);

function seed(store: TestStore) {
	register(
		store,
		"ent-1",
		"Eumenes",
		["エウメネス", "eumenes-core"],
		[{ system: "repo", id: "eumenes" }],
	);
	register(store, "ent-2", "Eumenes Memory", ["memory"]);
	register(store, "ent-3", "Zeta");
	register(store, "ent-4", "Absorbed", ["Eumenes legacy"]);
	register(store, "b-1", "Eumenes B-only", ["b-only-alias"], [], "b");
}

describe("listEntities", () => {
	test("lists the Scope's entities in id order with name, aliases, refs and revision", () => {
		const store = world();
		seed(store);
		const result = ready(list(store));
		expect(result.truncated).toBe(false);
		expect(result.entities.map((e) => e.id)).toEqual([
			"ent-1",
			"ent-2",
			"ent-3",
			"ent-4",
		]);
		expect(result.entities[0]).toEqual({
			id: "ent-1",
			revision: 1,
			displayName: "Eumenes",
			aliases: ["エウメネス", "eumenes-core"],
			externalRefs: [{ system: "repo", id: "eumenes" }],
		});
		expect(ready(list(store, { query: {} })).entities.length).toBe(4);
	});

	test("scope isolation: another Scope's entities never appear, and a Scope not granted is rejected", () => {
		const store = world();
		seed(store);
		const a = list(store, { query: { aliasPrefix: "Eumenes" } });
		expect(idsOf(a)).toEqual(["ent-1", "ent-2", "ent-4"]);
		expect(JSON.stringify(a)).not.toMatch(/b-1|b-only/);
		const b = store.read((db) =>
			listEntities(
				db,
				request({ scopeKey: B.scopeKey, access: access(["scope-b"]) }),
			),
		);
		expect(idsOf(b)).toEqual(["b-1"]);
		expect(JSON.stringify(b)).not.toMatch(/ent-/);
		const deny = (scopeKey: string) =>
			store.read((db) => listEntities(db, request({ scopeKey })));
		const existing = deny(B.scopeKey);
		expect(existing).toEqual({
			status: "rejected",
			reasonCode: "SCOPE_NOT_PERMITTED",
		});
		expect(deny("scope-zzz")).toEqual(existing);
		// The principal comes from access: another principal reads only its own rows.
		expect(
			ready(
				store.read((db) =>
					listEntities(
						db,
						request({ access: { ...access(), principal: "p-other" } }),
					),
				),
			).entities,
		).toEqual([]);
		// ids from another Scope resolve to nothing.
		expect(idsOf(list(store, { query: { ids: ["b-1"] } }))).toEqual([]);
	});

	test("a forgotten entity is never returned (forget and bare tombstone)", () => {
		const store = world();
		seed(store);
		expect(
			run(
				store,
				forgetChunk("f-1", "fg-1", [
					{ kind: "entity", id: "ent-3", revision: 1 },
				]),
			),
		).toMatchObject({ status: "applied" });
		// A forget closes the Scope until the host confirms external deletion.
		expect(list(store)).toEqual({
			status: "blocked",
			reasonCode: "GATE_CLOSED",
		});
		expect(
			run(
				store,
				envelope("reopen-1", {
					kind: "forget.reopen",
					forgetId: "fg-1",
					externalDeletionConfirmed: true,
				}),
			),
		).toMatchObject({ status: "applied" });
		expect(idsOf(list(store))).toEqual(["ent-1", "ent-2", "ent-4"]);
		expect(idsOf(list(store, { query: { ids: ["ent-3", "ent-2"] } }))).toEqual([
			"ent-2",
		]);
		// A tombstone alone hides a still-present row too.
		store.write((db) => {
			expect(
				insertTombstone(db, A, {
					kind: "entity",
					id: "ent-2",
					forgetId: "fg-2",
					reasonCode: "FORGET_REQUESTED",
				}).status,
			).toBe("inserted");
		});
		expect(idsOf(list(store))).toEqual(["ent-1", "ent-4"]);
		expect(idsOf(list(store, { query: { aliasPrefix: "Eumenes" } }))).toEqual([
			"ent-1",
			"ent-4",
		]);
		expect(idsOf(list(store, { query: { ids: ["ent-2"] } }))).toEqual([]);
	});

	test("merged members resolve to their representative and are never listed themselves", () => {
		const store = world();
		seed(store);
		register(store, "ent-5", "Chain five");
		register(store, "ent-6", "Chain six");
		register(store, "ent-7", "Chain seven");
		merge(store, "m-1", "ent-1", "ent-4");
		merge(store, "m-2", "ent-6", "ent-5");
		merge(store, "m-3", "ent-7", "ent-6");
		expect(idsOf(list(store))).toEqual(["ent-1", "ent-2", "ent-3", "ent-7"]);
		// Absorbed names are found through the representative that carries them.
		expect(idsOf(list(store, { query: { aliasPrefix: "Absorbed" } }))).toEqual([
			"ent-1",
		]);
		expect(
			idsOf(list(store, { query: { aliasPrefix: "Eumenes legacy" } })),
		).toEqual(["ent-1"]);
		// ids resolve to the representative once, also through a chain.
		const byIds = ready(
			list(store, { query: { ids: ["ent-4", "ent-1", "ent-5", "ent-7"] } }),
		);
		expect(byIds.entities.map((e) => e.id)).toEqual(["ent-1", "ent-7"]);
		expect(byIds.entities[0]!.aliases).toContain("Absorbed");
		expect(byIds.entities[0]!.revision).toBeGreaterThan(1);
		// ids and prefix combine as AND on the representative.
		expect(
			idsOf(list(store, { query: { ids: ["ent-5"], aliasPrefix: "Chain" } })),
		).toEqual(["ent-7"]);
		expect(
			idsOf(list(store, { query: { ids: ["ent-5"], aliasPrefix: "Zeta" } })),
		).toEqual([]);
	});

	test("aliasPrefix matches NFC-trimmed names and aliases by prefix only", () => {
		const store = world();
		seed(store);
		register(store, "ent-8", "Café Noir");
		register(store, "ent-9", "\u{1f600}smile");
		const prefix = (text: string) =>
			idsOf(list(store, { query: { aliasPrefix: text } }));
		expect(prefix("Eume")).toEqual(["ent-1", "ent-2", "ent-4"]);
		expect(prefix("eumenes-")).toEqual(["ent-1"]);
		expect(prefix("エウ")).toEqual(["ent-1"]);
		expect(prefix("  mem  ")).toEqual(["ent-2"]);
		// Prefix, not substring; and case follows the package's normal form.
		expect(prefix("menes")).toEqual([]);
		expect(prefix("eumenes")).toEqual(["ent-1"]);
		expect(prefix("Eumenes Memory")).toEqual(["ent-2"]);
		expect(prefix("Eumenes Memoryx")).toEqual([]);
		expect(prefix("Café")).toEqual(["ent-8"]);
		expect(prefix("\u{1f600}")).toEqual(["ent-9"]);
		// An entity matching through several aliases is listed once.
		register(store, "ent-10", "Multi", ["Multi two", "Multi three"]);
		expect(prefix("Multi")).toEqual(["ent-10"]);
		expect(prefix("e")).toEqual(["ent-1"]);
	});

	test("ids select entities; unknown ids are skipped; order is by id", () => {
		const store = world();
		seed(store);
		const result = ready(
			list(store, { query: { ids: ["ent-3", "missing", "ent-1"] } }),
		);
		expect(result.entities.map((e) => e.id)).toEqual(["ent-1", "ent-3"]);
		expect(result.truncated).toBe(false);
		expect(ready(list(store, { query: { ids: [] } })).entities).toEqual([]);
	});

	test("limit truncates with a flag; over-limit and bad input are rejected, not clamped", () => {
		const store = world();
		seed(store);
		const two = ready(list(store, { limit: 2 }));
		expect(two.entities.map((e) => e.id)).toEqual(["ent-1", "ent-2"]);
		expect(two.truncated).toBe(true);
		const exact = ready(list(store, { limit: 4 }));
		expect(exact.entities.length).toBe(4);
		expect(exact.truncated).toBe(false);
		const byIds = ready(
			list(store, { limit: 1, query: { ids: ["ent-1", "ent-2"] } }),
		);
		expect(byIds.entities.length).toBe(1);
		expect(byIds.truncated).toBe(true);
		const prefixed = ready(
			list(store, { limit: 1, query: { aliasPrefix: "Eumenes" } }),
		);
		expect(prefixed.entities.map((e) => e.id)).toEqual(["ent-1"]);
		expect(prefixed.truncated).toBe(true);

		expect(maxListEntities).toBe(500);
		expect(ready(list(store, { limit: 500 })).entities.length).toBe(4);
		const reject = (extra: Record<string, unknown>, reasonCode: string) =>
			expect(list(store, extra)).toEqual({ status: "rejected", reasonCode });
		reject({ limit: 501 }, "LIMIT_EXCEEDED");
		reject({ limit: 0 }, "INVALID_INPUT");
		reject({ limit: 1.5 }, "INVALID_INPUT");
		reject({ limit: undefined }, "INVALID_INPUT");
		reject(
			{ query: { ids: Array.from({ length: 501 }, (_, i) => `x-${i}`) } },
			"LIMIT_EXCEEDED",
		);
		reject({ contractVersion: 2 }, "UNSUPPORTED_CONTRACT_VERSION");
		reject({ query: { kind: "person" } }, "INVALID_INPUT");
		reject({ query: { aliasPrefix: "   " } }, "INVALID_INPUT");
		reject({ query: { aliasPrefix: "" } }, "INVALID_INPUT");
		reject({ query: { ids: ["a", "a"] } }, "INVALID_INPUT");
		reject({ extra: 1 }, "INVALID_INPUT");
		reject({ scopeKey: undefined }, "INVALID_INPUT");
	});

	test("a closed gate blocks the read", () => {
		const store = world();
		seed(store);
		store.write((db) =>
			closeGate(db, A, { reasonCode: "RESTORE_PENDING", restoreEpoch: "r1" }),
		);
		expect(list(store)).toEqual({
			status: "blocked",
			reasonCode: "GATE_CLOSED",
		});
	});

	test("an empty Scope lists nothing", () => {
		const store = world();
		expect(ready(list(store))).toEqual({
			status: "ready",
			entities: [],
			truncated: false,
		});
	});
});
