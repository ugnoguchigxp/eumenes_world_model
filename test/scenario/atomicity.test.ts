import { describe, expect, test } from "bun:test";
import {
	WorldTransactionRequiredError,
	readWorldSnapshot,
	validateWorldUsage,
} from "../../src/sqlite.ts";
import type { WorldDb } from "../../src/sqlite.ts";
import {
	buildWorldSlice,
	toSliceReceipt,
} from "../../src/domains/projection/index.ts";
import { failingDb, InjectedFailure } from "../support/failing-db.ts";
import type { TestStore } from "../support/sqlite-store.ts";
import {
	A,
	B,
	NOW,
	access,
	adopt,
	apply,
	claim,
	dump,
	envelope,
	hasher,
	hostChecks,
	openWorld,
	probe,
	registerClaim,
	state,
} from "./world-fixture.ts";

const conditions = {
	subjectId: "svc-1",
	metric: "latency",
	unit: "ms",
	statistic: "p95",
	configuration: "cfg-1",
	inputProfile: "in-1",
};
const prediction = {
	kind: "quantitative",
	predictionId: "pred-1",
	revision: 1,
	comparisonId: "cmp-1",
	conditions,
	baselineRef: "base-1",
	baselineValue: 100,
	expectedWindow: { startMs: 1000, endMs: 2000 },
	expectedDirection: "decreases",
	measurementTolerance: 2,
	origin: "runtime_observation",
};

interface Scenario {
	readonly name: string;
	setup(store: TestStore): void;
	operation(): unknown;
}
const seedClaim = (store: TestStore) =>
	store.write((db) => {
		expect(apply(db, registerClaim("op-seed")).status).toBe("applied");
	});
const scenarios: Scenario[] = [
	{
		name: "assertion.register",
		setup() {},
		operation: () => registerClaim("op-1"),
	},
	{
		name: "assertion.transition(adopt)",
		setup: seedClaim,
		operation: () => adopt("op-2"),
	},
	{
		name: "entity.register",
		setup() {},
		operation: () =>
			envelope("op-e", {
				kind: "entity.register",
				entity: {
					id: "svc-1",
					displayName: "音声サービス",
					aliases: ["音声"],
					externalRefs: [],
				},
			}),
	},
	{
		name: "prediction.register",
		setup() {},
		operation: () =>
			envelope("op-p", {
				kind: "prediction.register",
				input: { prediction, dueAt: NOW + 1000 },
			}),
	},
];

describe("A23 an exception at every DML stage rolls everything back", () => {
	for (const scenario of scenarios) {
		test(scenario.name, () => {
			// Count the DML statements of a normal run first.
			const probeStore = openWorld();
			let stages = 0;
			try {
				scenario.setup(probeStore);
				probeStore.write((db) => {
					probe(db);
					const wrapped = failingDb(db, 0);
					expect(apply(wrapped, scenario.operation()).status).toBe("applied");
					stages = wrapped.dmlCount;
				});
				const committed = dump(probeStore);
				expect(committed["host_probe"]).toHaveLength(1);
				expect(committed["world_operation"]!.length).toBeGreaterThan(0);
			} finally {
				probeStore.close();
			}
			expect(stages).toBeGreaterThanOrEqual(2);

			for (let failAt = 1; failAt <= stages; failAt++) {
				const store = openWorld();
				try {
					scenario.setup(store);
					const before = dump(store);
					expect(() =>
						store.write((db) => {
							probe(db);
							apply(failingDb(db, failAt), scenario.operation());
						}),
					).toThrow(InjectedFailure);
					// Ledger, projection, epoch, receipt, host_probe and queue: all as before.
					expect(dump(store)).toEqual(before);
				} finally {
					store.close();
				}
			}
		});
	}
});

describe("A25 a later host-side Memory rejection rolls World back too", () => {
	test("World applied, then Memory registration fails => nothing is committed", () => {
		const store = openWorld();
		try {
			const before = dump(store);
			expect(() =>
				store.write((db) => {
					probe(db);
					expect(apply(db, registerClaim("op-1")).status).toBe("applied");
					throw new Error("memory dependency registration rejected");
				}),
			).toThrow("memory dependency registration rejected");
			expect(dump(store)).toEqual(before);
			// The same operation succeeds once the host step succeeds.
			store.write((db) => {
				probe(db);
				expect(apply(db, registerClaim("op-1")).status).toBe("applied");
			});
			const after = dump(store);
			expect(after["host_probe"]).toHaveLength(1);
			expect(after["host_queue"]).toHaveLength(1);
			expect(after["world_assertion"]).toHaveLength(1);
			expect(after["world_operation"]).toHaveLength(1);
		} finally {
			store.close();
		}
	});
});

