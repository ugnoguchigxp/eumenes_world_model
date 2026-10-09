import { closure, isDomain, ownedPath } from "./domains.ts";
import { domainTestFiles } from "./test-domain.ts";
const args = process.argv.slice(2).filter((arg) => arg !== "--");
let domain: string | undefined;
if (args.length === 0 || (args.length === 1 && args[0] === "--all")) {
	console.log("Verify: all scaffold sources and tests");
} else if (args.length === 2 && args[0] === "--domain" && isDomain(args[1]!)) {
	domain = args[1]!;
	console.log(`Domain: ${domain}; owned: ${ownedPath(args[1]!)}`);
	console.log(`Declared dependency closure: ${closure(domain).join(", ")}`);
	domainTestFiles(domain);
	console.log(
		"Shared format/lint/type/boundary checks remain global; tests select the owned domain.",
	);
} else {
	throw new Error("Usage: bun run verify [--all | --domain <domain>]");
}
const commands = [
	["format:check"],
	["lint"],
	["typecheck"],
	["check:boundaries"],
	domain ? ["test:domain", domain] : ["test"],
];
for (const command of commands) {
	const child = Bun.spawn([process.execPath, "run", ...command], {
		stdout: "inherit",
		stderr: "inherit",
	});
	const code = await child.exited;
	if (code !== 0) process.exit(code);
}
console.log(
	"OK: scaffold checks only; World features and Eumenes integration are not implemented.",
);
