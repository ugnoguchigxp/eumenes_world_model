import type { ScopeRef } from "../../../contracts/index.ts";
import {
	expectChanges,
	requireTransaction,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";
import type { AssertionRef } from "../contracts/assertion.ts";
import { sourceIdentityKey, type Evidence } from "../contracts/evidence.ts";
import {
	canonicalText,
	getHead,
	rejected,
	scopeOf,
	type WriteRejected,
} from "./assertions.ts";

/** Cited evidence of one assertion revision. Source keys use the identity key. */
export function insertEvidence(
	db: WorldDb,
	scope: ScopeRef,
	assertion: AssertionRef,
	evidence: readonly Evidence[],
): { readonly status: "applied"; readonly inserted: number } | WriteRejected {
	requireTransaction(db);
	const checked = scopeOf(scope);
	if (!checked) return rejected("INVALID_INPUT");
	if (new Set(evidence.map((item) => item.evidenceId)).size !== evidence.length)
		return rejected("DUPLICATE_EVIDENCE");
	const rows: { item: Evidence; text: string }[] = [];
	for (const item of evidence) {
		const text = canonicalText(item);
		if (!text.ok) return rejected(text.reasonCode);
		rows.push({ item, text: text.text });
	}
	const head = getHead(db, checked, assertion.id);
	const exists = db
		.query(
			"SELECT 1 AS present FROM world_assertion WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ?",
		)
		.get(checked.principal, checked.scopeKey, assertion.id, assertion.revision);
	if (!head || !exists) return rejected("ASSERTION_NOT_FOUND");
	for (const { item } of rows) {
		const duplicate = db
			.query(
				"SELECT 1 AS present FROM world_evidence WHERE principal = ? AND scope_key = ? AND assertion_id = ? AND assertion_revision = ? AND evidence_id = ?",
			)
			.get(
				checked.principal,
				checked.scopeKey,
				assertion.id,
				assertion.revision,
				item.evidenceId,
			);
		if (duplicate) return rejected("DUPLICATE_EVIDENCE");
	}
	for (const { item, text } of rows)
		expectChanges(
			db
				.query(
					"INSERT INTO world_evidence (principal, scope_key, assertion_id, assertion_revision, evidence_id, root_evidence_id, stance, source_key, source_revision, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
				)
				.run(
					checked.principal,
					checked.scopeKey,
					assertion.id,
					assertion.revision,
					item.evidenceId,
					item.rootEvidenceId,
					item.stance,
					sourceIdentityKey(item.source),
					item.source.revision,
					text,
				),
			1,
			"EVIDENCE_INSERT",
		);
	return { status: "applied", inserted: rows.length };
}

export function listEvidence(
	db: WorldDb,
	scope: ScopeRef,
	assertion: AssertionRef,
): readonly Evidence[] {
	return (
		db
			.query(
				"SELECT payload_json FROM world_evidence WHERE principal = ? AND scope_key = ? AND assertion_id = ? AND assertion_revision = ? ORDER BY evidence_id",
			)
			.all(
				scope.principal,
				scope.scopeKey,
				assertion.id,
				assertion.revision,
			) as {
			payload_json: string;
		}[]
	).map((row) => JSON.parse(row.payload_json) as Evidence);
}
