/** Replay retained first responses. This never inherits real-model authority. */
import { createHash } from "node:crypto";
import { DATASET_SHA256 } from "./dataset.ts";
import {
	ProviderTimeoutError,
	type DevSample,
	type ExtractionProvider,
} from "./runner.ts";

const digest = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");
const visible = (request: NonNullable<DevSample["request"]>) => ({
	window: request.window,
	entities: request.entities,
	predicates: request.predicates,
});
export function createDevReplay(text: string) {
	const [first, ...lines] = text
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	if (
		first?.schema !== "world-extraction-dev/1" ||
		first.datasetSha256 !== DATASET_SHA256
	)
		throw new Error("dev replay dataset/schema mismatch");
	const samples = lines as DevSample[];
	if (
		samples.length !== 100 ||
		samples.some((sample) => sample.request === null || sample.outputOmitted)
	)
		throw new Error("dev replay incomplete or output omitted");
	let index = 0;
	let mismatch = false;
	const provider: ExtractionProvider = {
		info: {
			kind: "fixture",
			modelId: `replay-${first.provider.modelId}`,
			modelVersion: first.provider.modelVersion,
			config: {
				promptVersion: first.promptVersion,
				sourceKind: first.provider.kind,
			},
		},
		async extract(request) {
			const sample = samples[index++];
			if (
				!sample?.request ||
				digest(visible(request)) !== digest(visible(sample.request))
			) {
				mismatch = true;
				throw new Error("dev replay request mismatch");
			}
			if (sample.status === "timeout") throw new ProviderTimeoutError();
			if (sample.status === "error") throw new Error("recorded provider error");
			return {
				output: sample.output,
				...(sample.usage == null ? {} : { usage: sample.usage }),
			};
		},
	};
	return {
		provider,
		consumed: () => index,
		expected: samples.length,
		assertComplete: () => {
			if (mismatch || index !== samples.length)
				throw new Error("dev replay request/coverage mismatch");
		},
	};
}
