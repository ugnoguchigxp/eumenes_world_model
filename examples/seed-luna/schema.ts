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
