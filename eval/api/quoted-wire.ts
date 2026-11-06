/** Exact wire binding only. No paraphrase search, normalization or meaning repair. */
import { extractionLimits, relationKinds } from "../../src/index.ts";
import type { ProviderRequest } from "../extraction/runner.ts";
type Schema = Record<string, unknown>;
export const wireString = { type: "string" };
export const wireTag = (s: string) => ({ type: "string", enum: [s] });
export const wireObject = (properties: Record<string, unknown>): Schema => ({
	type: "object",
	properties,
	required: Object.keys(properties),
	additionalProperties: false,
});
export const wireSubject = {
	anyOf: [
		wireObject({ kind: wireTag("id"), id: wireString }),
		wireObject({ kind: wireTag("alias"), text: wireString }),
	],
};
export const wireValue = {
	anyOf: [
		wireObject({ kind: wireTag("string"), value: wireString }),
		wireObject({ kind: wireTag("boolean"), value: { type: "boolean" } }),
		wireObject({
			kind: wireTag("number"),
			value: { type: "number" },
			unit: wireString,
		}),
		wireObject({ kind: wireTag("entity"), entityId: wireString }),
	],
};
export const quotedSchema: Schema = {
	...wireObject({
		candidates: {
			type: "array",
			items: wireObject({
				subject: { $ref: "#/$defs/subject" },
				predicate: wireString,
				payload: {
					anyOf: [
						wireObject({
							kind: wireTag("value"),
							value: { $ref: "#/$defs/value" },
						}),
						wireObject({
							kind: wireTag("relation"),
							relation: { type: "string", enum: [...relationKinds] },
							object: { $ref: "#/$defs/subject" },
						}),
					],
				},
				quote: wireObject({
					utteranceId: wireString,
					text: wireString,
					occurrence: { type: "integer" },
				}),
				modality: {
					type: "string",
					enum: ["asserted", "reported", "hypothetical", "negated", "question"],
				},
				conditionJson: wireString,
				validTimeJson: wireString,
			}),
		},
	}),
	$defs: { subject: wireSubject, value: wireValue },
};
const record = (v: unknown): Record<string, unknown> => {
	if (!v || typeof v !== "object" || Array.isArray(v))
		throw new Error("WIRE_OBJECT_REQUIRED");
	return v as Record<string, unknown>;
};
function exactKeys(r: Record<string, unknown>, keys: string[]) {
	if (
		Object.keys(r).length !== keys.length ||
		Object.keys(r).some((k) => !keys.includes(k))
	)
		throw new Error("WIRE_UNKNOWN_OR_MISSING_KEY");
}
function epoch(v: unknown): unknown {
	if (typeof v !== "string") return v;
	// ISO UTC is an external representation, not natural-language date parsing.
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v))
		throw new Error("WIRE_UTC_REQUIRED");
	const n = Date.parse(v);
	if (
		!Number.isSafeInteger(n) ||
		new Date(n).toISOString() !==
			v.replace(/Z$/, v.includes(".") ? "Z" : ".000Z")
	)
		throw new Error("WIRE_INVALID_DATE");
	return n;
}
function time(v: unknown): unknown {
	const r = record(v);
	if (r["kind"] === "instant") return { ...r, at: epoch(r["at"]) };
	return Object.fromEntries(
		Object.entries(r).map(([k, x]) => {
			if (k !== "start" && k !== "end") return [k, x];
			const b = record(x);
			return [
				k,
				Object.fromEntries(
					Object.entries(b).map(([key, val]) => [
						key,
						key === "earliest" || key === "latest" ? epoch(val) : val,
					]),
				),
			];
		}),
	);
}
export function decodeQuotedCandidates(
	text: string,
	window: ProviderRequest["window"],
) {
	const root = record(JSON.parse(text));
	exactKeys(root, ["candidates"]);
	if (!Array.isArray(root["candidates"]) || root["candidates"].length > 64)
		throw new Error("WIRE_CANDIDATES_INVALID");
	return {
		candidates: root["candidates"].map((item) => {
			const c = record(item);
			exactKeys(c, [
				"subject",
				"predicate",
				"payload",
				Object.hasOwn(c, "quotes") ? "quotes" : "quote",
				"modality",
				"conditionJson",
				"validTimeJson",
			]);
			const plural = Object.hasOwn(c, "quotes");
			const rawQuotes = plural ? c["quotes"] : [c["quote"]];
			if (
				!Array.isArray(rawQuotes) ||
				rawQuotes.length === 0 ||
				rawQuotes.length > extractionLimits.maxQuotesPerCandidate
			)
				throw new Error("WIRE_QUOTES_INVALID");
			const quotes = rawQuotes.map((rawQuote) => {
				const q = record(rawQuote);
				exactKeys(q, ["utteranceId", "text", "occurrence"]);
				if (
					typeof q["text"] !== "string" ||
					!q["text"].length ||
					!Number.isSafeInteger(q["occurrence"]) ||
					(q["occurrence"] as number) < 0
				)
					throw new Error("WIRE_QUOTE_INVALID");
				const source = window.find((u) => u.utteranceId === q["utteranceId"]);
				if (!source) throw new Error("WIRE_QUOTE_SOURCE_MISSING");
				let at = -1;
				for (let i = 0; i <= (q["occurrence"] as number); i++) {
					at = source.text.indexOf(q["text"], at + 1);
					if (at < 0) throw new Error("WIRE_QUOTE_NOT_EXACT");
				}
				return {
					utteranceId: source.utteranceId,
					startByte: Buffer.byteLength(source.text.slice(0, at)),
					endByte: Buffer.byteLength(
						source.text.slice(0, at + q["text"].length),
					),
				};
			});
			if (
				typeof c["conditionJson"] !== "string" ||
				typeof c["validTimeJson"] !== "string"
			)
				throw new Error("WIRE_JSON_STRING_REQUIRED");
			const quoteFields: {
				quote?: (typeof quotes)[number];
				quotes?: typeof quotes;
			} = plural ? { quotes } : { quote: quotes[0]! };
			return {
				subject: c["subject"],
				predicate: c["predicate"],
				payload: c["payload"],
				modality: c["modality"],
				...quoteFields,
				...(c["conditionJson"] === ""
					? {}
					: { condition: JSON.parse(c["conditionJson"]) }),
				...(c["validTimeJson"] === ""
					? {}
					: { validTime: time(JSON.parse(c["validTimeJson"])) }),
			};
		}),
	};
}
