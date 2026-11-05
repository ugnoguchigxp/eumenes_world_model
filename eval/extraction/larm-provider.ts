/** Registered host client, read-only settings. Never opens a product DB itself. */
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
	EXTRACTION_INSTRUCTION,
	EXTRACTION_INSTRUCTION_VERSION,
	HISTORY_INSTRUCTION,
	HISTORY_INSTRUCTION_VERSION,
} from "./providers.ts";
import type { ExtractionProvider } from "./runner.ts";

export interface RegisteredPort {
	connect(): Promise<void>;
	close(): Promise<void>;
	inspect?(): {
		profile: string;
		providers: { name: string; model: string; protocol: string }[];
	};
	answer(
		messages: { role: "system" | "user"; content: string }[],
		signal: AbortSignal,
		options: {
			sessionRole: "main";
			contextPolicy: "exact";
			reasoning: "low";
			jsonOutput: true;
			maxOutputTokens: number;
		},
	): Promise<string>;
}

/** The expected ID is an exact external contract, not inferred from a profile name. */
export async function providerFromRegisteredPort(
	port: RegisteredPort,
	expectedModel: string,
	modelVersion: string,
	purpose: "current" | "history" = "current",
): Promise<ExtractionProvider> {
	if (!expectedModel.trim() || !modelVersion.trim())
		throw new Error(
			"fixed model ID and operator-verified version are required",
		);
	try {
		await port.connect();
		const providers = port
			.inspect?.()
			?.providers.filter((entry) => entry.name === "llm");
		if (providers?.length !== 1 || providers[0]!.model !== expectedModel)
			throw new Error("registered model does not match expected model ID");
		const selected = providers[0]!;
		const instruction =
			purpose === "history" ? HISTORY_INSTRUCTION : EXTRACTION_INSTRUCTION;
		let closed = false;
		return {
			info: {
				kind: "local",
				modelId: selected.model,
				modelVersion,
				config: {
					instructionVersion:
						purpose === "history"
							? HISTORY_INSTRUCTION_VERSION
							: EXTRACTION_INSTRUCTION_VERSION,
					protocol: selected.protocol,
					versionProvenance: "operator-verified; not attested by harness",
					jsonOutput: true,
					maxOutputTokens: 4096,
					reasoning: "low",
					contextPolicy: "exact",
				},
			},
			async extract(request, signal) {
				if (closed) throw new Error("provider closed");
				const current = port
					.inspect?.()
					?.providers.filter((entry) => entry.name === "llm");
				if (
					current?.length !== 1 ||
					current[0]!.model !== selected.model ||
					current[0]!.protocol !== selected.protocol
				)
					throw new Error("registered model changed");
				const output = await port.answer(
					[
						{ role: "system", content: instruction },
						{
							role: "user",
							content: JSON.stringify({
								window: request.window,
								entities: request.entities,
								predicates: request.predicates,
							}),
						},
					],
					signal,
					{
						sessionRole: "main",
						contextPolicy: "exact",
						reasoning: "low",
						jsonOutput: true,
						maxOutputTokens: 4096,
					},
				);
				return { output }; // Verbatim; no quote repair or post-processing.
			},
			async close() {
				if (!closed) {
					closed = true;
					await port.close();
				}
			},
		};
	} catch (error) {
		await port.close();
		throw error;
	}
}

/** Loaded by the existing --provider-module CLI, without changing the host. */
export async function createProvider(): Promise<ExtractionProvider> {
	const expectedModel = process.env["EUMENES_EVAL_EXPECTED_MODEL"];
	const version = process.env["EUMENES_EVAL_MODEL_VERSION"];
	const purpose = process.env["EUMENES_EVAL_EXTRACTION_PURPOSE"] ?? "current";
	if (
		!expectedModel ||
		!version ||
		(purpose !== "current" && purpose !== "history")
	)
		throw new Error(
			"configure expected model, verified version and extraction purpose",
		);
	const root = resolve(
		process.env["EUMENES_EVAL_HOST_ROOT"] ??
			fileURLToPath(new URL("../../../eumenes", import.meta.url)),
	);
	const entry = join(root, "scripts/live-larm.ts");
	const { createLiveLarm } = await import(pathToFileURL(entry).href);
	const env = {
		...process.env,
		EUMENES_DB: join(root, "data/eumenes.sqlite3"),
	};
	const port: RegisteredPort = createLiveLarm(env, {
		keepAlive: false,
		fetch: (
			input: Parameters<typeof fetch>[0],
			init?: Parameters<typeof fetch>[1],
		) =>
			fetch(input, {
				...init,
				signal: AbortSignal.any([
					...(init?.signal ? [init.signal] : []),
					AbortSignal.timeout(60_000),
				]),
			}),
	});
	const provider = await providerFromRegisteredPort(
		port,
		expectedModel,
		version,
		purpose,
	);
	return {
		...provider,
		info: {
			...provider.info,
			config: {
				...provider.info.config,
				hostClientSha256: createHash("sha256")
					.update(readFileSync(entry))
					.digest("hex"),
			},
		},
	};
}
