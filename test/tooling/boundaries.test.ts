import { expect, test } from "bun:test";
import { boundaryErrors } from "../../scripts/boundaries.ts";
import { closure, isDomain } from "../../scripts/domains.ts";
import { domainTestFiles } from "../../scripts/test-domain.ts";

const graph = {
	identity: { depends: [] },
	assertions: { depends: ["identity"] },
	projection: { depends: ["assertions"] },
};
const check = (file: string, code: string) => boundaryErrors(file, code, graph);

test("declared public imports work; private paths and undeclared edges fail", () => {
	expect(
		check(
			"domains/assertions/service/index.ts",
			'import {} from "../../identity/index.ts"',
		),
	).toEqual([]);
	expect(
		check(
			"domains/assertions/service/index.ts",
			'import {} from "../../identity/service/index.ts"',
		).join(),
	).toContain("domain private import");
	expect(
		check(
			"domains/projection/service/index.ts",
			'import {} from "../../identity/index.ts"',
		).join(),
	).toContain("undeclared domain dependency");
});

test("re-exports and import types cannot bypass a private boundary", () => {
	for (const code of [
		'export * from "../../identity/repository/index.ts"',
		'type T = import("../../identity/service/index.ts").T',
	]) {
		expect(
			check("domains/assertions/repository/index.ts", code).join(),
		).toContain("domain private import");
	}
});

test("pure services cannot load own persistence; repositories can borrow the DB port", () => {
	expect(
		check(
			"domains/assertions/service/index.ts",
			'import {} from "../repository/index.ts"',
		).join(),
	).toContain("pure layer imports persistence");
	expect(
		check(
			"domains/assertions/repository/index.ts",
			'import type { WorldDb } from "../../../infrastructure/sqlite/db.ts"',
		),
	).toEqual([]);
	expect(
		check(
			"domains/assertions/repository/index.ts",
			'import {} from "../../../sqlite.ts"',
		).join(),
	).toContain("package barrel");
});

test("contracts stay below behavior; shared contracts cannot depend on a domain", () => {
	expect(
		check(
			"domains/assertions/contracts/index.ts",
			'import {} from "../service/index.ts"',
		).join(),
	).toContain("contracts import an upper layer");
	expect(
		check(
			"contracts/index.ts",
			'export * from "../domains/identity/index.ts"',
		).join(),
	).toContain("shared contracts import an upper layer");
});

test("only migration aggregation may reference domain SQLite entries from infrastructure", () => {
	expect(
		check(
			"infrastructure/sqlite/migrations/index.ts",
			'import {} from "../../../domains/identity/sqlite.ts"',
		),
	).toEqual([]);
	expect(
		check(
			"infrastructure/sqlite/db.ts",
			'import {} from "../../domains/identity/sqlite.ts"',
		).join(),
	).toContain("infrastructure imports domain behavior");
});

test("domain tests can use dependency closure and support, but not another domain's internals", () => {
	expect(
		check(
			"domains/projection/test/read.test.ts",
			'import {} from "../../identity/index.ts"; import {} from "../../../../test/support/sqlite-store.ts"',
		),
	).toEqual([]);
	expect(
		check(
			"domains/projection/test/read.test.ts",
			'import {} from "../../identity/repository/index.ts"',
		).join(),
	).toContain("domain private import");
	expect(
		check(
			"domains/projection/service/index.ts",
			'import {} from "../test/read.test.ts"',
		).join(),
	).toContain("production imports tests");
});

const expectMessage = (file: string, code: string, message: string) => {
	const errors = check(file, code);
	expect({ code, found: errors.some((e) => e.includes(message)) }).toEqual({
		code,
		found: true,
	});
};

test("writer ownership and synchronous persistence stay with the host", () => {
	for (const [code, message] of [
		["db.transaction(() => {})", "connection lifecycle belongs to the host"],
		['db.exec("BEGIN")', "transaction/PRAGMA SQL belongs to the host"],
		[
			'db.query("PRAGMA journal_mode=WAL")',
			"transaction/PRAGMA SQL belongs to the host",
		],
		["async function save() {}", "persistence must be synchronous"],
	] as const)
		expectMessage("domains/assertions/repository/index.ts", code, message);
	expect(
		check(
			"domains/assertions/repository/index.ts",
			'db.query("INSERT INTO world_probe VALUES (?)").run(value)',
		),
	).toEqual([]);
});

