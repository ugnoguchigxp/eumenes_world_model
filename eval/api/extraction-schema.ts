/** Shared public-contract instruction. Native grammar exceeded Claude limits;
 * both services use identical unconstrained JSON + existing validation. */
import { relationKinds } from "../../src/index.ts";
export const API_EXTRACTION_VERSION = "api-extract-contract-3";
export const API_EXTRACTION_CONTRACT = [
	"Public output contract: payload.value is a typed object, never a bare string/number/boolean.",
	'{kind:"string",value:<string>}, {kind:"boolean",value:<boolean>}, {kind:"number",value:<number>,unit:<explicit unit>}, or {kind:"entity",entityId:<given id>}.',
	`A relation payload accepts ONLY these relation names: ${JSON.stringify(relationKinds)}. Do not put arbitrary predicates into payload.relation. Other properties use a typed value, including kind:entity when the property value is another entity.`,
	"The subject is the entity whose property is being asserted; a named entity that is the property's value belongs in the value. Preserve argument direction from the source.",
	'Optional condition is {kind:"unspecified"} or {kind:"expression",expression:<compare/all/any/not/unsupported AST>}. Missing/unspecified means unknown, never unconditional.',
	'AST nodes have EXACT keys: {kind:"compare",key:<observation key>,op:"eq|ne|lt|lte|gt|gte",value:<typed value>}, {kind:"all|any",items:[<nodes>]}, {kind:"not",item:<node>}, or {kind:"unsupported"}. Unsupported has NO text, description, or other fields. Unknown keys invalidate the candidate. Do not assign host adoption or authority.',
	'Keep explicitly stated conditional clauses and time qualifications. Optional validTime is {kind:"period",precision:"exact|day|month|year",original:<verbatim source expression>,start?:{earliest:<epoch ms>,latest:<epoch ms>},end?:{earliest:<epoch ms>,latest:<epoch ms>}} or {kind:"instant",at:<epoch ms>}. Preserve precision; omit bounds that cannot be determined from source, do not invent a year.',
	"Quotes use UTF-8 byte offsets, not character indexes. Preserve the original source text. Do not emit host-assigned authority or change the meaning of a candidate.",
].join("\n");
