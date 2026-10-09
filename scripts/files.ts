import { readdirSync } from "node:fs";
import { resolve } from "node:path";
export function walk(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
	});
}
export function isTest(file: string): boolean {
	return /\.(test|spec)\.ts$/.test(file);
}
