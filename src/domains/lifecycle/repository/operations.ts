import {
	checkDigest,
	checkId,
	checkOperationKey,
	checkScope,
	type ScopeRef,
} from "../../../contracts/index.ts";
import {
	expectChanges,
	requireTransaction,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";

export const operationResultStatuses = ["applied", "no_op"] as const;
export interface OperationRecord {
	readonly operationKey: string;
	readonly kind: string;
	/** Digest of the canonical payload only; no business payload is stored. */
	readonly payloadDigest: string;
	readonly canonicalVersion: number;
	readonly resultStatus: (typeof operationResultStatuses)[number];
	/** Opaque reference; never a content carrier. */
	readonly receiptRef: string;
}
export type RecordOperationResult =
	| { readonly status: "applied" }
	| {
			readonly status: "rejected";
			readonly reasonCode: "INVALID_INPUT" | "OPERATION_KEY_EXISTS";
	  };

export function getOperation(
	db: WorldDb,
	scope: ScopeRef,
	operationKey: string,
): OperationRecord | undefined {
	if (!checkScope(scope).ok) throw new RangeError("invalid_scope");
	const row = db
		.query(
			"SELECT operation_key, kind, payload_digest, canonical_version, result_status, receipt_ref FROM world_operation WHERE principal = ? AND scope_key = ? AND operation_key = ?",
		)
		.get(scope.principal, scope.scopeKey, operationKey) as
		| {
				operation_key: string;
				kind: string;
				payload_digest: string;
				canonical_version: number;
				result_status: OperationRecord["resultStatus"];
				receipt_ref: string;
		  }
		| null
		| undefined;
	return row
		? {
				operationKey: row.operation_key,
				kind: row.kind,
				payloadDigest: row.payload_digest,
				canonicalVersion: row.canonical_version,
				resultStatus: row.result_status,
				receiptRef: row.receipt_ref,
			}
		: undefined;
}

/** Records one receipt. A reused key is rejected, never overwritten. */
export function recordOperation(
	db: WorldDb,
	scope: ScopeRef,
	record: OperationRecord,
): RecordOperationResult {
	requireTransaction(db);
	if (
		!checkScope(scope).ok ||
		!checkOperationKey(record.operationKey).ok ||
		!checkId(record.kind).ok ||
		!checkDigest(record.payloadDigest).ok ||
		!Number.isSafeInteger(record.canonicalVersion) ||
		record.canonicalVersion < 1 ||
		!operationResultStatuses.includes(record.resultStatus) ||
		!checkId(record.receiptRef).ok
	)
		return { status: "rejected", reasonCode: "INVALID_INPUT" };
	if (getOperation(db, scope, record.operationKey))
		return { status: "rejected", reasonCode: "OPERATION_KEY_EXISTS" };
	expectChanges(
		db
			.query(
				"INSERT INTO world_operation (principal, scope_key, operation_key, kind, payload_digest, canonical_version, result_status, receipt_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.run(
				scope.principal,
				scope.scopeKey,
				record.operationKey,
				record.kind,
				record.payloadDigest,
				record.canonicalVersion,
				record.resultStatus,
				record.receiptRef,
			),
		1,
		"OPERATION_INSERT",
	);
	return { status: "applied" };
}
