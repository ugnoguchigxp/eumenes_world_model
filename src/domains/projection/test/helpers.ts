import { createHash } from "node:crypto";
import type { CanonicalHasher } from "../../../contracts/index.ts";

export const sha256: CanonicalHasher = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
export const A = { principal: "p-a", scopeKey: "scope-a" };
export const B = { principal: "p-a", scopeKey: "scope-b" };
export const NOW = 1791500000000;
const digest = `sha256:${sha256(new TextEncoder().encode("src-1/rev-1"))}`;

export function freeze<T>(value: T): T {
	if (typeof value === "object" && value !== null) {
		for (const v of Object.values(value)) freeze(v);
		Object.freeze(value);
	}
	return value;
}
export const ref = (extra: Record<string, unknown> = {}) => ({
	namespace: "conversation",
	kind: "message",
	id: "src-1",
	revision: "rev-1",
	digest,
	...extra,
});
export const state = (extra: Record<string, unknown> = {}) => ({
	...ref(),
	principal: A.principal,
	scopeKey: A.scopeKey,
	status: "available",
	...extra,
});
/** A ledger record: draft + lifecycle + root IDs. */
export const rec = (
	id: string,
	extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
	id,
	revision: 1,
	scope: A,
	subjectId: `svc-${id}`,
	predicate: "available",
	payload: { kind: "value", value: { kind: "boolean", value: true } },
	evidence: [
		{
			evidenceId: `ev-${id}`,
			kind: "user_statement",
			stance: "supports",
			source: ref(),
			rootEvidenceId: "root-1",
		},
	],
	inputManifest: [],
	origin: "user_report",
	observedAt: NOW - 1000,
	recordedAt: NOW - 1000,
	freshnessPolicy: { maxAgeMs: 86_400_000 },
	condition: { kind: "unspecified" },
	supersedes: [],
	contradicts: [],
	interpretationVersion: "interp-1",
	lifecycle: "active",
	rootEvidenceIds: ["root-1"],
	...extra,
});
export const snapshot = (
	assertions: Record<string, unknown>[],
	extra: Record<string, unknown> = {},
) => ({
	scope: A,
	asOf: NOW,
	worldEnabled: true,
	complete: true,
	checks: {
		authorized: true,
		correctionsResolved: true,
		restoreVerified: true,
	},
	scopeEpoch: 7,
	policyRevision: "policy-1",
	forgetEpoch: "forget-1",
	restoreEpoch: "restore-1",
	interpretationVersion: "interp-1",
	assertions,
	sources: [state()],
	...extra,
});
export const sliceInput = (
	assertions: Record<string, unknown>[],
	request: Record<string, unknown> = {},
	extra: Record<string, unknown> = {},
) => ({
	contractVersion: 1,
	snapshot: snapshot(assertions, extra),
	request,
});
