import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { boundaryErrors } from "./boundaries.ts";
import { closure, domains, isDomain } from "./domains.ts";
import { walk } from "./files.ts";
const root = resolve(import.meta.dir, "../src");
for (const domain of Object.keys(domains)) closure(domain);
for (const entry of readdirSync(resolve(root, "domains"), {
	withFileTypes: true,
})) {
	if (entry.isDirectory() && !isDomain(entry.name))
		throw new Error(`unregistered_domain:${entry.name}`);
}
const errors = walk(root)
	.filter((file) => /\.[cm]?tsx?$/.test(file))
	.flatMap((file) =>
		boundaryErrors(
			relative(root, file).replaceAll("\\", "/"),
			readFileSync(file, "utf8"),
		),
	);
if (errors.length) {
	console.error(errors.join("\n"));
	process.exit(1);
}
console.log(
	"OK: domain ownership, public entries, declared dependencies and IO boundaries",
);
