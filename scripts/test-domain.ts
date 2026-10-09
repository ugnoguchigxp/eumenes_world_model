import { isDomain, ownedPath } from "./domains.ts";
import { isTest, walk } from "./files.ts";
export function domainTestFiles(
	domain: string,
	scan: (directory: string) => string[] = walk,
): string[] {
	if (!isDomain(domain)) throw new Error(`unknown_domain:${domain}`);
	const files = scan(ownedPath(domain)).filter(isTest).sort();
	if (!files.length)
		throw new Error(`domain_has_no_tests:${domain} (P0: structure only)`);
	return files;
}
if (import.meta.main) {
	const args = process.argv.slice(2).filter((arg) => arg !== "--");
	if (args.length !== 1) throw new Error("Usage: bun run test:domain <domain>");
	const child = Bun.spawn(
		[process.execPath, "test", ...domainTestFiles(args[0]!)],
		{ stdout: "inherit", stderr: "inherit" },
	);
	process.exit(await child.exited);
}
