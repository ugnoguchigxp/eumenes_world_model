import { resolve, relative, dirname } from "node:path";
import ts from "typescript";
import { closure, domains, type DomainGraph } from "./domains.ts";
import { isTest } from "./files.ts";
const root = resolve(import.meta.dir, "../src");
/** The one file allowed to `import type` the pinned Memory distribution. */
const memoryPackage = "eumenes-memory";
const memoryTypeEntry = "contracts/source.ts";
/** Ambient clocks, randomness, timers, network and host objects. */
const ambientGlobals = new Set([
	"Bun",
	"process",
	"Date",
	"performance",
	"crypto",
	"globalThis",
	"setTimeout",
	"setInterval",
	"setImmediate",
	"WebSocket",
	"XMLHttpRequest",
	"EventSource",
]);
const slash = (path: string) => path.replaceAll("\\", "/");
const owner = (name: string) => /^domains\/([^/]+)\//.exec(name)?.[1];
const persistence = (name: string) =>
	name === "sqlite.ts" ||
	name.startsWith("infrastructure/sqlite/") ||
	name.startsWith("application/sqlite/") ||
	/^domains\/[^/]+\/(sqlite\.ts|repository\/)/.test(name);
const publicDomainPath = (name: string) =>
	/^domains\/[^/]+\/(index\.ts|sqlite\.ts|contracts\/index\.ts)$/.test(name);
/**
 * False for names that merely spell a global (obj.process, { Date: 1 },
 * class members); true for anything that can resolve to the ambient global.
 */
