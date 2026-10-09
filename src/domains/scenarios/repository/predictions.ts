import {
	canonicalBytes,
	checkId,
	checkRevision,
	checkScope,
	type ScopeRef,
} from "../../../contracts/index.ts";
import {
	expectChanges,
	requireTransaction,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";
import { checkPrediction, type Prediction } from "../contracts/index.ts";

export type RepositoryRejection = {
	readonly status: "rejected";
	readonly reasonCode: string;
};
export interface BasisAssertion {
	readonly assertionId: string;
	readonly revision: number;
}
export interface PredictionInput {
	readonly prediction: Prediction;
	/** Caller-supplied deadline (UTC ms) of the expected observation. */
	readonly dueAt: number;
	readonly basis?: BasisAssertion;
}
export interface StoredPrediction {
	readonly prediction: Prediction;
	readonly dueAt: number;
	readonly basis?: BasisAssertion;
}
export type InsertResult =
	| { readonly status: "inserted" | "unchanged" }
	| RepositoryRejection;
export interface Page<T> {
	readonly items: readonly T[];
	/** True when more rows exist than the requested limit (sentinel row seen). */
	readonly truncated: boolean;
}

const decoder = new TextDecoder();
export const rejected = (reasonCode: string): RepositoryRejection => ({
	status: "rejected",
	reasonCode,
});
export function payloadText(value: unknown): string | undefined {
	const bytes = canonicalBytes(value);
	return bytes.ok ? decoder.decode(bytes.value) : undefined;
}
/** Qualitative predictions have no measurement plan; give them a stable key. */
export function comparisonKey(prediction: Prediction): string {
	return prediction.kind === "quantitative"
		? prediction.comparisonId
		: `qualitative:${prediction.predictionId}`;
}
export function metricOf(prediction: Prediction): string {
	return prediction.kind === "quantitative" ? prediction.conditions.metric : "";
}

type PredictionRow = {
	payload_json: string;
	due_at: number;
	basis_assertion_id: string | null;
	basis_assertion_revision: number | null;
};

/**
 * Inserts an immutable prediction revision. The same id/revision with the same
 * payload is "unchanged"; a different payload (for example a changed tolerance)
 * is rejected and must use a new revision.
 */
export function insertPrediction(
	db: WorldDb,
	scope: ScopeRef,
	input: PredictionInput,
): InsertResult {
	requireTransaction(db);
	const checkedScope = checkScope(scope);
	if (!checkedScope.ok) return rejected("INVALID_SCOPE");
	const prediction = checkPrediction(input.prediction, "prediction");
	if (!prediction.ok) return rejected("INVALID_PREDICTION");
	if (!Number.isSafeInteger(input.dueAt)) return rejected("INVALID_DUE_AT");
	const basis = input.basis;
	if (basis !== undefined) {
		if (!checkId(basis.assertionId).ok || !checkRevision(basis.revision).ok)
			return rejected("INVALID_BASIS");
	}
	const text = payloadText(prediction.value);
	if (text === undefined) return rejected("INVALID_PREDICTION");
	const { principal, scopeKey } = checkedScope.value;
	const p = prediction.value;
	const existing = db
		.query(
			"SELECT payload_json FROM world_prediction WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ?",
		)
		.get(principal, scopeKey, p.predictionId, p.revision) as
		| { payload_json: string }
		| undefined;
	if (existing)
		return existing.payload_json === text
			? { status: "unchanged" }
			: rejected("PREDICTION_REVISION_CONFLICT");
	const result = db
		.query(
			"INSERT INTO world_prediction (principal, scope_key, id, revision, comparison_id, metric, due_at, basis_assertion_id, basis_assertion_revision, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		)
		.run(
			principal,
			scopeKey,
			p.predictionId,
			p.revision,
			comparisonKey(p),
			metricOf(p),
			input.dueAt,
			basis?.assertionId ?? null,
			basis?.revision ?? null,
			text,
		);
	expectChanges(result, 1, "PREDICTION_INSERT");
	return { status: "inserted" };
}

function toStored(row: PredictionRow): StoredPrediction {
	const prediction = JSON.parse(row.payload_json) as Prediction;
	return {
		prediction,
		dueAt: row.due_at,
		...(row.basis_assertion_id !== null && row.basis_assertion_revision !== null
			? {
					basis: {
						assertionId: row.basis_assertion_id,
						revision: row.basis_assertion_revision,
					},
				}
			: {}),
	};
}
const columns =
	"payload_json, due_at, basis_assertion_id, basis_assertion_revision";

export function getPrediction(
	db: WorldDb,
	scope: ScopeRef,
	id: string,
	revision: number,
): StoredPrediction | undefined {
	const row = db
		.query(
			`SELECT ${columns} FROM world_prediction WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ?`,
		)
		.get(scope.principal, scope.scopeKey, id, revision) as
		| PredictionRow
		| undefined;
	return row ? toStored(row) : undefined;
}

function boundedLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("limit");
	return limit;
}
function page<T>(rows: readonly T[], limit: number): Page<T> {
	return { items: rows.slice(0, limit), truncated: rows.length > limit };
}

/** Reads limit + 1 rows so truncation is detected without a COUNT scan. */
export function listPredictionsByComparison(
	db: WorldDb,
	scope: ScopeRef,
	comparisonId: string,
	limit: number,
): Page<StoredPrediction> {
	const n = boundedLimit(limit);
	const rows = db
		.query(
			`SELECT ${columns} FROM world_prediction WHERE principal = ? AND scope_key = ? AND comparison_id = ? ORDER BY id, revision LIMIT ?`,
		)
		.all(
			scope.principal,
			scope.scopeKey,
			comparisonId,
			n + 1,
		) as PredictionRow[];
	return page(rows.map(toStored), n);
}

export function listPredictionsByBasisAssertion(
	db: WorldDb,
	scope: ScopeRef,
	assertionId: string,
	limit: number,
	revision?: number,
): Page<StoredPrediction> {
	const n = boundedLimit(limit);
	const rows = (
		revision === undefined
			? db
					.query(
						`SELECT ${columns} FROM world_prediction INDEXED BY world_prediction_basis WHERE principal = ? AND scope_key = ? AND basis_assertion_id = ? ORDER BY id, revision LIMIT ?`,
					)
					.all(scope.principal, scope.scopeKey, assertionId, n + 1)
			: db
					.query(
						`SELECT ${columns} FROM world_prediction INDEXED BY world_prediction_basis WHERE principal = ? AND scope_key = ? AND basis_assertion_id = ? AND basis_assertion_revision = ? ORDER BY id, revision LIMIT ?`,
					)
					.all(scope.principal, scope.scopeKey, assertionId, revision, n + 1)
	) as PredictionRow[];
	return page(rows.map(toStored), n);
}

/**
 * Forget discovery: predictions that name the entity as subject (quantitative
 * `conditions.subjectId`, qualitative `subjectId`/`objectId`). The entity is
 * only inside payload_json (no index), so this scans one Scope's predictions
 * and is used only when an entity is forgotten. Limit+1 sentinel.
 */
export function listPredictionsReferencingEntity(
	db: WorldDb,
	scope: ScopeRef,
	entityId: string,
	limit: number,
): {
	readonly refs: readonly { id: string; revision: number }[];
	readonly truncated: boolean;
} {
	const n = boundedLimit(limit);
	const rows = db
		.query(
			`SELECT id, revision FROM world_prediction WHERE principal = ? AND scope_key = ?
			 AND (json_extract(payload_json, '$.conditions.subjectId') = ?
				OR json_extract(payload_json, '$.subjectId') = ?
				OR json_extract(payload_json, '$.objectId') = ?)
			 ORDER BY id, revision LIMIT ?`,
		)
		.all(
			scope.principal,
			scope.scopeKey,
			entityId,
			entityId,
			entityId,
			n + 1,
		) as {
		id: string;
		revision: number;
	}[];
	return {
		refs: rows
			.slice(0, n)
			.map((row) => ({ id: row.id, revision: row.revision })),
		truncated: rows.length > n,
	};
}

/**
 * Predictions naming any of `entityIds` as subject or object, per entity, in
 * ONE scan of the Scope's predictions (cost independent of the batch size).
 */
export function listPredictionsReferencingEntities(
	db: WorldDb,
	scope: ScopeRef,
	entityIds: readonly string[],
	limit: number,
): ReadonlyMap<
	string,
	{
		readonly refs: readonly { id: string; revision: number }[];
		readonly truncated: boolean;
	}
> {
	const n = boundedLimit(limit);
	const wanted = new Set(entityIds);
	const matches = new Map<string, { id: string; revision: number }[]>();
	for (const id of wanted) matches.set(id, []);
	if (wanted.size > 0) {
		const rows = db
			.query(
				`SELECT id, revision,
				 json_extract(payload_json, '$.conditions.subjectId') AS a,
				 json_extract(payload_json, '$.subjectId') AS b,
				 json_extract(payload_json, '$.objectId') AS c
				 FROM world_prediction WHERE principal = ? AND scope_key = ?
				 ORDER BY id, revision`,
			)
			.all(scope.principal, scope.scopeKey) as {
			id: string;
			revision: number;
			a: unknown;
			b: unknown;
			c: unknown;
		}[];
		for (const row of rows)
			for (const key of new Set([row.a, row.b, row.c]))
				if (typeof key === "string")
					matches.get(key)?.push({ id: row.id, revision: row.revision });
	}
	const out = new Map<
		string,
		{ refs: { id: string; revision: number }[]; truncated: boolean }
	>();
	for (const [entity, refs] of matches)
		out.set(entity, { refs: refs.slice(0, n), truncated: refs.length > n });
	return out;
}