describe("transaction ownership", () => {
	test("A21 a write outside a transaction throws before touching SQL", () => {
		const untouched = {
			inTransaction: false,
			exec() {
				throw new Error("sql_touched");
			},
			query() {
				throw new Error("sql_touched");
			},
		} as unknown as WorldDb;
		expect(() => apply(untouched, registerClaim())).toThrow(
			WorldTransactionRequiredError,
		);
		expect(() => readWorldSnapshot(untouched, {})).toThrow(
			WorldTransactionRequiredError,
		);
		expect(() => validateWorldUsage(untouched, {}, {})).toThrow(
			WorldTransactionRequiredError,
		);
	});
	test("an unknown operation kind is rejected without any DML", () => {
		const store = openWorld();
		try {
			const before = dump(store);
			store.write((db) => {
				expect(
					apply(db, envelope("op-x", { kind: "does.not.exist", payload: {} })),
				).toEqual({ status: "rejected", reasonCode: "INVALID_INPUT" });
			});
			expect(dump(store)).toEqual(before);
		} finally {
			store.close();
		}
	});
	test("no connection or state is retained: two stores run the same operation independently", () => {
		const one = openWorld();
		const two = openWorld();
		try {
			one.write((db) =>
				expect(apply(db, registerClaim("op-1")).status).toBe("applied"),
			);
			two.write((db) =>
				expect(apply(db, registerClaim("op-1")).status).toBe("applied"),
			);
			one.close();
			expect(() =>
				one.write((db) => apply(db, registerClaim("op-9"))),
			).toThrow();
			two.write((db) =>
				expect(apply(db, registerClaim("op-1")).status).toBe("no_op"),
			);
		} finally {
			one.close();
			two.close();
		}
	});
	test("access outside the permitted Scope and foreign sources get one indistinguishable denial", () => {
		const store = openWorld();
		try {
			store.write((db) => {
				expect(
					apply(
						db,
						registerClaim("op-a", {}) && {
							...registerClaim("op-a"),
							access: access(["scope-b"]),
						},
					),
				).toEqual({
					status: "rejected",
					reasonCode: "SCOPE_NOT_PERMITTED",
				});
				const missing = apply(db, {
					...registerClaim("op-b"),
					hostChecks: hostChecks([]),
				});
				const foreign = apply(db, {
					...registerClaim("op-c"),
					hostChecks: hostChecks([
						state({ principal: "p-z", scopeKey: "scope-z" }),
					]),
				});
				expect(missing).toEqual({
					status: "rejected",
					reasonCode: "SOURCE_NOT_AVAILABLE",
				});
				expect(foreign).toEqual(missing);
				expect(
					apply(db, {
						...registerClaim("op-d"),
						hostChecks: hostChecks([state({ revision: "rev-2" })]),
					}),
				).toEqual({
					status: "rejected",
					reasonCode: "SOURCE_VERSION_MISMATCH",
				});
			});
			expect(dump(store)["world_assertion"]).toHaveLength(0);
		} finally {
			store.close();
		}
	});
});

describe("A24 a Slice receipt is invalidated by scope epoch, not by matching IDs", () => {
	test("new claim in the same Scope invalidates; another Scope's update does not", () => {
		const store = openWorld();
		try {
			store.write((db) => {
				expect(apply(db, registerClaim("op-1")).status).toBe("applied");
				expect(apply(db, adopt("op-2")).status).toBe("applied");
			});
			const request = {
				contractVersion: 1,
				access: access(),
				scope: A,
				asOf: NOW,
				hostChecks: hostChecks(),
			};
			const current = {
				contractVersion: 1,
				access: access(),
				scope: A,
				hostChecks: hostChecks(),
			};
			const receipt = store.write((db) => {
				const read = readWorldSnapshot(db, request);
				if (read.status !== "ready") throw new Error(read.reasonCode);
				expect(read.snapshot.scopeEpoch).toBeGreaterThanOrEqual(1);
				const slice = buildWorldSlice(
					{ contractVersion: 1, snapshot: read.snapshot, request: {} },
					hasher,
				);
				if (!slice.ok) throw new Error(slice.code);
				expect(["ready", "partial"]).toContain(slice.value.status);
				return toSliceReceipt(slice.value);
			});
			store.write((db) => {
				expect(validateWorldUsage(db, receipt, current)).toEqual({
					status: "valid",
				});
				// Update in ANOTHER Scope: still valid.
				const other = envelope(
					"op-b1",
					{
						kind: "assertion.register",
						assertion: claim({ id: "claim-b", scope: B }),
					},
					{
						scope: B,
						access: access(["scope-b"]),
						hostChecks: hostChecks([state({ scopeKey: "scope-b" })]),
					},
				);
				expect(apply(db, other).status).toBe("applied");
				expect(validateWorldUsage(db, receipt, current)).toEqual({
					status: "valid",
				});
				// New claim in the SAME Scope: epoch changes, old receipt refused.
				expect(
					apply(
						db,
						registerClaim("op-3", { id: "claim-2", predicate: "other" }),
					).status,
				).toBe("applied");
				expect(validateWorldUsage(db, receipt, current)).toEqual({
					status: "blocked",
					reasonCode: "SCOPE_EPOCH_CHANGED",
				});
				// Changed host facts are also refused.
				const changed = {
					...current,
					hostChecks: { ...hostChecks(), restoreEpoch: "r2" },
				};
				expect(validateWorldUsage(db, receipt, changed).status).toBe("blocked");
			});
		} finally {
			store.close();
		}
	});
});
