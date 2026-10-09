export const failureCodes = [
	"INVALID_INPUT",
	"UNSUPPORTED_CONTRACT_VERSION",
	"LIMIT_EXCEEDED",
	"SCOPE_NOT_PERMITTED",
] as const;
export type FailureCode = (typeof failureCodes)[number];

/** Content-free failure: a code and the input path, never the rejected value. */
export interface Failure {
	readonly ok: false;
	readonly code: FailureCode;
	readonly path: string;
}
export interface Success<T> {
	readonly ok: true;
	readonly value: T;
}
export type Checked<T> = Success<T> | Failure;

export function ok<T>(value: T): Success<T> {
	return { ok: true, value };
}
export function fail(code: FailureCode, path: string): Failure {
	return { ok: false, code, path };
}
