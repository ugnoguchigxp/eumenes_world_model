import { fail, type Checked } from "./result.ts";

/** Decode persisted or external JSON through its existing contract parser. */
export function decodeJson<T>(
	text: string,
	check: (value: unknown, path: string) => Checked<T>,
	path: string,
): Checked<T> {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return fail("INVALID_INPUT", path);
	}
	return check(value, path);
}