test("pure code rejects external IO, dynamic loading and ambient time/randomness", () => {
	for (const [code, message] of [
		[
			'import { Database } from "bun:sqlite"',
			"external import requires an explicit boundary decision",
		],
		['import("../index.ts")', "runtime loading or IO is not allowed"],
		["Date.now()", "runtime global Date"],
		["Math.random()", "random must be injected"],
		["fetch(url)", "runtime loading or IO is not allowed"],
		["performance.now()", "runtime global performance"],
		["crypto.randomUUID()", "runtime global crypto"],
		["crypto.getRandomValues(buffer)", "runtime global crypto"],
		["setTimeout(run, 1)", "runtime global setTimeout"],
		["setInterval(run, 1)", "runtime global setInterval"],
		["globalThis.fetch(url)", "runtime global globalThis"],
		['globalThis["Date"].now()', "runtime global globalThis"],
		["new WebSocket(url)", "runtime global WebSocket"],
		["new XMLHttpRequest()", "runtime global XMLHttpRequest"],
		['new Function("return 1")', "dynamic code evaluation is not allowed"],
		["const { random } = Math", "random must be injected"],
		['Math["random"]()', "random must be injected"],
		['module.require("node:fs")', "runtime loading or IO is not allowed"],
	] as const)
		expectMessage("domains/assertions/service/index.ts", code, message);
});

test("only a domain's own test directory is exempt, not any folder named test", () => {
	expectMessage(
		"domains/assertions/service/test/evil.ts",
		"Date.now()",
		"runtime global Date",
	);
	expect(check("domains/assertions/test/helpers.ts", "Date.now()")).toEqual([]);
	expect(check("domains/assertions/test/a.test.ts", "Date.now()")).toEqual([]);
});

test("tests keep relative, literal, boundary-checked imports", () => {
	const file = "domains/projection/test/a.test.ts";
	expectMessage(
		file,
		'import("../../identity/repository/entities.ts")',
		"domain private import",
	);
	expectMessage(
		file,
		"import(someVariable)",
		"dynamic import needs a literal specifier",
	);
	expectMessage(
		file,
		'import {} from "src/index.ts"',
		"tests must import by relative path",
	);
	expectMessage(
		file,
		'import {} from "/Users/x/src/index.ts"',
		"tests must import by relative path",
	);
	expect(check(file, 'import { test } from "bun:test"')).toEqual([]);
});

test("dependency graph rejects cycles, unknown names and inherited object keys", () => {
	expect(closure("projection", graph)).toEqual([
		"identity",
		"assertions",
		"projection",
	]);
	expect(() =>
		closure("a", { a: { depends: ["b"] }, b: { depends: ["a"] } }),
	).toThrow("domain_dependency_cycle");
	expect(() => closure("a", { a: { depends: ["missing"] } })).toThrow(
		"unknown_domain",
	);
	expect(isDomain("constructor")).toBe(false);
});

test("unknown domains and empty reserved domains cannot pass as tested", () => {
	expect(() => domainTestFiles("missing")).toThrow("unknown_domain");
	expect(() => domainTestFiles("identity", () => [])).toThrow(
		"domain_has_no_tests",
	);
});

test("A17 only contracts/source.ts may type-import the pinned Memory package", () => {
	const typeImport = 'import type { SourceRef } from "eumenes-memory"';
	expect(check("contracts/source.ts", typeImport)).toEqual([]);
	expect(
		check(
			"contracts/source.ts",
			'export type { SourceRef } from "eumenes-memory"',
		),
	).toEqual([]);
	for (const [file, code] of [
		["contracts/source.ts", 'import { SourceRef } from "eumenes-memory"'],
		["contracts/source.ts", 'import "eumenes-memory"'],
		[
			"contracts/source.ts",
			'import type { X } from "eumenes-memory/dist/index.js"',
		],
		["contracts/source.ts", 'export { sourceKey } from "eumenes-memory"'],
		["contracts/other.ts", typeImport],
		["domains/assertions/service/a.ts", typeImport],
		[
			"contracts/source.ts",
			'import type { X } from "../../../eumenes_memory/src/index.ts"',
		],
	] as const)
		expect(check(file, code).length).toBeGreaterThan(0);
});

