import {
	limits,
	type ScopeRef,
	type SourceRef,
} from "../../../contracts/index.ts";
import {
	expectChanges,
	requireTransaction,
	type SqlValue,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";
import type { AssertionRef } from "../contracts/assertion.ts";
import { sourceIdentityKey, sourceInputKey } from "../contracts/evidence.ts";
import {
	maxBatch,
	placeholders,
	rejected,
	scopeOf,
	type WriteRejected,
} from "./assertions.ts";

/**
 * ALL input source/state dependencies of one assertion revision, cited or not.
 * Duplicates by full input key collapse; the same source at two revisions in
 * one assertion is rejected (the key is the Scope-first source identity).
 */
export function insertInputs(
	db: WorldDb,
	scope: ScopeRef,
	assertion: AssertionRef,
	inputs: readonly SourceRef[],
): { readonly status: "applied"; readonly inserted: number } | WriteRejected {
	requireTransaction(db);
	const checked = scopeOf(scope);
	if (!checked) return rejected("INVALID_INPUT");
	const byIdentity = new Map<string, SourceRef>();
	const seenInput = new Set<string>();
	for (const ref of inputs) {
		const input = sourceInputKey(ref);
		if (seenInput.has(input)) continue;
		seenInput.add(input);
		const identity = sourceIdentityKey(ref);
		if (byIdentity.has(identity))
			return rejected("CONFLICTING_INPUT_REVISIONS");
		byIdentity.set(identity, ref);
	}
	if (byIdentity.size > limits.manifestDependencies)
		return rejected("LIMIT_EXCEEDED");
	const exists = db
		.query(
			"SELECT 1 AS present FROM world_assertion WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ?",
		)
		.get(checked.principal, checked.scopeKey, assertion.id, assertion.revision);
	if (!exists) return rejected("ASSERTION_NOT_FOUND");
	for (const [key, ref] of [...byIdentity.entries()].sort(([a], [b]) =>
		a < b ? -1 : 1,
	))
		expectChanges(
			db
				.query(
					"INSERT INTO world_assertion_input (principal, scope_key, assertion_id, assertion_revision, source_key, source_revision) VALUES (?, ?, ?, ?, ?, ?)",
				)
				.run(
					checked.principal,
					checked.scopeKey,
					assertion.id,
					assertion.revision,
					key,
					ref.revision,
				),
			1,
			"INPUT_INSERT",
		);
	return { status: "applied", inserted: byIdentity.size };
}

/**
 * Reverse dependency lookup: every assertion revision that cites OR merely
 * received any of `sourceKeys` (sourceIdentityKey values) as input. Reads
 * limit+1 rows; `truncated` means the closure must continue in a later chunk.
 */
export function listAssertionsBySourceKeys(
	db: WorldDb,
	scope: ScopeRef,
	sourceKeys: readonly string[],
	limit: number,
): { readonly refs: readonly AssertionRef[]; readonly truncated: boolean } {
	const keys = [...new Set(sourceKeys)].sort().slice(0, maxBatch);
	if (keys.length === 0) return { refs: [], truncated: false };
	const cap = Math.min(Math.max(1, Math.trunc(limit)), maxBatch);
	const list = placeholders(keys.length);
	const params: SqlValue[] = [];
	for (let i = 0; i < 2; i++)
		params.push(scope.principal, scope.scopeKey, ...keys);
	params.push(cap + 1);
	const rows = db
		.query(
			`SELECT assertion_id AS id, assertion_revision AS revision FROM world_assertion_input INDEXED BY world_assertion_input_source WHERE principal = ? AND scope_key = ? AND source_key IN (${list})
			 UNION
			 SELECT assertion_id AS id, assertion_revision AS revision FROM world_evidence WHERE principal = ? AND scope_key = ? AND source_key IN (${list})
			 ORDER BY id, revision LIMIT ?`,
		)
		.all(...params) as AssertionRef[];
	return {
		refs: rows
			.slice(0, cap)
			.map((row) => ({ id: row.id, revision: row.revision })),
		truncated: rows.length > cap,
	};
}

/**
 * Distinct input/evidence source keys of the Scope in key order after
 * `afterKey` (restore enumeration of EVERY recorded dependency, not only the
 * ones some edge table still remembers).
 */
export function listInputSourceKeys(
	db: WorldDb,
	scope: ScopeRef,
	page: { readonly afterKey?: string; readonly limit: number },
): readonly string[] {
	const checked = scopeOf(scope);
	if (!checked) throw new RangeError("invalid_scope");
	const cap = Math.min(Math.max(1, Math.trunc(page.limit)), maxBatch);
	const after = page.afterKey ?? "";
	const rows = db
		.query(
			`SELECT source_key FROM world_assertion_input WHERE principal = ? AND scope_key = ? AND source_key > ?
			 UNION
			 SELECT source_key FROM world_evidence WHERE principal = ? AND scope_key = ? AND source_key > ?
			 ORDER BY source_key LIMIT ?`,
		)
		.all(
			checked.principal,
			checked.scopeKey,
			after,
			checked.principal,
			checked.scopeKey,
			after,
			cap,
		) as { source_key: string }[];
	return rows.map((row) => row.source_key);
}

/** Source revision already recorded as an input of one assertion revision. */
export function getInputRevision(
	db: WorldDb,
	scope: ScopeRef,
	assertion: AssertionRef,
	source: SourceRef,
): string | undefined {
	const checked = scopeOf(scope);
	if (!checked) throw new RangeError("invalid_scope");
	const row = db
		.query(
			"SELECT source_revision FROM world_assertion_input WHERE principal = ? AND scope_key = ? AND assertion_id = ? AND assertion_revision = ? AND source_key = ?",
		)
		.get(
			checked.principal,
			checked.scopeKey,
			assertion.id,
			assertion.revision,
			sourceIdentityKey(source),
		) as { source_revision: string } | null;
	return row?.source_revision;
}

/**
 * Records one more input (e.g. the reason source of a retraction) of an
 * existing assertion revision. Idempotent for the same source revision; a
 * different revision of an already recorded source is rejected before DML.
 */
export function addInput(
	db: WorldDb,
	scope: ScopeRef,
	assertion: AssertionRef,
	source: SourceRef,
): { readonly status: "applied" | "unchanged" } | WriteRejected {
	requireTransaction(db);
	const checked = scopeOf(scope);
	if (!checked) return rejected("INVALID_INPUT");
	const exists = db
		.query(
			"SELECT 1 AS present FROM world_assertion WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ?",
		)
		.get(checked.principal, checked.scopeKey, assertion.id, assertion.revision);
	if (!exists) return rejected("ASSERTION_NOT_FOUND");
	const recorded = getInputRevision(db, scope, assertion, source);
	if (recorded !== undefined)
		return recorded === source.revision
			? { status: "unchanged" }
			: rejected("CONFLICTING_INPUT_REVISIONS");
	expectChanges(
		db
			.query(
				"INSERT INTO world_assertion_input (principal, scope_key, assertion_id, assertion_revision, source_key, source_revision) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run(
				checked.principal,
				checked.scopeKey,
				assertion.id,
				assertion.revision,
				sourceIdentityKey(source),
				source.revision,
			),
		1,
		"INPUT_INSERT",
	);
	return { status: "applied" };
}
