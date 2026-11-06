import { expect, test } from "bun:test";
import { applyWorldOperation } from "../../src/sqlite.ts";
import {
	access,
	adoptPlan,
	dump,
	envelope,
	hasher,
	hostChecks,
	openWorld,
	registerClaim,
} from "./world-fixture.ts";

test("authorized malformed operation bodies refuse without DML or TypeError", () => {
	const store = openWorld();
	try {
		const before = dump(store);
		const operations = [
			{ kind: "prediction.register" },
			{ kind: "prediction.register", input: null },
			{
				kind: "prediction.register",
				input: { prediction: {}, dueAt: 0, basis: null },
			},
			{ kind: "outcome.register" },
			{ kind: "outcome.register", input: null },
			{ kind: "assertion.transition", plan: { id: "x" } },
			{ kind: "entity.register", entity: null },
			{ kind: "candidate.settle", assertions: [null] },
			{ kind: "inbox.receive", event: null },
			{ kind: "invalidate", targets: [null] },
			{ kind: "forget.chunk", roots: [null] },
			{ kind: "restore.register", registrations: [null] },
			{ kind: "restore.reconcile", journal: null },
			{ kind: "restore.begin", unexpected: true },
		];
		for (const [i, op] of operations.entries()) {
			store.write((db) =>
				expect(
					applyWorldOperation(db, envelope(`bad-${i}`, op), { hasher }),
				).toMatchObject({ status: "rejected" }),
			);
			expect(dump(store)).toEqual(before);
		}
	} finally {
		store.close();
	}
});

test("source state null, wrong type and duplicate identity refuse without writes", () => {
	const store = openWorld();
	try {
		const before = dump(store),
			valid = hostChecks().sourceSnapshot.states[0]!;
		for (const states of [
			[null],
			["invalid"],
			[{ ...valid, status: "invented" }],
			[valid, valid],
		]) {
			store.write((db) =>
				expect(
					applyWorldOperation(
						db,
						{ ...registerClaim(), hostChecks: hostChecks(states) },
						{ hasher },
					),
				).toMatchObject({ status: "rejected" }),
			);
			expect(dump(store)).toEqual(before);
		}
	} finally {
		store.close();
	}
});

test("denial still wins over malformed operation content", () => {
	const store = openWorld();
	try {
		store.write((db) =>
			expect(
				applyWorldOperation(
					db,
					envelope(
						"denied",
						{ kind: "outcome.register" },
						{ access: { ...access(), scopeKeys: [] } },
					),
					{ hasher },
				),
			).toEqual({ status: "rejected", reasonCode: "SCOPE_NOT_PERMITTED" }),
		);
	} finally {
		store.close();
	}
});

test("an adoption plan cannot omit its required adoption proof", () => {
	const store = openWorld();
	try {
		store.write((db) =>
			expect(applyWorldOperation(db, registerClaim(), { hasher }).status).toBe(
				"applied",
			),
		);
		const before = dump(store),
			plan = { ...adoptPlan() };
		delete plan.adoption;
		store.write((db) =>
			expect(
				applyWorldOperation(
					db,
					envelope("missing-adoption", { kind: "assertion.transition", plan }),
					{ hasher },
				),
			).toEqual({ status: "rejected", reasonCode: "INVALID_INPUT" }),
		);
		expect(dump(store)).toEqual(before);
	} finally {
		store.close();
	}
});
