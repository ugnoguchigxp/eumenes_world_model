import {
	expectChanges,
	requireTransaction,
	type SqlValue,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";
import {
	checkId,
	checkRevision,
	type ScopeRef,
} from "../../../contracts/index.ts";
import {
	assertScope,
	checkLimit,
	checkPayloadJson,
	maxReadRows,
	type AssertionRefLike,
	type BoundedRows,
} from "./current.ts";

export const relationKinds = [
	"increases",
	"decreases",
	"causes",
	"enables",
	"inhibits",
	"correlates_with",
	"depends_on",
	"part_of",
	"serves_goal",
	"related_to",
];

export interface EdgeRow {
	readonly edgeId: string;
	readonly revision: number;
	readonly fromId: string;
	readonly toId: string;
	readonly relation: string;
	readonly assertionId: string;
	readonly assertionRevision: number;
	readonly payloadJson: string;
}

export function edgeRowError(row: EdgeRow): string | undefined {
	if (
		!checkId(row.edgeId).ok ||
		!checkRevision(row.revision).ok ||
		!checkId(row.fromId).ok ||
		!checkId(row.toId).ok ||
		!relationKinds.includes(row.relation) ||
		!checkId(row.assertionId).ok ||
		!checkRevision(row.assertionRevision).ok ||
		!checkPayloadJson(row.payloadJson)
	)
		return "INVALID_INPUT";
	return undefined;
}

export function insertEdges(
	db: WorldDb,
	scope: ScopeRef,
	rows: readonly EdgeRow[],
): void {
	requireTransaction(db);
	const statement = db.query(
		"INSERT INTO world_edge (principal, scope_key, edge_id, revision, from_id, to_id, relation, assertion_id, assertion_revision, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	);
	for (const row of rows)
		expectChanges(
			statement.run(
				scope.principal,
				scope.scopeKey,
				row.edgeId,
				row.revision,
				row.fromId,
				row.toId,
				row.relation,
				row.assertionId,
				row.assertionRevision,
				row.payloadJson,
			),
			1,
			"EDGE_INSERT",
		);
}

export function deleteAllEdges(db: WorldDb, scope: ScopeRef): number {
	requireTransaction(db);
	return (
		db
			.query("DELETE FROM world_edge WHERE principal = ? AND scope_key = ?")
			.run(scope.principal, scope.scopeKey) as { changes: number }
	).changes;
}

export function deleteEdgesFor(
	db: WorldDb,
	scope: ScopeRef,
	refs: readonly AssertionRefLike[],
): number {
	requireTransaction(db);
	const statement = db.query(
		"DELETE FROM world_edge WHERE principal = ? AND scope_key = ? AND assertion_id = ? AND assertion_revision = ?",
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

interface RawEdge {
	edge_id: string;
	revision: number;
	from_id: string;
	to_id: string;
	relation: string;
	assertion_id: string;
	assertion_revision: number;
	payload_json: string;
}

function readEdges(
	db: WorldDb,
	scope: ScopeRef,
	column: "from_id" | "to_id",
	ids: readonly string[],
	limit: number,
): BoundedRows<EdgeRow> {
	assertScope(scope);
	const bound = checkLimit(limit);
	if (ids.length === 0) return { rows: [], truncated: false };
	if (ids.length > maxReadRows) throw new RangeError("too_many_ids");
	const params: SqlValue[] = [
		scope.principal,
		scope.scopeKey,
		...ids,
		bound + 1,
	];
	// `column` is one of two literals chosen above, never caller text.
	const raw = db
		.query(
			`SELECT edge_id, revision, from_id, to_id, relation, assertion_id, assertion_revision, payload_json FROM world_edge WHERE principal = ? AND scope_key = ? AND ${column} IN (${ids.map(() => "?").join(", ")}) ORDER BY ${column}, edge_id, revision LIMIT ?`,
		)
		.all(...params) as RawEdge[];
	return {
		rows: raw.slice(0, bound).map((r) => ({
			edgeId: r.edge_id,
			revision: r.revision,
			fromId: r.from_id,
			toId: r.to_id,
			relation: r.relation,
			assertionId: r.assertion_id,
			assertionRevision: r.assertion_revision,
			payloadJson: r.payload_json,
		})),
		truncated: raw.length > bound,
	};
}
export const readEdgesFrom = (
	db: WorldDb,
	scope: ScopeRef,
	ids: readonly string[],
	limit: number,
) => readEdges(db, scope, "from_id", ids, limit);
export const readEdgesTo = (
	db: WorldDb,
	scope: ScopeRef,
	ids: readonly string[],
	limit: number,
) => readEdges(db, scope, "to_id", ids, limit);
