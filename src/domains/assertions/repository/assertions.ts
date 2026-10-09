import {
	canonicalBytes,
	checkScope,
	sameScope,
	type ScopeRef,
} from "../../../contracts/index.ts";
import {
	expectChanges,
	requireTransaction,
	WorldIntegrityError,
	type SqlValue,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";
import type { Assertion, AssertionRef } from "../contracts/assertion.ts";
import {
	terminalLifecycles,
	type TransitionPlan,
} from "../contracts/transition.ts";

export type WriteRejectCode =
	| "INVALID_INPUT"
	| "LIMIT_EXCEEDED"
	| "SCOPE_MISMATCH"
	| "ASSERTION_NOT_FOUND"
	| "DUPLICATE_ASSERTION"
	| "DUPLICATE_EVIDENCE"
	| "CONFLICTING_INPUT_REVISIONS"
	| "REVISION_CONFLICT"
	| "NOT_CANDIDATE"
	| "INITIAL_REVISION_REQUIRED"
	| "TERMINAL_STATE"
	| "LIFECYCLE_MISMATCH"
	| "REPLACEMENT_REQUIRED"
	| "REPLACEMENT_MISMATCH"
	| "REPLACEMENT_NOT_ALLOWED"
	| "STOP_TARGET_MISMATCH";
export interface WriteRejected {
	readonly status: "rejected";
	readonly reasonCode: WriteRejectCode;
}
export type AssertionWriteResult =
	| {
			readonly status: "applied";
			readonly id: string;
			readonly revision: number;
	  }
	| WriteRejected;

export const rejected = (reasonCode: WriteRejectCode): WriteRejected => ({
	status: "rejected",
	reasonCode,
});
const decoder = new TextDecoder();
/** Canonical JSON text, or a rejection code (never throws on bad payload). */
export function canonicalText(
	value: unknown,
): { ok: true; text: string } | { ok: false; reasonCode: WriteRejectCode } {
	const bytes = canonicalBytes(value);
	if (bytes.ok) return { ok: true, text: decoder.decode(bytes.value) };
	return {
		ok: false,
		reasonCode:
			bytes.code === "LIMIT_EXCEEDED" ? "LIMIT_EXCEEDED" : "INVALID_INPUT",
	};
}
export function scopeOf(value: unknown): ScopeRef | undefined {
	const scope = checkScope(value);
	return scope.ok ? scope.value : undefined;
}
/** `?, ?, ?` for a bound IN list. Only the count shapes the SQL text. */
export const placeholders = (count: number) =>
	Array.from({ length: count }, () => "?").join(", ");
export const maxBatch = 500;

interface AssertionRow {
	lifecycle: Assertion["lifecycle"];
	payload_json: string;
}
const fromRow = (row: AssertionRow): Assertion => ({
	...(JSON.parse(row.payload_json) as Assertion),
	lifecycle: row.lifecycle,
});

export function getHead(
	db: WorldDb,
	scope: ScopeRef,
	id: string,
): { readonly id: string; readonly currentRevision: number } | undefined {
	const row = db
		.query(
			"SELECT current_revision FROM world_assertion_head WHERE principal = ? AND scope_key = ? AND id = ?",
		)
		.get(scope.principal, scope.scopeKey, id) as
		| { current_revision: number }
		| null
		| undefined;
	return row ? { id, currentRevision: row.current_revision } : undefined;
}

/** `revision` omitted reads the head revision. */
export function getAssertion(
	db: WorldDb,
	scope: ScopeRef,
	id: string,
	revision?: number,
): Assertion | undefined {
	const target = revision ?? getHead(db, scope, id)?.currentRevision;
	if (target === undefined) return undefined;
	const row = db
		.query(
			"SELECT lifecycle, payload_json FROM world_assertion WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ?",
		)
		.get(scope.principal, scope.scopeKey, id, target) as
		| AssertionRow
		| null
		| undefined;
	return row ? fromRow(row) : undefined;
}

export interface ListOptions {
	readonly predicate?: string;
	readonly lifecycles?: readonly Assertion["lifecycle"][];
	readonly limit: number;
}
/** Head revisions of a subject. Reads limit+1 rows to detect truncation. */
export function listBySubject(
	db: WorldDb,
	scope: ScopeRef,
	subjectId: string,
	options: ListOptions,
): { readonly items: readonly Assertion[]; readonly truncated: boolean } {
	const limit = Math.min(Math.max(1, Math.trunc(options.limit)), maxBatch);
	const params: SqlValue[] = [scope.principal, scope.scopeKey, subjectId];
	let where = "";
	if (options.predicate !== undefined) {
		where += " AND a.predicate = ?";
		params.push(options.predicate);
	}
	if (options.lifecycles && options.lifecycles.length > 0) {
		where += ` AND a.lifecycle IN (${placeholders(options.lifecycles.length)})`;
		params.push(...options.lifecycles);
	}
	params.push(limit + 1);
	const rows = db
		.query(
			`SELECT a.lifecycle, a.payload_json FROM world_assertion a INDEXED BY world_assertion_subject
			 JOIN world_assertion_head h ON h.principal = a.principal AND h.scope_key = a.scope_key AND h.id = a.id AND h.current_revision = a.revision
			 WHERE a.principal = ? AND a.scope_key = ? AND a.subject_id = ?${where}
			 ORDER BY a.id LIMIT ?`,
		)
		.all(...params) as AssertionRow[];
	return {
		items: rows.slice(0, limit).map(fromRow),
		truncated: rows.length > limit,
	};
}

/**
 * Assertions (any revision) that name `entityId` as relation object or as an
 * entity-reference value, returned as head refs. payload_json is not indexed,
 * so this scans one Scope's rows; it is used only when an entity is forgotten.
 */
export function listAssertionsReferencingEntity(
	db: WorldDb,
	scope: ScopeRef,
	entityId: string,
	limit: number,
): { readonly refs: readonly AssertionRef[]; readonly truncated: boolean } {
	const checked = scopeOf(scope);
	if (!checked) throw new RangeError("invalid_scope");
	const cap = Math.min(Math.max(1, Math.trunc(limit)), maxBatch);
	const rows = db
		.query(
			`SELECT h.id AS id, h.current_revision AS revision FROM world_assertion_head h
			 WHERE h.principal = ? AND h.scope_key = ? AND h.id IN (
				SELECT a.id FROM world_assertion a
				WHERE a.principal = ? AND a.scope_key = ?
				AND (json_extract(a.payload_json, '$.payload.objectId') = ?
					OR json_extract(a.payload_json, '$.payload.value.entityId') = ?)
			 ) ORDER BY h.id LIMIT ?`,
		)
		.all(
			checked.principal,
			checked.scopeKey,
			checked.principal,
			checked.scopeKey,
			entityId,
			entityId,
			cap + 1,
		) as AssertionRef[];
	return {
		refs: rows
			.slice(0, cap)
			.map((row) => ({ id: row.id, revision: row.revision })),
		truncated: rows.length > cap,
	};
}

/**
 * Every revision of every assertion that ever had `entityId` as its subject
 * (a supersede may move the subject, so heads alone are not enough). Forget
 * discovery only. Uses the (scope, subject) index; limit+1 sentinel.
 */
export function listAssertionRevisionsBySubject(
	db: WorldDb,
	scope: ScopeRef,
	entityId: string,
	limit: number,
): { readonly refs: readonly AssertionRef[]; readonly truncated: boolean } {
	const checked = scopeOf(scope);
	if (!checked) throw new RangeError("invalid_scope");
	const cap = Math.min(Math.max(1, Math.trunc(limit)), maxBatch);
	const rows = db
		.query(
			"SELECT id, revision FROM world_assertion WHERE principal = ? AND scope_key = ? AND subject_id = ? ORDER BY id, revision LIMIT ?",
		)
		.all(
			checked.principal,
			checked.scopeKey,
			entityId,
			cap + 1,
		) as AssertionRef[];
	return {
		refs: rows
			.slice(0, cap)
			.map((row) => ({ id: row.id, revision: row.revision })),
		truncated: rows.length > cap,
	};
}

/**
 * Head revisions of the whole Scope, id ascending, keyset-paged: pass the last
 * returned id as `afterId`. Reads limit+1 rows; `truncated` means call again.
 */
export function listScopeAssertions(
	db: WorldDb,
	scope: ScopeRef,
	options: { readonly afterId?: string; readonly limit: number },
): { readonly items: readonly Assertion[]; readonly truncated: boolean } {
	if (!scopeOf(scope)) throw new RangeError("invalid_scope");
	const limit = Math.min(Math.max(1, Math.trunc(options.limit)), maxBatch);
	const params: SqlValue[] = [scope.principal, scope.scopeKey];
	let after = "";
	if (options.afterId !== undefined) {
		after = " AND a.id > ?";
		params.push(options.afterId);
	}
	params.push(limit + 1);
	const rows = db
		.query(
			`SELECT a.lifecycle, a.payload_json FROM world_assertion a
			 JOIN world_assertion_head h ON h.principal = a.principal AND h.scope_key = a.scope_key AND h.id = a.id AND h.current_revision = a.revision
			 WHERE a.principal = ? AND a.scope_key = ?${after}
			 ORDER BY a.id LIMIT ?`,
		)
		.all(...params) as AssertionRow[];
	return {
		items: rows.slice(0, limit).map((row) => {
			// `lastTransition` is repository bookkeeping (kept in world_transition
			// too); it is not part of the pure Assertion contract.
			const { lastTransition: _bookkeeping, ...assertion } = fromRow(
				row,
			) as Assertion & { lastTransition?: unknown };
			return assertion as Assertion;
		}),
		truncated: rows.length > limit,
	};
}

function insertRow(db: WorldDb, assertion: Assertion, text: string): void {
	const { scope } = assertion;
	expectChanges(
		db
			.query(
				"INSERT INTO world_assertion (principal, scope_key, id, revision, subject_id, predicate, lifecycle, origin, recorded_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.run(
				scope.principal,
				scope.scopeKey,
				assertion.id,
				assertion.revision,
				assertion.subjectId,
				assertion.predicate,
				assertion.lifecycle,
				assertion.origin,
				assertion.recordedAt,
				text,
			),
		1,
		"ASSERTION_INSERT",
	);
}

/** Registers revision 1 as a candidate together with its head row. */
export function insertAssertion(
	db: WorldDb,
	assertion: Assertion,
): AssertionWriteResult {
	requireTransaction(db);
	const scope = scopeOf(assertion.scope);
	if (!scope) return rejected("INVALID_INPUT");
	if (assertion.revision !== 1) return rejected("INITIAL_REVISION_REQUIRED");
	if (assertion.lifecycle !== "candidate") return rejected("NOT_CANDIDATE");
	const payload = canonicalText(assertion);
	if (!payload.ok) return rejected(payload.reasonCode);
	if (getHead(db, scope, assertion.id)) return rejected("DUPLICATE_ASSERTION");
	insertRow(db, assertion, payload.text);
	expectChanges(
		db
			.query(
				"INSERT INTO world_assertion_head (principal, scope_key, id, current_revision) VALUES (?, ?, ?, ?)",
			)
			.run(scope.principal, scope.scopeKey, assertion.id, 1),
		1,
		"HEAD_INSERT",
	);
	return { status: "applied", id: assertion.id, revision: 1 };
}

const sameRef = (a: AssertionRef, b: AssertionRef) =>
	a.id === b.id && a.revision === b.revision;

/**
 * Applies a pure TransitionPlan: new revision row, stopped old revision,
 * world_transition row and the head UPDATE guarded by expectedRevision.
 * `replacement` is required for (and only for) supersede; evidence and input
 * rows of a replacement are inserted by the caller. For other actions the
 * evidence and input rows are copied to the new revision.
 */
export function applyTransition(
	db: WorldDb,
	plan: TransitionPlan,
	replacement?: Assertion,
): AssertionWriteResult {
	requireTransaction(db);
	const scope = scopeOf(plan.scope);
	if (!scope) return rejected("INVALID_INPUT");
	const head = getHead(db, scope, plan.id);
	if (!head) return rejected("ASSERTION_NOT_FOUND");
	if (
		head.currentRevision !== plan.expectedRevision ||
		plan.nextRevision !== plan.expectedRevision + 1
	)
		return rejected("REVISION_CONFLICT");
	const current = getAssertion(db, scope, plan.id, plan.expectedRevision);
	if (!current) throw new WorldIntegrityError("HEAD_WITHOUT_ROW");
	if (terminalLifecycles.includes(current.lifecycle))
		return rejected("TERMINAL_STATE");
	if (current.lifecycle !== plan.from) return rejected("LIFECYCLE_MISMATCH");
	const self: AssertionRef = { id: plan.id, revision: plan.expectedRevision };
	if (!plan.stopsUseOf.every((ref) => sameRef(ref, self)))
		return rejected("STOP_TARGET_MISMATCH");

	let next: Assertion;
	if (plan.action === "supersede") {
		if (!replacement) return rejected("REPLACEMENT_REQUIRED");
		if (
			replacement.id !== plan.id ||
			replacement.revision !== plan.nextRevision ||
			replacement.lifecycle !== plan.nextLifecycle ||
			!sameScope(replacement.scope, scope) ||
			!plan.supersedes.every((ref) =>
				replacement.supersedes.some((link) => sameRef(link, ref)),
			)
		)
			return rejected("REPLACEMENT_MISMATCH");
		next = replacement;
	} else {
		if (replacement) return rejected("REPLACEMENT_NOT_ALLOWED");
		const contradicts = [...current.contradicts];
		for (const ref of plan.contradicts)
			if (!contradicts.some((link) => sameRef(link, ref)))
				contradicts.push(ref);
		next = {
			...current,
			revision: plan.nextRevision,
			lifecycle: plan.nextLifecycle,
			contradicts,
			lastTransition: {
				action: plan.action,
				...(plan.adoption ? { adoption: plan.adoption } : {}),
				...(plan.resolution ? { resolution: plan.resolution } : {}),
				...(plan.reasonSource ? { reasonSource: plan.reasonSource } : {}),
				...(plan.reasonCode ? { reasonCode: plan.reasonCode } : {}),
			},
		} as Assertion;
	}
	const payload = canonicalText(next);
	if (!payload.ok) return rejected(payload.reasonCode);

	insertRow(db, next, payload.text);
	for (const ref of plan.stopsUseOf)
		expectChanges(
			db
				.query(
					"UPDATE world_assertion SET lifecycle = ? WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ? AND lifecycle = ?",
				)
				.run(
					plan.to,
					scope.principal,
					scope.scopeKey,
					ref.id,
					ref.revision,
					plan.from,
				),
			1,
			"STOP_OLD_REVISION",
		);
	expectChanges(
		db
			.query(
				"INSERT INTO world_transition (principal, scope_key, assertion_id, to_revision, from_revision, action, reason_code) VALUES (?, ?, ?, ?, ?, ?, ?)",
			)
			.run(
				scope.principal,
				scope.scopeKey,
				plan.id,
				plan.nextRevision,
				plan.expectedRevision,
				plan.action,
				plan.reasonCode ?? null,
			),
		1,
		"TRANSITION_INSERT",
	);
	expectChanges(
		db
			.query(
				"UPDATE world_assertion_head SET current_revision = ? WHERE principal = ? AND scope_key = ? AND id = ? AND current_revision = ?",
			)
			.run(
				plan.nextRevision,
				scope.principal,
				scope.scopeKey,
				plan.id,
				plan.expectedRevision,
			),
		1,
		"HEAD_UPDATE",
	);
	if (plan.action !== "supersede") {
		const params = [
			plan.nextRevision,
			scope.principal,
			scope.scopeKey,
			plan.id,
			plan.expectedRevision,
		];
		db.query(
			"INSERT INTO world_evidence (principal, scope_key, assertion_id, assertion_revision, evidence_id, root_evidence_id, stance, source_key, source_revision, payload_json) SELECT principal, scope_key, assertion_id, ?, evidence_id, root_evidence_id, stance, source_key, source_revision, payload_json FROM world_evidence WHERE principal = ? AND scope_key = ? AND assertion_id = ? AND assertion_revision = ?",
		).run(...params);
		db.query(
			"INSERT INTO world_assertion_input (principal, scope_key, assertion_id, assertion_revision, source_key, source_revision) SELECT principal, scope_key, assertion_id, ?, source_key, source_revision FROM world_assertion_input WHERE principal = ? AND scope_key = ? AND assertion_id = ? AND assertion_revision = ?",
		).run(...params);
	}
	return { status: "applied", id: plan.id, revision: plan.nextRevision };
}

/**
 * Forget/invalidate support: removes EVERY revision of each listed assertion
 * id (evidence, inputs, transitions, head, rows) so no payload remains.
 * Idempotent: ids that are already gone delete nothing.
 */
export function deleteAssertions(
	db: WorldDb,
	scope: ScopeRef,
	refs: readonly AssertionRef[],
): { readonly status: "applied"; readonly deleted: number } | WriteRejected {
	requireTransaction(db);
	const checked = scopeOf(scope);
	if (!checked) return rejected("INVALID_INPUT");
	const ids = [...new Set(refs.map((ref) => ref.id))].sort();
	if (ids.length > maxBatch) return rejected("LIMIT_EXCEEDED");
	let deleted = 0;
	for (const id of ids) {
		const key: SqlValue[] = [checked.principal, checked.scopeKey, id];
		for (const table of [
			"world_transition WHERE principal = ? AND scope_key = ? AND assertion_id = ?",
			"world_evidence WHERE principal = ? AND scope_key = ? AND assertion_id = ?",
			"world_assertion_input WHERE principal = ? AND scope_key = ? AND assertion_id = ?",
			"world_assertion_head WHERE principal = ? AND scope_key = ? AND id = ?",
		])
			db.query(`DELETE FROM ${table}`).run(...key);
		const result = db
			.query(
				"DELETE FROM world_assertion WHERE principal = ? AND scope_key = ? AND id = ?",
			)
			.run(...key) as { changes: number };
		deleted += result.changes;
	}
	return { status: "applied", deleted };
}
