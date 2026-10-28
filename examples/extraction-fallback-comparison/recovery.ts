import { asRecord, type Entity } from "../../src/index.ts";
import { seedScope } from "../../eval/seed/corpus.ts";
import { validateOutput } from "../seed-luna/pipeline.ts";
import {
	date,
	documentInputs,
	interpret,
	type AnswerContext,
} from "../multi-source-comparison/world.ts";
import type { Packet } from "../multi-source-comparison/fixtures.ts";

/** Example-only recovery. Never registers rejected candidates or selects rules. */
export function recover(packet: Packet, raw: string) {
	const output = asRecord(JSON.parse(raw));
	const entries = output?.["documents"];
	if (!Array.isArray(entries) || entries.length !== packet.documents.length)
		throw new Error("extraction_document_count");
	const entity: Entity = {
		id: packet.id,
		scope: seedScope,
		revision: 1,
		displayName: packet.name,
		aliases: [],
		externalRefs: [],
	};
	const documents = documentInputs(packet);
	const diagnostics = documents.map((document, index) => {
		const item = asRecord(entries[index]);
		if (!item || item["documentId"] !== document.recordId)
			throw new Error("extraction_document_order");
		// Check the entire envelope, including documents after the first refusal.
		const earlier = documents.slice(0, index).map((d) => d.recordId);
		const refs = item["contradicts"];
		if (!Array.isArray(refs) || refs.some((id) => !earlier.includes(id)))
			throw new Error("invalid_conflict_reference");
		for (const key of ["validFrom", "validUntil"])
			if (item[key] !== null) date(item[key]);
		const changes = item["withdrawals"];
		if (!Array.isArray(changes)) throw new Error("invalid_withdrawals");
		for (const change of changes) {
			const entry = asRecord(change);
			if (
				!entry ||
				typeof entry["target"] !== "string" ||
				!earlier.includes(entry["target"])
			)
				throw new Error("invalid_withdrawal_target");
			date(entry["effectiveAt"]);
		}
		const candidates = item["candidates"];
		if (!Array.isArray(candidates) || candidates.length > 1)
			throw new Error("unsupported_candidate_count");
		const checked = validateOutput(
			document,
			entity,
			{ candidates },
			date(packet.documents[index]!.published),
		);
		if (checked.validation.status === "rejected")
			throw new Error("malformed_extraction_output");
		if (checked.bindings.some((binding) => binding.status !== "bound"))
			throw new Error("unbound_quote");
		const reasons = checked.validation.verdicts.flatMap((v) =>
			v.status === "accepted" ? [] : v.reasonCodes,
		);
		// Narrow recovery contract backed by the observed failure. Invalid output
		// and binding failures are not availability failures and remain errors.
		if (reasons.some((r) => r !== "HYPOTHETICAL_NOT_FACT"))
			throw new Error(
				`unrecoverable_candidate:${document.recordId}:${reasons.join(",")}`,
			);
		const accepted = checked.assertions.length === 1;
		return {
			documentId: document.recordId,
			status: accepted ? "accepted" : "unavailable",
			reasons: candidates.length ? reasons : ["NO_CANDIDATE"],
		};
	});
	if (diagnostics.every((d) => d.status === "accepted"))
		return {
			mode: "world" as const,
			material: interpret(packet, raw),
			diagnostics,
		};
	// Keep every original source; no partial withdrawal/conflict graph is used.
	const context: AnswerContext = {
		sources: documents.map((d) => ({
			id: d.recordId,
			ref: d.source,
			text: d.content,
		})),
		observationKeys: packet.keys,
		derivedView: null,
	};
	return { mode: "source-only" as const, context, diagnostics };
}
