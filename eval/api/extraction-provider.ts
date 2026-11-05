import {
	API_EXTRACTION_VERSION,
	API_EXTRACTION_CONTRACT,
} from "./extraction-schema.ts";
import {
	EXTRACTION_INSTRUCTION,
	EXTRACTION_INSTRUCTION_VERSION,
} from "../extraction/providers.ts";
import type { ExtractionProvider } from "../extraction/runner.ts";
import { EvaluationApi, apiModels } from "./client.ts";
import { reviewedCompletion } from "./reviewed-completion.ts";
export function extractionProvider(
	api: Pick<EvaluationApi, "service" | "complete"> &
		Partial<Pick<EvaluationApi, "effort">>,
	maxOutput = 2048,
): ExtractionProvider {
	return {
		info: {
			kind: "remote",
			modelId: apiModels[api.service],
			modelVersion: apiModels[api.service],
			config: {
				instructionVersion: EXTRACTION_INSTRUCTION_VERSION,
				wireVersion: API_EXTRACTION_VERSION,
				api: api.service,
				reasoning: api.effort ?? "medium",
				generationPolicy: "fixed-draft-review-first-responses",
				nativeSchema: false,
			},
		},
		async extract(request, signal) {
			const { draft, final } = await reviewedCompletion(
				api,
				EXTRACTION_INSTRUCTION + "\n" + API_EXTRACTION_CONTRACT,
				JSON.stringify({
					window: request.window,
					entities: request.entities,
					predicates: request.predicates,
				}),
				signal,
				maxOutput,
			);
			return {
				output: final.text,
				usage: {
					inputTokens: draft.inputTokens + final.inputTokens,
					outputTokens: draft.outputTokens + final.outputTokens,
				},
			};
		},
	};
}
