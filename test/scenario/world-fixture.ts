import { createHash } from "node:crypto";
import {
	planAssertionTransition,
	type Assertion,
	type TransitionPlan,
} from "../../src/domains/assertions/index.ts";
import {
	applyWorldOperation,
	type WorldOperationResult,
} from "../../src/sqlite.ts";
import type { WorldDb } from "../../src/sqlite.ts";
import type { CanonicalHasher } from "../../src/contracts/index.ts";
import { openTestStore, type TestStore } from "../support/sqlite-store.ts";

export const hasher: CanonicalHasher = (bytes) =>
	createHash("sha256").update(bytes).digest("hex");
const hex = (text: string) => hasher(new TextEncoder().encode(text));

export const A = { principal: "p-a", scopeKey: "scope-a" };
export const B = { principal: "p-a", scopeKey: "scope-b" };
export const NOW = 1791500000000;
const content = "音声サービスは9月から利用できる。";

export const ref = (extra: Record<string, unknown> = {}) => ({
	namespace: "conversation",
	kind: "message",
	id: "src-1",
	revision: "rev-1",
	digest: hex(content),
	...extra,
});
export const state = (extra: Record<string, unknown> = {}) => ({
	...ref(),
	principal: A.principal,
	scopeKey: A.scopeKey,
	status: "available",
	...extra,
});
export const access = (scopeKeys = [A.scopeKey]) => ({
	principal: A.principal,
	scopeKeys,
	purpose: "world",
	policyRevision: "pol-1",
});
export const hostChecks = (states: unknown[] = [state()]) => ({
	sourceSnapshot: { states },
	forgetEpoch: "f1",
	restoreEpoch: "r1",
	policyRevision: "pol-1",
});

export const claim = (extra: Record<string, unknown> = {}): Assertion =>
	({
		id: "claim-1",
		revision: 1,
		scope: A,
		subjectId: "svc-1",
		predicate: "available",
		payload: { kind: "value", value: { kind: "boolean", value: true } },
		evidence: [
			{
				evidenceId: "ev-1",
				kind: "user_statement",
				stance: "supports",
				source: ref(),
				rootEvidenceId: "root-1",
			},
		],
		inputManifest: [ref()],
		origin: "user_report",
		recordedAt: NOW,
		freshnessPolicy: { maxAgeMs: 86_400_000 },
		condition: { kind: "unspecified" },
		supersedes: [],
		contradicts: [],
		interpretationVersion: "interp-1",
		lifecycle: "candidate",
		rootEvidenceIds: ["root-1"],
		...extra,
	}) as unknown as Assertion;

export function adoptPlan(
	id = "claim-1",
	revision = 1,
	lifecycle = "candidate",
): TransitionPlan {
	const result = planAssertionTransition({
		contractVersion: 1,
		scope: A,
		current: { id, revision, scope: A, lifecycle, origin: "user_report" },
		expectedRevision: revision,
		request: {
			action: "adopt",
			adoption: { kind: "explicit", operationId: "op-adopt" },
			subjectConfirmedByHost: true,
		},
		registeredAdoptionRules: [],
	});
	if (!result.ok || result.value.status !== "planned")
		throw new Error(`plan failed: ${JSON.stringify(result)}`);
	return result.value.plan;
}

export const envelope = (
	operationKey: string,
	operation: unknown,
	over: Record<string, unknown> = {},
) => ({
	contractVersion: 1,
	access: access(),
	scope: A,
	operationKey,
	clock: NOW,
	hostChecks: hostChecks(),
	operation,
	...over,
});
export const registerClaim = (key = "op-1", extra = {}) =>
	envelope(key, { kind: "assertion.register", assertion: claim(extra) });
export const adopt = (key = "op-2", id = "claim-1", revision = 1) =>
	envelope(key, {
		kind: "assertion.transition",
		plan: adoptPlan(id, revision),
	});

export const apply = (db: WorldDb, input: unknown): WorldOperationResult =>
	applyWorldOperation(db, input, { hasher });

export const TABLES = [
	"world_entity",
	"world_alias",
	"world_identity_event",
	"world_assertion",
	"world_assertion_head",
	"world_transition",
	"world_evidence",
	"world_assertion_input",
	"world_current",
	"world_edge",
	"world_scope_epoch",
	"world_prediction",
	"world_outcome",
	"world_tombstone",
	"world_scope_gate",
	"world_forget_operation",
	"world_forget_target",
	"world_operation",
	"world_inbox",
	"world_input_manifest",
	"world_manifest_dependency",
	"world_checkpoint",
	"world_schema_info",
	"host_probe",
	"host_queue",
] as const;

/** Whole-database content, for before/after equality across a rollback. */
export function dump(store: TestStore): Record<string, unknown[]> {
	return store.read((db) =>
		Object.fromEntries(
			TABLES.map((table) => [
				table,
				db.query(`SELECT * FROM ${table} ORDER BY rowid`).all(),
			]),
		),
	);
}

export function openWorld(mode: "file" | "memory" = "file"): TestStore {
	const store = openTestStore({ mode });
	store.write((db) => {
		db.exec(
			"CREATE TABLE host_probe (n INTEGER NOT NULL); CREATE TABLE host_queue (cursor TEXT NOT NULL);",
		);
	});
	return store;
}
export const probe = (db: WorldDb) => {
	db.query("INSERT INTO host_probe (n) VALUES (1)").run();
	db.query("INSERT INTO host_queue (cursor) VALUES ('advanced')").run();
};
