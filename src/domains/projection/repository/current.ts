import {
	expectChanges,
	requireTransaction,
	type SqlValue,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";
import {
	checkId,
	checkRevision,
	checkScope,
	limits,
	utf8Length,
	type ScopeRef,
} from "../../../contracts/index.ts";

export const maxReadRows = 500;

export interface CurrentRow {
	readonly assertionId: string;
	readonly assertionRevision: number;
	readonly subjectId: string;
	readonly predicate: string;
	readonly lifecycle: "candidate" | "active" | "disputed";
	readonly causalEligible: boolean;
	readonly payloadJson: string;
}
export interface BoundedRows<T> {
	readonly rows: readonly T[];
	/** True when more rows existed than the limit (sentinel row was fetched). */
	readonly truncated: boolean;
}
export interface AssertionRefLike {
	readonly id: string;
	readonly revision: number;
}

export function checkPayloadJson(value: unknown): boolean {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		utf8Length(value) <= limits.payloadBytes
	);
}
export function checkLimit(limit: unknown): number {
	if (
		typeof limit !== "number" ||
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > maxReadRows
	)
		throw new RangeError("invalid_limit");
	return limit;
}
export function assertScope(scope: ScopeRef): void {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
}

const lifecycles = ["candidate", "active", "disputed"];
/** Pre-check shared by replace: a rejection code or undefined. */
export function currentRowError(row: CurrentRow): string | undefined {
	if (
		!checkId(row.assertionId).ok ||
		!checkId(row.subjectId).ok ||
		!checkId(row.predicate).ok ||
		!checkRevision(row.assertionRevision).ok ||
		!lifecycles.includes(row.lifecycle) ||
		typeof row.causalEligible !== "boolean" ||
		!checkPayloadJson(row.payloadJson)
	)
		return "INVALID_INPUT";
	return undefined;
}

/** Writes rows with bound INSERTs. The scoped DELETE is done by the caller. */
export function insertCurrent(
	db: WorldDb,
	scope: ScopeRef,
	rows: readonly CurrentRow[],
): void {
	requireTransaction(db);
	const statement = db.query(
		"INSERT INTO world_current (principal, scope_key, assertion_id, assertion_revision, subject_id, predicate, lifecycle, causal_eligible, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
	);
	for (const row of rows)
		expectChanges(
			statement.run(
				scope.principal,
				scope.scopeKey,
				row.assertionId,
				row.assertionRevision,
				row.subjectId,
				row.predicate,
				row.lifecycle,
				row.causalEligible ? 1 : 0,
				row.payloadJson,
			),
			1,
			"CURRENT_INSERT",
		);
}

export function deleteAllCurrent(db: WorldDb, scope: ScopeRef): number {
	requireTransaction(db);
	const result = db
		.query("DELETE FROM world_current WHERE principal = ? AND scope_key = ?")
		.run(scope.principal, scope.scopeKey) as { changes: number };
	return result.changes;
}

export function deleteCurrentFor(
	db: WorldDb,
	scope: ScopeRef,
	refs: readonly AssertionRefLike[],
): number {
	requireTransaction(db);
	const statement = db.query(
		"DELETE FROM world_current WHERE principal = ? AND scope_key = ? AND assertion_id = ? AND assertion_revision = ?",
	);
	let total = 0;
	for (const ref of refs)
		total += (
			statement.run(scope.principal, scope.scopeKey, ref.id, ref.revision) as {
				changes: number;
			}
		).changes;
	return total;
}

interface RawCurrent {
	assertion_id: string;
	assertion_revision: number;
	subject_id: string;
	predicate: string;
	lifecycle: CurrentRow["lifecycle"];
	causal_eligible: number;
	payload_json: string;
}

/** Bounded read; without subjectIds it reads the Scope's rows up to `limit`. */
export function readCurrent(
	db: WorldDb,
	scope: ScopeRef,
	options: { readonly subjectIds?: readonly string[]; readonly limit: number },
): BoundedRows<CurrentRow> {
	assertScope(scope);
	const limit = checkLimit(options.limit);
	const params: SqlValue[] = [scope.principal, scope.scopeKey];
	let filter = "";
	if (options.subjectIds !== undefined) {
		if (options.subjectIds.length === 0) return { rows: [], truncated: false };
		if (options.subjectIds.length > maxReadRows)
			throw new RangeError("too_many_ids");
		filter = ` AND subject_id IN (${options.subjectIds.map(() => "?").join(", ")})`;
		params.push(...options.subjectIds);
	}
	params.push(limit + 1);
	const raw = db
		.query(
			`SELECT assertion_id, assertion_revision, subject_id, predicate, lifecycle, causal_eligible, payload_json FROM world_current WHERE principal = ? AND scope_key = ?${filter} ORDER BY subject_id, predicate, assertion_id, assertion_revision LIMIT ?`,
		)
		.all(...params) as RawCurrent[];
	return {
		rows: raw.slice(0, limit).map((r) => ({
			assertionId: r.assertion_id,
			assertionRevision: r.assertion_revision,
			subjectId: r.subject_id,
			predicate: r.predicate,
			lifecycle: r.lifecycle,
			causalEligible: r.causal_eligible === 1,
			payloadJson: r.payload_json,
		})),
		truncated: raw.length > limit,
	};
}

/** Exact read of one projected assertion version; undefined when not projected. */
export function getCurrentRow(
	db: WorldDb,
	scope: ScopeRef,
	assertionId: string,
	assertionRevision: number,
): CurrentRow | undefined {
	assertScope(scope);
	const row = db
		.query(
			"SELECT assertion_id, assertion_revision, subject_id, predicate, lifecycle, causal_eligible, payload_json FROM world_current WHERE principal = ? AND scope_key = ? AND assertion_id = ? AND assertion_revision = ?",
		)
		.get(scope.principal, scope.scopeKey, assertionId, assertionRevision) as
		| RawCurrent
		| null
		| undefined;
	return row
		? {
				assertionId: row.assertion_id,
				assertionRevision: row.assertion_revision,
				subjectId: row.subject_id,
				predicate: row.predicate,
				lifecycle: row.lifecycle,
				causalEligible: row.causal_eligible === 1,
				payloadJson: row.payload_json,
			}
		: undefined;
}

/** Replaces only the payload of one projected row; exactly one row must change. */
export function updateCurrentPayload(
	db: WorldDb,
	scope: ScopeRef,
	assertionId: string,
	assertionRevision: number,
	payloadJson: string,
): void {
	requireTransaction(db);
	assertScope(scope);
	if (!checkPayloadJson(payloadJson)) throw new RangeError("invalid_payload");
	expectChanges(
		db
			.query(
				"UPDATE world_current SET payload_json = ? WHERE principal = ? AND scope_key = ? AND assertion_id = ? AND assertion_revision = ?",
			)
			.run(
				payloadJson,
				scope.principal,
				scope.scopeKey,
				assertionId,
				assertionRevision,
			),
		1,
		"CURRENT_UPDATE",
	);
}
