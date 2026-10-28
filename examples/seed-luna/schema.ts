import { quotePointers } from "./quotes.ts";
const string = { type: "string" };
const object = (properties: Record<string, unknown>) => ({
	type: "object",
	properties,
	required: Object.keys(properties),
	additionalProperties: false,
});
const literal = (value: string) => ({ type: "string", enum: [value] });
const compare = object({
	kind: literal("compare"),
	key: string,
	op: { type: "string", enum: ["eq", "ne", "lt", "lte", "gt", "gte"] },
	value: { $ref: "#/$defs/value" },
});

/** Text anchoring is the sole adapter difference from the existing contract. */
export const outputSchema = {
	...object({
		candidates: {
			type: "array",
			items: object({
				subject: object({ kind: literal("id"), id: string }),
				predicate: literal("source_claim"),
				payload: object({
					kind: literal("value"),
					value: object({ kind: literal("string"), value: string }),
				}),
				quote: object({ utteranceId: string, pointer: string }),
				modality: {
					type: "string",
					enum: ["asserted", "reported", "negated", "hypothetical", "question"],
				},
				condition: {
					anyOf: [
						object({ kind: literal("unspecified") }),
						object({
							kind: literal("expression"),
							expression: { $ref: "#/$defs/condition" },
						}),
					],
				},
			}),
		},
	}),
	$defs: {
		value: {
			anyOf: [
				object({ kind: literal("string"), value: string }),
				object({
					kind: literal("number"),
					value: { type: "number" },
					unit: string,
				}),
				object({ kind: literal("boolean"), value: { type: "boolean" } }),
			],
		},
		condition: {
			anyOf: [
				compare,
				object({
					kind: { type: "string", enum: ["all", "any"] },
					items: { type: "array", items: { $ref: "#/$defs/condition" } },
				}),
				object({ kind: literal("not"), item: { $ref: "#/$defs/condition" } }),
				object({ kind: literal("unsupported") }),
			],
		},
	},
};

/** Bind host-issued identifiers and finite AST depth; meaning stays with the model. */
export function schemaForRequest(request: {
	readonly window: readonly {
		readonly utteranceId: string;
		readonly text: string;
	}[];
	readonly entities: readonly { readonly id: string }[];
	readonly observationKeys: readonly { readonly key: string }[];
}) {
	const schema = JSON.parse(JSON.stringify(outputSchema)) as Record<
		string,
		any
	>;
	const candidate = schema.properties.candidates.items;
	candidate.properties.subject.properties.id.enum = request.entities.map(
		(e) => e.id,
	);
	candidate.properties.quote.properties.utteranceId.enum = request.window.map(
		(w) => w.utteranceId,
	);
	candidate.properties.quote.properties.pointer.enum = [
		...new Set(request.window.flatMap((w) => quotePointers(w.text))),
	];
	if (request.observationKeys.length === 0) {
		candidate.properties.condition = object({ kind: literal("unspecified") });
		delete schema.$defs.condition;
	} else {
		schema.$defs.condition.anyOf[0].properties.key.enum =
			request.observationKeys.map((k) => k.key);
		// Existing condition contract permits depth <= 8. Define an acyclic
		// grammar instead of allowing recursive generation without an end.
		for (let depth = 1; depth <= 8; depth++) {
			const node = structuredClone(schema.$defs.condition);
			if (depth === 1) node.anyOf = [node.anyOf[0], node.anyOf[3]];
			const encoded = JSON.stringify(node).replaceAll(
				"#/$defs/condition",
				`#/$defs/condition${depth - 1}`,
			);
			schema.$defs[`condition${depth}`] = JSON.parse(encoded);
		}
		candidate.properties.condition.anyOf[1].properties.expression.$ref =
			"#/$defs/condition8";
		delete schema.$defs.condition;
	}
	return schema;
}
