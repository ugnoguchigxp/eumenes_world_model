/** Synchronous persistence entry of the projection domain. */
import { migration001 } from "./repository/migrations/001.ts";
import {
	expectChanges,
	requireTransaction,
	type MigrationDescriptor,
	type WorldDb,
} from "../../infrastructure/sqlite/db.ts";
import {
	canonicalBytes,
	checkDigest,
	checkScope,
	type ScopeRef,
} from "../../contracts/index.ts";
import {
	currentRowError,
	deleteAllCurrent,
	deleteCurrentFor,
	insertCurrent,
	maxReadRows,
	type AssertionRefLike,
	type CurrentRow,
} from "./repository/current.ts";
import {
	deleteAllEdges,
	deleteEdgesFor,
	edgeRowError,
	insertEdges,
	type EdgeRow,
} from "./repository/edges.ts";
import { advanceEpoch } from "./repository/epoch.ts";

/** Upper bound of rows one replace may carry. */
const maxProjectionRows = 100_000;

export const projectionMigrations: readonly MigrationDescriptor[] =
	Object.freeze([migration001]);

export { getEpoch, type EpochState } from "./repository/epoch.ts";
export {
	getCurrentRow,
	updateCurrentPayload,
	readCurrent,
	type CurrentRow,
	type BoundedRows,
} from "./repository/current.ts";
export {
	readEdgesFrom,
	readEdgesTo,
	type EdgeRow,
} from "./repository/edges.ts";

export interface ReplaceProjectionInput {
	readonly entries: readonly CurrentRow[];
	readonly edges: readonly EdgeRow[];
	readonly materialDigest: string;
}
export type ReplaceProjectionResult =
	| {
			readonly status: "applied";
			readonly epoch: number;
			readonly changed: boolean;
	  }
	| {
			readonly status: "rejected";
			readonly reasonCode: "INVALID_INPUT" | "LIMIT_EXCEEDED";
	  };

/**
 * Replaces ONLY this Scope's projection rows and advances the Scope epoch when
 * the material digest changed (first material => epoch 1; same digest => no change).
 */
export function replaceProjection(
	db: WorldDb,
	scope: ScopeRef,
	input: ReplaceProjectionInput,
): ReplaceProjectionResult {
	requireTransaction(db);
	if (!checkScope(scope).ok || !checkDigest(input.materialDigest).ok)
		return { status: "rejected", reasonCode: "INVALID_INPUT" };
	if (
		input.entries.length > maxProjectionRows ||
		input.edges.length > maxProjectionRows
	)
		return { status: "rejected", reasonCode: "LIMIT_EXCEEDED" };
	const keys = new Set<string>();
	for (const row of input.entries) {
		const key = JSON.stringify([row.assertionId, row.assertionRevision]);
		if (currentRowError(row) || keys.has(key))
			return { status: "rejected", reasonCode: "INVALID_INPUT" };
		keys.add(key);
	}
	const edgeKeys = new Set<string>();
	for (const row of input.edges) {
		const key = JSON.stringify([row.edgeId, row.revision]);
		if (edgeRowError(row) || edgeKeys.has(key))
			return { status: "rejected", reasonCode: "INVALID_INPUT" };
		edgeKeys.add(key);
	}
	deleteAllCurrent(db, scope);
	deleteAllEdges(db, scope);
	insertCurrent(db, scope, input.entries);
	insertEdges(db, scope, input.edges);
	const plan = advanceEpoch(db, scope, input.materialDigest);
	return { status: "applied", ...plan };
}

/** Removes derived rows for the given assertion versions (forget / invalidate). */
export function deleteProjectionFor(
	db: WorldDb,
	scope: ScopeRef,
	refs: readonly AssertionRefLike[],
): { readonly current: number; readonly edges: number } {
	requireTransaction(db);
	if (!checkScope(scope).ok || refs.length > maxReadRows)
		throw new RangeError("invalid_input");
	return {
		current: deleteCurrentFor(db, scope, refs),
		edges: deleteEdgesFor(db, scope, refs),
	};
}

/**
 * Incremental projection primitives (additive): the application layer removes,
 * inserts and patches rows of the changed assertions only, then advances the
 * Scope epoch once with the new material digest.
 */
export function insertProjectionRows(
	db: WorldDb,
	scope: ScopeRef,
	rows: {
		readonly entries: readonly CurrentRow[];
		readonly edges: readonly EdgeRow[];
	},
): void {
	requireTransaction(db);
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	for (const row of rows.entries)
		if (currentRowError(row)) throw new RangeError("invalid_current_row");
	for (const row of rows.edges)
		if (edgeRowError(row)) throw new RangeError("invalid_edge_row");
	insertCurrent(db, scope, rows.entries);
	insertEdges(db, scope, rows.edges);
}

/** Drops every projected row of this Scope (full rebuild start). */
export function clearProjection(db: WorldDb, scope: ScopeRef): void {
	requireTransaction(db);
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	deleteAllCurrent(db, scope);
	deleteAllEdges(db, scope);
}

/** Epoch only: +1 iff the material digest changed. */
export function advanceProjectionEpoch(
	db: WorldDb,
	scope: ScopeRef,
	materialDigest: string,
): { readonly epoch: number; readonly changed: boolean } {
	requireTransaction(db);
	if (!checkScope(scope).ok || !checkDigest(materialDigest).ok)
		throw new RangeError("invalid_input");
	return advanceEpoch(db, scope, materialDigest);
}

/**
 * Sets causal eligibility of one projected assertion revision: the
 * world_current column and, when the assertion is a relation, the same flag
 * inside its edge payload. Exactly one current row must change.
 */
export function setCausalEligible(
	db: WorldDb,
	scope: ScopeRef,
	assertionId: string,
	assertionRevision: number,
	eligible: boolean,
): void {
	requireTransaction(db);
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	expectChanges(
		db
			.query(
				"UPDATE world_current SET causal_eligible = ? WHERE principal = ? AND scope_key = ? AND assertion_id = ? AND assertion_revision = ?",
			)
			.run(
				eligible ? 1 : 0,
				scope.principal,
				scope.scopeKey,
				assertionId,
				assertionRevision,
			),
		1,
		"CURRENT_ELIGIBLE",
	);
	const edges = db
		.query(
			"SELECT edge_id, revision, payload_json FROM world_edge WHERE principal = ? AND scope_key = ? AND assertion_id = ? AND assertion_revision = ?",
		)
		.all(scope.principal, scope.scopeKey, assertionId, assertionRevision) as {
		edge_id: string;
		revision: number;
		payload_json: string;
	}[];
	for (const edge of edges) {
		const payload = JSON.parse(edge.payload_json) as Record<string, unknown>;
		if (payload["causalEligible"] === eligible) continue;
		const bytes = canonicalBytes({ ...payload, causalEligible: eligible });
		if (!bytes.ok) throw new RangeError("invalid_payload");
		expectChanges(
			db
				.query(
					"UPDATE world_edge SET payload_json = ? WHERE principal = ? AND scope_key = ? AND edge_id = ? AND revision = ?",
				)
				.run(
					new TextDecoder().decode(bytes.value),
					scope.principal,
					scope.scopeKey,
					edge.edge_id,
					edge.revision,
				),
			1,
			"EDGE_ELIGIBLE",
		);
	}
}