function isGlobalReference(node: ts.Identifier): boolean {
	const parent = node.parent;
	if (ts.isPropertyAccessExpression(parent) && parent.name === node)
		return false;
	if (ts.isQualifiedName(parent) && parent.right === node) return false;
	if (
		(ts.isPropertyAssignment(parent) ||
			ts.isPropertySignature(parent) ||
			ts.isPropertyDeclaration(parent) ||
			ts.isMethodDeclaration(parent) ||
			ts.isMethodSignature(parent) ||
			ts.isEnumMember(parent)) &&
		parent.name === node
	)
		return false;
	if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
	if (
		(ts.isGetAccessorDeclaration(parent) ||
			ts.isSetAccessorDeclaration(parent)) &&
		parent.name === node
	)
		return false;
	return true;
}
/** Static guard, not a sandbox for aliases or computed SQL. Paths are src-relative. */
export function boundaryErrors(
	name: string,
	code: string,
	graph: DomainGraph = domains,
): string[] {
	const errors: string[] = [];
	const file = resolve(root, name);
	const domain = owner(name);
	// Only `*.test.ts` and a domain's own `test/` directory are test code; a
	// directory named `test` anywhere else (service/test/…) is production code.
	const test = isTest(name) || /^domains\/[^/]+\/test\//.test(name);
	const sql = persistence(name);
	if (domain && !Object.hasOwn(graph, domain))
		return [`${name}: unregistered domain`];
	const allowed = domain
		? test
			? closure(domain, graph)
			: graph[domain]!.depends
		: [];
	const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
	const fail = (message: string) => errors.push(`${name}: ${message}`);
	function checkImport(spec: string, typeOnly = false) {
		if (!spec.startsWith(".")) {
			if (spec.startsWith(`${memoryPackage}/`)) {
				fail(`${memoryPackage} private subpath is not allowed: ${spec}`);
				return;
			}
			if (test && (spec === "bun:sqlite" || spec === "node:sqlite")) {
				fail("real SQLite connections belong to test/support");
				return;
			}
			if (spec === memoryPackage) {
				if (name !== memoryTypeEntry || !typeOnly)
					fail(
						`${memoryPackage} may only be type-imported by ${memoryTypeEntry}`,
					);
				return;
			}
			if (!test)
				fail(`external import requires an explicit boundary decision: ${spec}`);
			else if (spec.startsWith("eumenes-world-model"))
				fail("domain tests must use relative domain entries");
			else if (spec.startsWith("/") || /^(src|test|scripts)\//.test(spec))
				fail(`tests must import by relative path, not ${spec}`);
			return;
		}
		let target = slash(relative(root, resolve(dirname(file), spec)));
		// Bundler resolution would pick X.ts or X/index.ts; the checker must
		// not guess, so every relative import has to name its file.
		if (!/\.(ts|js|mts|cts|json)$/.test(target)) {
			fail(`relative import must name its file extension: ${spec}`);
			target += "/index.ts";
		}
		target = target.replace(/\.js$/, ".ts");
		if (target.startsWith("..")) {
			if (!test || !target.startsWith("../test/support/"))
				fail(`import escapes src: ${spec}`);
			return;
		}
		const targetDomain = owner(target);
		if (targetDomain && !Object.hasOwn(graph, targetDomain))
			fail(`unregistered target domain: ${targetDomain}`);
		if (!test && (isTest(target) || target.includes("/test/")))
			fail("production imports tests");
		if (targetDomain && targetDomain !== domain) {
			if (!publicDomainPath(target)) fail(`domain private import: ${spec}`);
			if (domain && !allowed.includes(targetDomain))
				fail(`undeclared domain dependency: ${targetDomain}`);
		}
		if (
			(domain || name.startsWith("application/")) &&
			["index.ts", "sqlite.ts"].includes(target)
		)
			fail("domain or application imports package barrel");
		if (target.startsWith("application/") && !name.startsWith("application/")) {
			if (name !== "sqlite.ts")
				fail("only the package sqlite entry imports application");
		}
		if (
			name.startsWith("application/") &&
			target.startsWith("infrastructure/")
		) {
			if (target !== "infrastructure/sqlite/db.ts")
				fail("application imports infrastructure implementation");
		}
		if (!test && !sql && persistence(target))
			fail(`pure layer imports persistence: ${spec}`);
		if (
			!test &&
			name.startsWith("contracts/") &&
			!target.startsWith("contracts/")
		)
			fail("shared contracts import an upper layer");
		if (
			!test &&
			/^domains\/[^/]+\/contracts\//.test(name) &&
			!target.startsWith("contracts/") &&
			!/^domains\/[^/]+\/contracts\//.test(target)
		)
			fail("contracts import an upper layer");
		if (
			domain &&
			target.startsWith("infrastructure/") &&
			target !== "infrastructure/sqlite/db.ts"
		)
			fail("domain imports infrastructure implementation");
		if (
			name.startsWith("infrastructure/") &&
			targetDomain &&
			!(
				name.startsWith("infrastructure/sqlite/migrations/") &&
				target.endsWith("/sqlite.ts")
			)
		)
			fail("infrastructure imports domain behavior");
	}
	function visit(node: ts.Node) {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			const spec = node.moduleSpecifier;
			const typeOnly = ts.isImportDeclaration(node)
				? node.importClause?.isTypeOnly === true
				: node.isTypeOnly;
			if (spec && ts.isStringLiteral(spec)) checkImport(spec.text, typeOnly);
		}
		if (
			ts.isImportTypeNode(node) &&
			ts.isLiteralTypeNode(node.argument) &&
			ts.isStringLiteral(node.argument.literal)
		)
			checkImport(node.argument.literal.text);
		if (ts.isImportEqualsDeclaration(node))
			fail("import assignment is not allowed");
		if (
			test &&
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword
		) {
			// Dynamic import in tests still obeys the static boundary rules.
			const arg = node.arguments[0];
			if (arg && ts.isStringLiteralLike(arg)) checkImport(arg.text);
			else fail("dynamic import needs a literal specifier");
		}
		if (!test) {
			if (ts.isCallExpression(node)) {
				const expression = node.expression;
				if (
					expression.kind === ts.SyntaxKind.ImportKeyword ||
					(ts.isIdentifier(expression) &&
						["require", "fetch", "eval"].includes(expression.text))
				)
					fail("runtime loading or IO is not allowed");
				if (
					ts.isPropertyAccessExpression(expression) &&
					expression.name.text === "require"
				)
					fail("runtime loading or IO is not allowed");
				if (ts.isIdentifier(expression) && expression.text === "Function")
					fail("dynamic code evaluation is not allowed");
				if (
					ts.isPropertyAccessExpression(expression) &&
					["transaction", "close", "open"].includes(expression.name.text)
				)
					fail("connection lifecycle belongs to the host");
				if (
					ts.isPropertyAccessExpression(expression) &&
					["exec", "query", "prepare", "run"].includes(expression.name.text)
				) {
					for (const arg of node.arguments) {
						if (
							(ts.isStringLiteral(arg) ||
								ts.isNoSubstitutionTemplateLiteral(arg)) &&
							/\b(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|PRAGMA)\b/i.test(
								arg.text,
							)
						)
							fail("transaction/PRAGMA SQL belongs to the host");
					}
				}
			}
			if (
				ts.isIdentifier(node) &&
				ambientGlobals.has(node.text) &&
				isGlobalReference(node)
			)
				fail(`runtime global ${node.text} is not allowed`);
			if (
				ts.isNewExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === "Function"
			)
				fail("dynamic code evaluation is not allowed");
			// const { random } = Math  /  Math["random"]
			if (
				ts.isVariableDeclaration(node) &&
				ts.isObjectBindingPattern(node.name) &&
				node.initializer &&
				ts.isIdentifier(node.initializer) &&
				node.initializer.text === "Math" &&
				node.name.elements.some(
					(element) =>
						(element.propertyName ?? element.name).getText(source) === "random",
				)
			)
				fail("random must be injected");
			if (
				ts.isElementAccessExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === "Math" &&
				ts.isStringLiteralLike(node.argumentExpression) &&
				node.argumentExpression.text === "random"
			)
				fail("random must be injected");
			if (
				ts.isPropertyAccessExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === "Math" &&
				node.name.text === "random"
			)
				fail("random must be injected");
			if (
				node.kind === ts.SyntaxKind.AsyncKeyword ||
				ts.isAwaitExpression(node) ||
				(ts.isForOfStatement(node) && node.awaitModifier !== undefined)
			)
				fail(
					sql
						? "persistence must be synchronous"
						: "pure layer must be synchronous",
				);
			if (!sql && ts.isIdentifier(node) && node.text === "Promise")
				fail("pure layer must be synchronous");
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	return errors;
}
