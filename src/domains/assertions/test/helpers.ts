import { createHash } from "node:crypto";
import type { CanonicalHasher } from "../../../contracts/index.ts";

export const sha256: CanonicalHasher = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
export const hex = (text: string) => sha256(new TextEncoder().encode(text));

export const A = { principal: "p-a", scopeKey: "scope-a" };
export const B = { principal: "p-a", scopeKey: "scope-b" };

export function freeze<T>(value: T): T {
	if (typeof value === "object" && value !== null) {
		for (const v of Object.values(value)) freeze(v);
		Object.freeze(value);
	}
	return value;
}

export const content = "音声サービスは9月から利用できる。";
export const state = (extra: Record<string, unknown> = {}) => ({
	namespace: "conversation",
	kind: "message",
	id: "src-1",
	revision: "rev-1",
	digest: hex(content),
	principal: A.principal,
	scopeKey: A.scopeKey,
	status: "available",
	content,
	...extra,
});
export const ref = (extra: Record<string, unknown> = {}) => ({
	namespace: "conversation",
	kind: "message",
	id: "src-1",
	revision: "rev-1",
	digest: hex(content),
	...extra,
});
export const entities = [
	{
		id: "svc-1",
		scope: A,
		revision: 1,
		displayName: "音声サービス",
		aliases: [],
		externalRefs: [],
	},
	{
		id: "svc-2",
		scope: A,
		revision: 1,
		displayName: "別サービス",
		aliases: [],
		externalRefs: [],
	},
];
export const evidence = (extra: Record<string, unknown> = {}) => ({
	evidenceId: "ev-1",
	kind: "user_statement",
	stance: "supports",
	source: ref(),
	rootEvidenceId: "root-1",
	...extra,
});
export const draft = (extra: Record<string, unknown> = {}) => ({
	id: "claim-1",
	revision: 1,
	scope: A,
	subjectId: "svc-1",
	predicate: "available",
	payload: { kind: "value", value: { kind: "boolean", value: true } },
	evidence: [evidence()],
	inputManifest: [],
	origin: "user_report",
	recordedAt: 1791500000000,
	freshnessPolicy: { maxAgeMs: 86_400_000 },
	condition: { kind: "unspecified" },
	supersedes: [],
	contradicts: [],
	interpretationVersion: "interp-1",
	...extra,
});
export const input = (
	d: Record<string, unknown> = draft(),
	extra: Record<string, unknown> = {},
) => ({
	contractVersion: 1,
	scope: A,
	draft: d,
	sources: { states: [state()] },
	entities,
	...extra,
});