test("A17 application layer: sits above domains, domains cannot import it", () => {
	expect(
		check(
			"application/sqlite/apply.ts",
			'import {} from "../../domains/identity/sqlite.ts"; import {} from "../../domains/identity/index.ts"; import {} from "../../infrastructure/sqlite/db.ts"',
		),
	).toEqual([]);
	for (const [code, message] of [
		[
			'import {} from "../../domains/identity/repository/entities.ts"',
			"domain private import",
		],
		['import {} from "../../sqlite.ts"', "package barrel"],
		[
			'import {} from "../../infrastructure/sqlite/migrations/index.ts"',
			"application imports infrastructure implementation",
		],
		["async function f() {}", "persistence must be synchronous"],
		['db.exec("BEGIN")', "transaction/PRAGMA SQL belongs to the host"],
		["Date.now()", "runtime global Date"],
	] as const)
		expectMessage("application/sqlite/apply.ts", code, message);
	expect(
		check(
			"domains/identity/sqlite.ts",
			'import {} from "../../application/sqlite/index.ts"',
		).join(),
	).toContain("application");
	expect(
		check("contracts/x.ts", 'import {} from "../application/sqlite/index.ts"')
			.length,
	).toBeGreaterThan(0);
	expect(
		check("sqlite.ts", 'export * from "./application/sqlite/index.ts"'),
	).toEqual([]);
});

test("A17 round 2: extensionless specifiers, test-only SQLite, Memory subpaths, async in pure layers", () => {
	const pure = "domains/projection/service/leak.ts";
	expect(check(pure, 'import {x} from "../sqlite"').join()).toContain(
		"must name its file extension",
	);
	expect(
		check(
			"domains/assertions/service/leak.ts",
			'import * as b from "../../../index"',
		).join(),
	).toContain("must name its file extension");
	expect(
		check(
			"domains/assertions/test/a.test.ts",
			'import {} from "bun:sqlite"',
		).join(),
	).toContain("test/support");
	expect(
		check(
			"domains/assertions/test/a.test.ts",
			'import {} from "eumenes-memory/src/private"',
		).join(),
	).toContain("private subpath");
	expect(check(pure, "export const f = async () => 1;").join()).toContain(
		"pure layer must be synchronous",
	);
	expect(
		check(pure, "export const f = () => Promise.resolve(1);").join(),
	).toContain("pure layer must be synchronous");
	expect(check(pure, "export const f = async () => 1;").length).toBeGreaterThan(
		0,
	);
	// persistence layers keep their own message
	expect(
		check("domains/assertions/repository/a.ts", "async function f() {}").join(),
	).toContain("persistence must be synchronous");
});

test("H2 .js specifiers map to .ts and still hit the private-path rule", () => {
	expect(
		check(
			"domains/assertions/service/a.ts",
			'import {} from "../../identity/service/index.js"',
		).join(),
	).toContain("domain private import");
	expect(
		check(
			"domains/assertions/service/a.ts",
			'import {} from "../../identity/index.js"',
		),
	).toEqual([]);
});

test("H2 dotted extensionless names cannot pass as having an extension", () => {
	for (const spec of ["./project.test", "./x.v2", "../sqlite"])
		expect(
			check(
				"domains/projection/service/a.ts",
				`import {} from "${spec}"`,
			).join(),
		).toContain("must name its file extension");
	expect(
		check("domains/projection/service/a.ts", 'import {} from "./b.ts"'),
	).toEqual([]);
});

test("H2 top-level await, for await and async are rejected in pure code", () => {
	for (const code of [
		"await Promise.resolve(1)",
		"for await (const x of xs) {}",
		"async function f() {}",
	])
		expect(check("domains/projection/service/a.ts", code).join()).toMatch(
			/synchronous/,
		);
});

test("H2 names that only spell a global are not globals", () => {
	for (const code of [
		"const a = { Date: 1, process: 2 }",
		"declare const o: { performance: number }; o.performance",
		"class K { crypto = 1; Date() {} }",
		"const { process: p } = {} as { process: number }; void p",
	])
		expect(check("domains/projection/service/a.ts", code)).toEqual([]);
	for (const code of [
		"Date.now()",
		"const { random } = Math",
		"const x = { Date }",
		"performance.now()",
	])
		expect(
			check("domains/projection/service/a.ts", code).length,
		).toBeGreaterThan(0);
});
