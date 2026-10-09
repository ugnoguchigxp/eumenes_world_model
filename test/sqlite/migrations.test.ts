import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import {
	migrationDescriptors,
	migrations,
} from "../../src/infrastructure/sqlite/migrations/index.ts";
import { migrationManifest } from "../../src/infrastructure/sqlite/migrations/manifest.ts";
import {
	checkSchemaCompatibility,
	type AppliedMigration,
} from "../../src/infrastructure/sqlite/migrations/verify.ts";
import { openTestStore } from "../support/sqlite-store.ts";

const sha = (text: string) =>
	createHash("sha256").update(text, "utf8").digest("hex");
const rows = (store: ReturnType<typeof openTestStore>) =>
	store.read(
		(db) =>
			db
				.query(
					"SELECT ordinal, migration_id, sha256 FROM world_schema_info ORDER BY ordinal",
				)
				.all() as AppliedMigration[],
	);
const schema = (store: ReturnType<typeof openTestStore>) =>
	store.read((db) =>
		db
			.query(
				"SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
			)
			.all(),
	);

test("A22 descriptors are pinned: sha256 matches the SQL and the manifest, order is fixed", () => {
	expect(migrationDescriptors.length).toBe(migrationManifest.length);
	for (const [index, descriptor] of migrationDescriptors.entries()) {
		expect(descriptor.sha256).toBe(sha(descriptor.sql));
		expect(migrationManifest[index]).toEqual({
			ordinal: index + 1,
			id: descriptor.id,
			sha256: descriptor.sha256,
		});
	}
	expect(migrationDescriptors[0]!.id).toBe("infrastructure-001");
	expect(migrations.length).toBe(migrationDescriptors.length);
	expect(Object.isFrozen(migrations)).toBe(true);
});

test("A22 fresh database records every migration and is current", () => {
	const store = openTestStore();
	try {
		const applied = rows(store);
		expect(applied.map((r) => r.migration_id)).toEqual(
			migrationDescriptors.map((d) => d.id),
		);
		expect(checkSchemaCompatibility(applied)).toEqual({ status: "current" });
	} finally {
		store.close();
	}
});

test("A22 upgrade from an older schema yields the same schema as a fresh install", () => {
	const fresh = openTestStore();
	const upgraded = openTestStore({ migrations: migrations.slice(0, 3) });
	try {
		expect(checkSchemaCompatibility(rows(upgraded))).toEqual({
			status: "upgrade_needed",
			from: 3,
		});
		upgraded.write((db) => {
			for (const sql of migrations.slice(3)) db.exec(sql);
		});
		expect(checkSchemaCompatibility(rows(upgraded))).toEqual({
			status: "current",
		});
		expect(schema(upgraded)).toEqual(schema(fresh));
	} finally {
		fresh.close();
		upgraded.close();
	}
});

test("A22 hash tamper, future schema and reorder are refused", () => {
	const store = openTestStore();
	try {
		const applied = rows(store);
		expect(
			checkSchemaCompatibility(
				applied.map((r, i) => (i === 2 ? { ...r, sha256: "0".repeat(64) } : r)),
			),
		).toEqual({
			status: "incompatible",
			reasonCode: "MIGRATION_HASH_MISMATCH",
		});
		expect(
			checkSchemaCompatibility([
				...applied,
				{
					ordinal: applied.length + 1,
					migration_id: "future-001",
					sha256: "a".repeat(64),
				},
			]),
		).toEqual({ status: "incompatible", reasonCode: "FUTURE_SCHEMA" });
		const swapped = applied.map((r, i) =>
			i === 1 ? { ...r, migration_id: applied[2]!.migration_id } : r,
		);
		expect(checkSchemaCompatibility(swapped)).toEqual({
			status: "incompatible",
			reasonCode: "MIGRATION_ORDER_MISMATCH",
		});
	} finally {
		store.close();
	}
});

test("A22 a failing migration rolls back entirely, including its record", () => {
	const broken = `${migrationDescriptors[1]!.sql}\nTHIS IS NOT SQL;`;
	const store = openTestStore({ migrations: migrations.slice(0, 1) });
	try {
		expect(() => store.write((db) => db.exec(broken))).toThrow();
		const tables = store.read((db) =>
			db
				.query("SELECT name FROM sqlite_master WHERE name = 'world_entity'")
				.all(),
		);
		expect(tables).toEqual([]);
		expect(rows(store).length).toBe(1);
	} finally {
		store.close();
	}
});
