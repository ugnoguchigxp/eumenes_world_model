import { afterAll, describe, expect, test } from "bun:test";
import { rebuildProjection } from "../../src/application/sqlite/projection.ts";
import type {
	SqlValue,
	WorldDb,
	WorldStatement,
} from "../../src/infrastructure/sqlite/db.ts";
import {
	PERF_SCOPE,
	type GenOptions,
} from "../../fixtures/performance/generator.ts";
import {
	context,
	realPlans,
	seedWorld,
	sliceOnce,
	writeOnce,
} from "../../fixtures/performance/harness.ts";
import { openTestStore } from "../support/sqlite-store.ts";

/** Counts rows the driver hands back, per call and in total (not scanned rows). */
function countingDb(inner: WorldDb) {
	const counters = { rows: 0, maxPerCall: 0, calls: 0 };
	const db: WorldDb = {
		get inTransaction() {
			return inner.inTransaction;
		},
		exec: (sql) => inner.exec(sql),
		query(sql): WorldStatement {
			const statement = inner.query(sql);
			return {
				all(...params: SqlValue[]) {
					const rows = statement.all(...params);
					counters.rows += rows.length;
					counters.calls++;
					counters.maxPerCall = Math.max(counters.maxPerCall, rows.length);
					return rows;
				},
				get(...params: SqlValue[]) {
					const row = statement.get(...params);
					if (row) counters.rows++;
					counters.calls++;
					return row;
				},
				run: (...params: SqlValue[]) => statement.run(...params),
			};
		},
	};
	return { db, counters };
}

const options: GenOptions = { seed: 7, claims: 2000 };

describe("A33 retrieval limits (machine independent)", () => {
	const store = openTestStore();
	seedWorld(store, options);
	afterAll(() => store.close());

	test("hub / chain / cycle reads never exceed fetch, expansion or output caps", () => {
		for (const focus of [["hub"], ["s-0"], ["s-3", "s-7"], ["s-49"]]) {
			const run = sliceOnce(store, focus, { depth: 4 });
			expect(run.fetchedRows).toBeLessThanOrEqual(500);
			expect(run.expandedRows).toBeLessThanOrEqual(500);
			expect(run.outputBytes).toBeLessThanOrEqual(8192);
			expect(["ready", "partial", "overflow", "blocked"]).toContain(run.status);
		}
	});

	test("a hub that exceeds the budget is reported as partial, never silently cut", () => {
		const run = sliceOnce(store, ["hub"], {
			depth: 2,
			budget: { candidates: 50, expansions: 50 },
		});
		expect(run.partial).toBe(true);
		expect(run.fetchedRows).toBeLessThanOrEqual(50);
		expect(run.expandedRows).toBeLessThanOrEqual(50);
		expect(run.status).not.toBe("ready");
	});

	test("a read touches a number of rows bounded by its budget, not by the ledger", () => {
		const rowsFor = (budget?: { candidates: number; expansions: number }) => {
			let holder: ReturnType<typeof countingDb> | undefined;
			sliceOnce(store, ["s-3"], {
				depth: 2,
				...(budget ? { budget } : {}),
				db: (raw) => {
					holder = countingDb(raw);
					return holder.db;
				},
			});
			return holder!.counters;
		};
		const small = rowsFor({ candidates: 40, expansions: 40 });
		expect(small.rows).toBeLessThan(3 * 40 + 20);
		expect(small.rows).toBeLessThan(options.claims / 10);
		const normal = rowsFor();
		expect(normal.rows).toBeLessThan(3 * 500 + 50);
		expect(normal.maxPerCall).toBeLessThanOrEqual(501);
	});

	test("the repositories' REAL queries use an index on the selective column", () => {
		const plans = store.read((db) => realPlans(db));
		expect(Object.keys(plans).length).toBeGreaterThanOrEqual(10);
		for (const [name, entry] of Object.entries(plans)) {
			expect({ name, statements: entry.statements > 0 }).toEqual({
				name,
				statements: true,
			});
			expect({ name, indexed: entry.indexed }).toEqual({ name, indexed: true });
		}
	});

	test("a full rebuild pages the ledger: no call returns more than one page", () => {
		const probe = openTestStore();
		try {
			seedWorld(probe, { seed: 11, claims: 1300 });
			const before = probe.read(
				(db) =>
					db
						.query(
							"SELECT epoch, material_digest FROM world_scope_epoch WHERE principal = ?",
						)
						.get(PERF_SCOPE.principal) as {
						epoch: number;
						material_digest: string;
					},
			);
			const { counters, changed } = probe.write((raw) => {
				const counting = countingDb(raw);
				const result = rebuildProjection(counting.db, PERF_SCOPE, context());
				return { counters: counting.counters, changed: result.changed };
			});
			// 1300 assertions are read in pages of 500 (+1 sentinel), twice.
			expect(counters.maxPerCall).toBeLessThanOrEqual(501);
			expect(counters.calls).toBeGreaterThan(2);
			expect(changed).toBe(false);
			const after = probe.read(
				(db) =>
					db
						.query(
							"SELECT epoch, material_digest FROM world_scope_epoch WHERE principal = ?",
						)
						.get(PERF_SCOPE.principal) as {
						epoch: number;
						material_digest: string;
					},
			);
			expect(after).toEqual(before);
		} finally {
			probe.close();
		}
	});

	test("ordinary writes stay incremental: rows read do not grow with the ledger", () => {
		const rowsRead = (claims: number) => {
			const s = openTestStore();
			try {
				const opts = { seed: 5, claims };
				seedWorld(s, opts);
				let holder: ReturnType<typeof countingDb> | undefined;
				writeOnce(s, opts, (raw) => {
					holder = countingDb(raw);
					return holder.db;
				});
				return holder!.counters;
			} finally {
				s.close();
			}
		};
		const small = rowsRead(300);
		const large = rowsRead(1500);
		expect(large.rows).toBeLessThanOrEqual(small.rows + 2);
		expect(large.maxPerCall).toBeLessThanOrEqual(501);
	});
});
