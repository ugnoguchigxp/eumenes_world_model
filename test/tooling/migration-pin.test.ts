import { expect, test } from "bun:test";
import { planPins, sha256Hex } from "../../scripts/migration-pin.ts";
import { migrationDescriptors } from "../../src/infrastructure/sqlite/migrations/index.ts";
import { migrationManifest } from "../../src/infrastructure/sqlite/migrations/manifest.ts";

const pinned = [
	{ ordinal: 1, id: "a-001", sha256: sha256Hex("CREATE TABLE a;") },
	{ ordinal: 2, id: "b-001", sha256: sha256Hex("CREATE TABLE b;") },
];

test("A22 re-running the pin on the real descriptors changes nothing", () => {
	const plan = planPins(migrationManifest, migrationDescriptors);
	expect(plan.errors).toEqual([]);
	expect(plan.fresh).toEqual([]);
	expect(plan.manifest).toEqual([...migrationManifest]);
});

test("A22 appending a migration pins only the new entry", () => {
	const plan = planPins(pinned, [
		{ id: "a-001", sql: "CREATE TABLE a;" },
		{ id: "b-001", sql: "CREATE TABLE b;" },
		{ id: "a-002", sql: "ALTER TABLE a ADD x;" },
	]);
	expect(plan.errors).toEqual([]);
	expect(plan.fresh).toEqual(["a-002"]);
	expect(plan.manifest.slice(0, 2)).toEqual(pinned);
	expect(plan.manifest[2]).toEqual({
		ordinal: 3,
		id: "a-002",
		sha256: sha256Hex("ALTER TABLE a ADD x;"),
	});
});

test("A22 editing, moving or removing a released migration is refused unless explicitly allowed", () => {
	const edited = planPins(pinned, [
		{ id: "a-001", sql: "CREATE TABLE a (x);" },
		{ id: "b-001", sql: "CREATE TABLE b;" },
	]);
	expect(edited.errors.join()).toContain("a-001 was edited");
	const moved = planPins(pinned, [
		{ id: "b-001", sql: "CREATE TABLE b;" },
		{ id: "a-001", sql: "CREATE TABLE a;" },
	]);
	expect(moved.errors.join()).toContain("moved or renamed");
	const removed = planPins(pinned, [{ id: "a-001", sql: "CREATE TABLE a;" }]);
	expect(removed.errors.join()).toContain("removed");
	// Unreleased development only, and only by an explicit flag.
	const forced = planPins(
		pinned,
		[
			{ id: "a-001", sql: "CREATE TABLE a (x);" },
			{ id: "b-001", sql: "CREATE TABLE b;" },
		],
		true,
	);
	expect(forced.errors).toEqual([]);
	expect(forced.manifest[0]!.sha256).toBe(sha256Hex("CREATE TABLE a (x);"));
});
