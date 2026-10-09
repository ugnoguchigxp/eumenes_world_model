import {
	checkId,
	checkScope,
	type ScopeRef,
} from "../../../contracts/index.ts";
import type { DependentRef } from "../../../contracts/index.ts";
import {
	expectChanges,
	requireTransaction,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";
import { checkOutcome, type Outcome } from "../contracts/index.ts";
import {
	comparisonKey,
	payloadText,
	rejected,
	type InsertResult,
	type Page,
} from "./predictions.ts";
import type { Prediction } from "../contracts/index.ts";

export interface OutcomeInput {
	/** Id of the prediction this outcome measures; revision is in the outcome. */
	readonly predictionId: string;
	readonly outcome: Outcome;
}
export interface StoredOutcome {
	readonly predictionId: string;
	readonly outcome: Outcome;
}

/**
 * Stores a measured outcome. It must reference an existing prediction
 * (id + revision) of the SAME scope and carry the same comparisonId.
 */
export function insertOutcome(
	db: WorldDb,
	scope: ScopeRef,
	input: OutcomeInput,
): InsertResult {
	requireTransaction(db);
	const checkedScope = checkScope(scope);
	if (!checkedScope.ok) return rejected("INVALID_SCOPE");
	if (!checkId(input.predictionId).ok)
		return rejected("INVALID_PREDICTION_REF");
	const outcome = checkOutcome(input.outcome, "outcome");
	if (!outcome.ok) return rejected("INVALID_OUTCOME");
	const text = payloadText(outcome.value);
	if (text === undefined) return rejected("INVALID_OUTCOME");
	const { principal, scopeKey } = checkedScope.value;
	const o = outcome.value;
	const prediction = db
		.query(
			"SELECT comparison_id, payload_json FROM world_prediction WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ?",
		)
		.get(principal, scopeKey, input.predictionId, o.predictionRevision) as
		| { comparison_id: string; payload_json: string }
		| undefined;
	if (!prediction) return rejected("PREDICTION_NOT_FOUND");
	if (
		prediction.comparison_id !==
		comparisonKey(JSON.parse(prediction.payload_json) as Prediction)
	)
		return rejected("PREDICTION_NOT_FOUND");
	if (prediction.comparison_id !== o.comparisonId)
		return rejected("COMPARISON_MISMATCH");
	const existing = db
		.query(
			"SELECT payload_json, prediction_id FROM world_outcome WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ?",
		)
		.get(principal, scopeKey, o.outcomeId, o.revision) as
		| { payload_json: string; prediction_id: string }
		| undefined;
	if (existing)
		return existing.payload_json === text &&
			existing.prediction_id === input.predictionId
			? { status: "unchanged" }
			: rejected("OUTCOME_REVISION_CONFLICT");
	const result = db
		.query(
			"INSERT INTO world_outcome (principal, scope_key, id, revision, comparison_id, prediction_id, prediction_revision, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
		.run(
			principal,
			scopeKey,
			o.outcomeId,
			o.revision,
			o.comparisonId,
			input.predictionId,
			o.predictionRevision,
			text,
		);
	expectChanges(result, 1, "OUTCOME_INSERT");
	return { status: "inserted" };
}

type OutcomeRow = { payload_json: string; prediction_id: string };
const toStored = (row: OutcomeRow): StoredOutcome => ({
	predictionId: row.prediction_id,
	outcome: JSON.parse(row.payload_json) as Outcome,
});

export function getOutcome(
	db: WorldDb,
	scope: ScopeRef,
	id: string,
	revision: number,
): StoredOutcome | undefined {
	const row = db
		.query(
			"SELECT payload_json, prediction_id FROM world_outcome WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ?",
		)
		.get(scope.principal, scope.scopeKey, id, revision) as
		| OutcomeRow
		| undefined;
	return row ? toStored(row) : undefined;
}

export function listOutcomesByComparison(
	db: WorldDb,
	scope: ScopeRef,
	comparisonId: string,
	limit: number,
): Page<StoredOutcome> {
	if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("limit");
	const rows = db
		.query(
			"SELECT payload_json, prediction_id FROM world_outcome WHERE principal = ? AND scope_key = ? AND comparison_id = ? ORDER BY id, revision LIMIT ?",
		)
		.all(
			scope.principal,
			scope.scopeKey,
			comparisonId,
			limit + 1,
		) as OutcomeRow[];
	return {
		items: rows.slice(0, limit).map(toStored),
		truncated: rows.length > limit,
	};
}

/**
 * Forget/invalidate path. Predictions are removed by id (EVERY revision, with
 * all their outcomes: a tombstone is by id). Deletes the referenced predictions and outcomes of
 * one scope; outcomes that measure a deleted prediction go first (FK order).
 * Absent refs are not an error, so the call is safe to repeat.
 */
export function deletePredictionsAndOutcomes(
	db: WorldDb,
	scope: ScopeRef,
	refs: readonly DependentRef[],
): { readonly outcomes: number; readonly predictions: number } {
	requireTransaction(db);
	const checkedScope = checkScope(scope);
	if (!checkedScope.ok) throw new RangeError("scope");
	const { principal, scopeKey } = checkedScope.value;
	let outcomes = 0;
	let predictions = 0;
	const count = (result: unknown) => (result as { changes: number }).changes;
	for (const ref of refs)
		if (ref.kind === "outcome")
			outcomes += count(
				db
					.query(
						"DELETE FROM world_outcome WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ?",
					)
					.run(principal, scopeKey, ref.id, ref.revision),
			);
	for (const ref of refs)
		if (ref.kind === "prediction") {
			outcomes += count(
				db
					.query(
						"DELETE FROM world_outcome WHERE principal = ? AND scope_key = ? AND prediction_id = ?",
					)
					.run(principal, scopeKey, ref.id),
			);
			predictions += count(
				db
					.query(
						"DELETE FROM world_prediction WHERE principal = ? AND scope_key = ? AND id = ?",
					)
					.run(principal, scopeKey, ref.id),
			);
		}
	return { outcomes, predictions };
}
