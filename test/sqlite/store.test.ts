import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import type { WorldDb } from "eumenes-world-model/sqlite";
import { migrations } from "eumenes-world-model/sqlite";
import { openTestStore } from "../support/sqlite-store.ts";

// Infrastructure probes only: these are not World schema or World API implementations.
const probeSchema = [
	"CREATE TABLE host_probe (id TEXT PRIMARY KEY); CREATE TABLE world_probe (id TEXT PRIMARY KEY);",
];
function probeWrite(db: WorldDb, id: string) {
	if (!db.inTransaction) throw new Error("transaction_required");
	db.query("INSERT INTO world_probe VALUES (?)").run(id);
}

for (const mode of ["file", "memory"] as const) {
	describe(mode, () => {
		test("caller commits both host and borrowed-port writes", () => {
			const store = openTestStore({ mode, migrations: probeSchema });
			try {
				store.write((db) => {
					db.query("INSERT INTO host_probe VALUES (?)").run("a");
					probeWrite(db, "a");
				});
				expect(
					store.read((db) => db.query("SELECT * FROM world_probe").all()),
				).toEqual([{ id: "a" }]);
				expect(
					store.read((db) => db.query("SELECT * FROM host_probe").all()),
				).toEqual([{ id: "a" }]);
			} finally {
				store.close();
			}
		});

		test("caller failure rolls back both writes", () => {
			const store = openTestStore({ mode, migrations: probeSchema });
			try {
				expect(() =>
					store.write((db) => {
						db.query("INSERT INTO host_probe VALUES (?)").run("a");
						probeWrite(db, "a");
						throw new Error("host_failure");
					}),
				).toThrow("host_failure");
				expect(
					store.read((db) => db.query("SELECT * FROM world_probe").all()),
				).toEqual([]);
				expect(
					store.read((db) => db.query("SELECT * FROM host_probe").all()),
				).toEqual([]);
			} finally {
				store.close();
			}
		});

		test("declared async callback is rejected before running", () => {
			const store = openTestStore({ mode, migrations: probeSchema });
			let called = false;
			try {
				expect(() => {
					// @ts-expect-error Promise-returning transaction callbacks are forbidden.
					store.write(async () => {
						called = true;
					});
				}).toThrow("async_transaction_callback");
				expect(called).toBe(false);
			} finally {
				store.close();
			}
		});

		test("promise return rolls back synchronous work", () => {
			const store = openTestStore({ mode, migrations: probeSchema });
			try {
				expect(() => {
					// @ts-expect-error This also catches non-async functions returning a Promise.
					store.write((db) => {
						probeWrite(db, "a");
						return Promise.resolve();
					});
				}).toThrow("async_transaction_callback");
				expect(
					store.read((db) => db.query("SELECT * FROM world_probe").all()),
				).toEqual([]);
			} finally {
				store.close();
			}
		});
	});
}

test("file host uses WAL, readonly reads, and snapshot isolation", () => {
	const store = openTestStore({ migrations: probeSchema });
	try {
		expect(store.read((db) => db.query("PRAGMA journal_mode").get())).toEqual({
			journal_mode: "wal",
		});
		expect(() => store.read((db) => probeWrite(db, "forbidden"))).toThrow();
		store.read((db) => {
			expect(db.query("SELECT * FROM world_probe").all()).toEqual([]);
			store.write((writer) => {
				probeWrite(writer, "committed");
				expect(db.query("SELECT * FROM world_probe").all()).toEqual([]);
			});
			expect(db.query("SELECT * FROM world_probe").all()).toEqual([]);
		});
		expect(
			store.read((db) => db.query("SELECT * FROM world_probe").all()),
		).toEqual([{ id: "committed" }]);
	} finally {
		store.close();
	}
});

test("stores are isolated and closing removes file, WAL, and directory", () => {
	const first = openTestStore({ migrations: probeSchema });
	const second = openTestStore({ migrations: probeSchema });
	const directory = dirname(first.path);
	try {
		first.write((db) => probeWrite(db, "a"));
		expect(
			second.read((db) => db.query("SELECT * FROM world_probe").all()),
		).toEqual([]);
	} finally {
		first.close();
		second.close();
	}
	first.close();
	expect(existsSync(directory)).toBe(false);
	expect(() => first.read(() => null)).toThrow("test_store_closed");
});

test("failed setup leaves no temporary directory", () => {
	const dirs = () =>
		readdirSync(tmpdir())
			.filter((x) => x.startsWith("eumenes-world-test-"))
			.sort();
	const before = dirs();
	expect(() => openTestStore({ migrations: ["INVALID SQL"] })).toThrow();
	expect(dirs()).toEqual(before);
});

test("default store applies the product migrations; migrations: [] stays schema-free", () => {
	const empty = openTestStore({ migrations: [] });
	try {
		expect(
			empty.read((db) =>
				db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all(),
			),
		).toEqual([]);
	} finally {
		empty.close();
	}
	const store = openTestStore();
	try {
		expect(migrations.length).toBeGreaterThan(0);
		const tables = store.read((db) =>
			db
				.query("SELECT name FROM sqlite_master WHERE type = 'table'")
				.all()
				.map((row) => (row as { name: string }).name),
		);
		expect(tables).toContain("world_schema_info");
		expect(tables).toContain("world_assertion");
	} finally {
		store.close();
	}
});
