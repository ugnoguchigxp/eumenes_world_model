import {
	canonicalBytes,
	checkId,
	checkScope,
	limits,
	type ScopeRef,
	type SourceRef,
} from "../../../contracts/index.ts";
import { sourceIdentityKey, sourceInputKey } from "../../assertions/index.ts";
import {
	expectChanges,
	requireTransaction,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";

export const manifestStatuses = [
	"prepared",
	"applied",
	"held",
	"rejected",
] as const;
export type ManifestStatus = (typeof manifestStatuses)[number];
export const maxManifestLookup = 500;
export const maxManifestDelete = 500;

export interface Manifest {
	readonly manifestId: string;
	readonly status: ManifestStatus;
	/** ALL input source/state dependencies, cited or not; sorted by input key. */
	readonly dependencies: readonly SourceRef[];
	/** Inbox event this manifest was prepared for; lets forget reach the event. */
	readonly eventId?: string;
}
export type ManifestRejectCode =
	| "INVALID_INPUT"
	| "LIMIT_EXCEEDED"
	| "CONFLICTING_INPUT_REVISIONS"
	| "MANIFEST_CONFLICT"
	| "MANIFEST_NOT_FOUND"
	| "INVALID_TRANSITION";
export type ManifestResult =
	| { readonly status: "inserted" | "unchanged" | "updated" }
	| { readonly status: "rejected"; readonly reasonCode: ManifestRejectCode };

const decoder = new TextDecoder();
const wholeSource = (ref: SourceRef): SourceRef => {
	const { range: _range, ...whole } = ref;
	return whole;
};

/** Unique (by revision-aware key), range-free, deterministic order. */
function normalize(
	dependencies: readonly SourceRef[],
): SourceRef[] | ManifestRejectCode {
	const unique = new Map<string, SourceRef>();
	for (const ref of dependencies) {
		if (
			typeof ref !== "object" ||
			ref === null ||
			typeof ref.namespace !== "string" ||
			typeof ref.kind !== "string" ||
			typeof ref.id !== "string" ||
			typeof ref.revision !== "string" ||
			typeof ref.digest !== "string"
		)
			return "INVALID_INPUT";
		const whole = wholeSource(ref);
		unique.set(sourceInputKey(whole), whole);
	}
	if (unique.size > limits.manifestDependencies) return "LIMIT_EXCEEDED";
	const sorted = [...unique.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
	const identities = new Set(sorted.map(([, ref]) => sourceIdentityKey(ref)));
	if (identities.size !== sorted.length) return "CONFLICTING_INPUT_REVISIONS";
	return sorted.map(([, ref]) => ref);
}

type Row = {
	manifest_id: string;
	status: ManifestStatus;
	payload_json: string;
};

export function getManifest(
	db: WorldDb,
	scope: ScopeRef,
	manifestId: string,
): Manifest | undefined {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	const row = db
		.query(
			"SELECT manifest_id, status, payload_json FROM world_input_manifest WHERE principal = ? AND scope_key = ? AND manifest_id = ?",
		)
		.get(scope.principal, scope.scopeKey, manifestId) as Row | null | undefined;
	if (!row) return undefined;
	const payload = JSON.parse(row.payload_json) as {
		dependencies: SourceRef[];
		eventId?: string;
	};
	return {
		manifestId: row.manifest_id,
		status: row.status,
		dependencies: payload.dependencies,
		...(payload.eventId === undefined ? {} : { eventId: payload.eventId }),
	};
}

/** Manifests that read any of the given source keys (limit + 1 sentinel). */
export function listManifestsBySourceKeys(
	db: WorldDb,
	scope: ScopeRef,
	sourceKeys: readonly string[],
	limit: number,
): { readonly manifestIds: readonly string[]; readonly truncated: boolean } {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	if (
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > maxManifestLookup ||
		sourceKeys.length === 0 ||
		sourceKeys.length > maxManifestLookup
	)
		throw new RangeError("limit");
	const marks = sourceKeys.map(() => "?").join(", ");
	const rows = db
		.query(
			`SELECT DISTINCT manifest_id FROM world_manifest_dependency INDEXED BY world_manifest_dependency_source WHERE principal = ? AND scope_key = ? AND source_key IN (${marks}) ORDER BY manifest_id LIMIT ?`,
		)
		.all(scope.principal, scope.scopeKey, ...sourceKeys, limit + 1) as {
		manifest_id: string;
	}[];
	return {
		manifestIds: rows.slice(0, limit).map((row) => row.manifest_id),
		truncated: rows.length > limit,
	};
}

/**
 * Immutable manifest: id + dependency set never change. The same id with the
 * same set is "unchanged"; a different set under that id is a conflict.
 */
export function saveManifest(
	db: WorldDb,
	scope: ScopeRef,
	input: {
		manifestId: string;
		dependencies: readonly SourceRef[];
		eventId?: string;
	},
): ManifestResult {
	requireTransaction(db);
	if (!checkScope(scope).ok || !checkId(input.manifestId).ok)
		return { status: "rejected", reasonCode: "INVALID_INPUT" };
	const normalized = normalize(input.dependencies);
	if (typeof normalized === "string")
		return { status: "rejected", reasonCode: normalized };
	if (input.eventId !== undefined && !checkId(input.eventId).ok)
		return { status: "rejected", reasonCode: "INVALID_INPUT" };
	const body = {
		dependencies: normalized,
		...(input.eventId === undefined ? {} : { eventId: input.eventId }),
	};
	const bytes = canonicalBytes(body);
	if (!bytes.ok) return { status: "rejected", reasonCode: "INVALID_INPUT" };
	const payloadJson = decoder.decode(bytes.value);
	const existing = getManifest(db, scope, input.manifestId);
	if (existing) {
		const same = canonicalBytes({
			dependencies: existing.dependencies,
			...(existing.eventId === undefined ? {} : { eventId: existing.eventId }),
		});
		return same.ok && decoder.decode(same.value) === payloadJson
			? { status: "unchanged" }
			: { status: "rejected", reasonCode: "MANIFEST_CONFLICT" };
	}
	expectChanges(
		db
			.query(
				"INSERT INTO world_input_manifest (principal, scope_key, manifest_id, status, payload_json) VALUES (?, ?, ?, 'prepared', ?)",
			)
			.run(scope.principal, scope.scopeKey, input.manifestId, payloadJson),
		1,
		"MANIFEST_INSERT",
	);
	for (const ref of normalized)
		expectChanges(
			db
				.query(
					"INSERT INTO world_manifest_dependency (principal, scope_key, manifest_id, source_key, source_revision) VALUES (?, ?, ?, ?, ?)",
				)
				.run(
					scope.principal,
					scope.scopeKey,
					input.manifestId,
					sourceIdentityKey(ref),
					ref.revision,
				),
			1,
			"MANIFEST_DEPENDENCY_INSERT",
		);
	return { status: "inserted" };
}

const allowedNext: Readonly<Record<ManifestStatus, readonly ManifestStatus[]>> =
	{
		prepared: ["applied", "held", "rejected"],
		held: ["applied", "rejected"],
		applied: [],
		rejected: [],
	};
export function markManifest(
	db: WorldDb,
	scope: ScopeRef,
	manifestId: string,
	next: ManifestStatus,
): ManifestResult {
	requireTransaction(db);
	if (!checkScope(scope).ok || !checkId(manifestId).ok || next === "prepared")
		return { status: "rejected", reasonCode: "INVALID_INPUT" };
	const existing = getManifest(db, scope, manifestId);
	if (!existing)
		return { status: "rejected", reasonCode: "MANIFEST_NOT_FOUND" };
	if (existing.status === next) return { status: "unchanged" };
	if (!allowedNext[existing.status].includes(next))
		return { status: "rejected", reasonCode: "INVALID_TRANSITION" };
	expectChanges(
		db
			.query(
				"UPDATE world_input_manifest SET status = ? WHERE principal = ? AND scope_key = ? AND manifest_id = ? AND status = ?",
			)
			.run(next, scope.principal, scope.scopeKey, manifestId, existing.status),
		1,
		"MANIFEST_UPDATE",
	);
	return { status: "updated" };
}

/** Forget: dependencies first (FK), then the manifest body. Idempotent. */
export function deleteManifests(
	db: WorldDb,
	scope: ScopeRef,
	manifestIds: readonly string[],
): { readonly deleted: number } {
	requireTransaction(db);
	if (!checkScope(scope).ok || manifestIds.length > maxManifestDelete)
		throw new RangeError("invalid_delete");
	let deleted = 0;
	for (const manifestId of manifestIds) {
		db.query(
			"DELETE FROM world_manifest_dependency WHERE principal = ? AND scope_key = ? AND manifest_id = ?",
		).run(scope.principal, scope.scopeKey, manifestId);
		const result = db
			.query(
				"DELETE FROM world_input_manifest WHERE principal = ? AND scope_key = ? AND manifest_id = ?",
			)
			.run(scope.principal, scope.scopeKey, manifestId) as { changes: number };
		deleted += result.changes;
	}
	return { deleted };
}

/** Distinct manifest dependency source keys in key order after `afterKey` (restore enumeration). */
export function listManifestSourceKeys(
	db: WorldDb,
	scope: ScopeRef,
	page: { readonly afterKey?: string; readonly limit: number },
): readonly string[] {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	if (
		!Number.isSafeInteger(page.limit) ||
		page.limit < 1 ||
		page.limit > maxManifestLookup
	)
		throw new RangeError("limit");
	const rows = db
		.query(
			"SELECT DISTINCT source_key FROM world_manifest_dependency WHERE principal = ? AND scope_key = ? AND source_key > ? ORDER BY source_key LIMIT ?",
		)
		.all(scope.principal, scope.scopeKey, page.afterKey ?? "", page.limit) as {
		source_key: string;
	}[];
	return rows.map((row) => row.source_key);
}
