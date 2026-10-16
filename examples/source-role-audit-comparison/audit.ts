import { asRecord } from "../../src/index.ts";
import { parseGroundedAnswer } from "../multi-source-comparison/grounding.ts";
import type { AnswerContext } from "../multi-source-comparison/world.ts";
import type { Question } from "../multi-source-comparison/fixtures.ts";
import { presentation } from "./protocol.ts";
export function auditPrompt(q: Question, ctx: AnswerContext, raw: string) {
	return JSON.stringify({
		originalInput: JSON.parse(presentation(q, ctx)),
		listedSourceIds: parseGroundedAnswer(raw).governingSources,
	});
}
export const auditSchema = {
	type: "object",
	additionalProperties: false,
	required: ["reviews"],
	properties: {
		reviews: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["sourceId", "verdict", "role", "reason", "evidence"],
				properties: {
					sourceId: { type: "string" },
					verdict: {
						type: "string",
						enum: ["applicable", "inapplicable", "uncertain"],
					},
					role: { type: "string" },
					reason: { type: "string" },
					evidence: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							required: ["sourceId", "quote"],
							properties: {
								sourceId: { type: "string" },
								quote: { type: "string" },
							},
						},
					},
				},
			},
		},
	},
};
export interface SourceReview {
	sourceId: string;
	verdict: "applicable" | "inapplicable" | "uncertain";
	role: string;
	reason: string;
	evidence: { sourceId: string; quote: string }[];
}
/** Validate an LLM verdict's contract and literal evidence, never infer semantic scope. */
export function validateAudit(raw: string, answer: string, ctx: AnswerContext) {
	const data = asRecord(JSON.parse(raw));
	if (!Array.isArray(data?.["reviews"]))
		throw new Error("missing_source_reviews");
	const listed = parseGroundedAnswer(answer).governingSources;
	const reviews: SourceReview[] = data["reviews"].map((value) => {
		const r = asRecord(value);
		if (
			!r ||
			typeof r["sourceId"] !== "string" ||
			!["applicable", "inapplicable", "uncertain"].includes(
				String(r["verdict"]),
			) ||
			typeof r["role"] !== "string" ||
			!r["role"].trim() ||
			typeof r["reason"] !== "string" ||
			!r["reason"].trim() ||
			!Array.isArray(r["evidence"])
		)
			throw new Error("invalid_source_review");
		const evidence = r["evidence"].map((value) => {
			const e = asRecord(value);
			if (
				!e ||
				typeof e["sourceId"] !== "string" ||
				typeof e["quote"] !== "string" ||
				!e["quote"].trim()
			)
				throw new Error("invalid_audit_quote");
			const source = ctx.sources.find((s) => s.id === e["sourceId"]);
			const statement =
				source && asRecord(JSON.parse(source.text))?.["statement"];
			if (typeof statement !== "string" || !statement.includes(e["quote"]))
				throw new Error("audit_quote_not_in_source");
			return { sourceId: e["sourceId"], quote: e["quote"] };
		});
		if (r["verdict"] !== "uncertain" && !evidence.length)
			throw new Error("audit_evidence_missing");
		return {
			sourceId: r["sourceId"],
			verdict: r["verdict"] as SourceReview["verdict"],
			role: r["role"],
			reason: r["reason"],
			evidence,
		};
	});
	if (
		new Set(listed).size !== listed.length ||
		reviews.length !== listed.length ||
		new Set(reviews.map((r) => r.sourceId)).size !== reviews.length ||
		reviews.some(
			(r) =>
				!listed.includes(r.sourceId) ||
				!ctx.sources.some((s) => s.id === r.sourceId),
		)
	)
		throw new Error("audit_source_coverage_mismatch");
	return { passed: reviews.every((r) => r.verdict === "applicable"), reviews };
}
export type RoleAudit = ReturnType<typeof validateAudit>;
