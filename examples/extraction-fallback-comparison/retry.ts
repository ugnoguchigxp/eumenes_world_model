import {
	extractionInstructions,
	extractionSchema,
} from "../multi-source-comparison/protocol.ts";
import {
	extractionPrompt,
	interpret,
} from "../multi-source-comparison/world.ts";
import type { Packet } from "../multi-source-comparison/fixtures.ts";
import { recover } from "./recovery.ts";

export const retryInstructions = `${extractionInstructions}
The previous extraction could not be handed off; this is one bounded recovery attempt.
Interpret the ORIGINAL documents again, preserving all authority, scope and effective-time
qualifications. A document can report a proposal without establishing the proposal as fact.
Represent what a document says as an attributed source report (modality reported), including
when its content is tentative, hypothetical, a question or an unapproved proposal. Preserve
that status explicitly in the payload. Do not assert that a proposed event occurred or that
an unapproved rule has authority. A reported candidate is not adopted truth.
Express permission conditions only as stated in the source; preserve AND/OR/NOT and units.
Do not invent missing facts to satisfy validation. If no supported report can be extracted,
return no candidate for that document; the host will stop rather than retry repeatedly.`;

/** One attempt, no answer oracle, no host-side modality rewrite, no raw fallback. */
export async function retryExtraction(
	packet: Packet,
	raw: string,
	run: (prompt: string, schema: unknown) => Promise<{ raw: string }>,
) {
	const initial = recover(packet, raw);
	if (initial.mode === "world")
		return {
			material: initial.material,
			attempted: false,
			diagnostics: initial.diagnostics,
		};
	const response = await run(
		JSON.stringify({
			...JSON.parse(extractionPrompt(packet)),
			previousValidation: initial.diagnostics,
		}),
		extractionSchema,
	);
	return {
		material: interpret(packet, response.raw),
		attempted: true,
		diagnostics: initial.diagnostics,
	};
}
