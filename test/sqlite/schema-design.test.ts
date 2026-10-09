import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { migrationDescriptors } from "../../src/infrastructure/sqlite/migrations/index.ts";
import { openTestStore } from "../support/sqlite-store.ts";

const doc = readFileSync(
	resolve(import.meta.dir, "../../spec/schema-v1.md"),
	"utf8",
);
const expectedTables = [
	"world_entity",
	"world_alias",
	"world_identity_event",
	"world_assertion",
	"world_assertion_head",
	"world_transition",
	"world_evidence",
	"world_assertion_input",
	"world_current",
	"world_edge",
	"world_scope_epoch",
	"world_prediction",
	"world_outcome",
	"world_inbox",
	"world_input_manifest",
	"world_manifest_dependency",
	"world_checkpoint",
	"world_tombstone",
	"world_forget_operation",
	"world_forget_target",
	"world_scope_gate",
	"world_operation",
	"world_schema_info",
];

/** table -> owning domain, from the migration descriptor that creates it. */
const owners = new Map<string, string>(
	migrationDescriptors.flatMap((descriptor) =>
		[...descriptor.sql.matchAll(/CREATE TABLE (\w+)/g)].map(
			(match) => [match[1]!, descriptor.id.replace(/-\d+$/, "")] as const,
		),
	),
);

describe("schema-v1 design", () => {
	test("every table has exactly one owner", () => {
		expect([...owners.keys()].sort()).toEqual([...expectedTables].sort());
	});
	test("document contains every migration DDL verbatim and a forget policy per table", () => {
		for (const d of migrationDescriptors) expect(doc).toContain(d.sql.trim());
		for (const table of expectedTables) expect(doc).toContain(`| ${table} |`);
	});
	test("C7 table set is complete and nothing else exists", () => {
		const store = openTestStore();
		try {
			const names = store
				.read((db) =>
					db
						.query(
							"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
						)
						.all(),
				)
				.map((r) => (r as { name: string }).name)
				.sort();
			expect(names).toEqual([...expectedTables].sort());
		} finally {
			store.close();
		}
	});
	test("every business table has NOT NULL principal/scope_key leading its primary key; no cross-domain FK", () => {
		const store = openTestStore();
		try {
			store.read((db) => {
				for (const table of expectedTables.filter(
					(t) => t !== "world_schema_info",
				)) {
					const cols = db.query(`PRAGMA table_info(${table})`).all() as {
						name: string;
						notnull: number;
						pk: number;
					}[];
					const byName = new Map(cols.map((c) => [c.name, c]));
					expect(byName.get("principal")?.notnull).toBe(1);
					expect(byName.get("scope_key")?.notnull).toBe(1);
					expect(byName.get("principal")?.pk).toBe(1);
					expect(byName.get("scope_key")?.pk).toBe(2);
					const fks = db.query(`PRAGMA foreign_key_list(${table})`).all() as {
						table: string;
						from: string;
					}[];
					for (const fk of fks) {
						expect(expectedTables).toContain(fk.table);
						// C7: no cross-domain FK; a reference stays inside one owner.
						expect({
							table,
							to: fk.table,
							owner: owners.get(fk.table),
						}).toEqual({
							table,
							to: fk.table,
							owner: owners.get(table),
						});
					}
					const grouped = new Map<number, string[]>();
					for (const fk of db
						.query(`PRAGMA foreign_key_list(${table})`)
						.all() as { id: number; from: string }[])
						grouped.set(fk.id, [...(grouped.get(fk.id) ?? []), fk.from]);
					for (const from of grouped.values()) {
						expect(from).toContain("principal");
						expect(from).toContain("scope_key");
					}
				}
			});
		} finally {
			store.close();
		}
	});
});
