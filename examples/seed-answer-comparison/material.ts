import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	asRecord,
	buildWorldSlice,
	evaluateConditions,
	type Entity,
} from "../../src/index.ts";
import { readWorldSnapshot, type WorldDb } from "../../src/sqlite.ts";
import {
	hash,
	seedScope,
	type SeedCorpus,
	type SeedDocument,
} from "../../eval/seed/corpus.ts";
import { cases } from "../seed-luna/cases.ts";
import { MODEL, PROMPT_VERSION } from "../seed-luna/luna.ts";
import { validateOutput } from "../seed-luna/pipeline.ts";
import type { Arm, Question } from "./protocol.ts";

export interface Material {
	readonly document: SeedDocument;
	readonly entity: Entity;
	readonly checked: ReturnType<typeof validateOutput>;
}

/** Reuses frozen REAL model responses; never hand-writes World claims. */
export async function loadMaterials(
	corpus: SeedCorpus,
	extractionRun: string,
	asOf: number,
) {
	const reportBytes = await readFile(resolve(extractionRun, "report.json"));
	const report = asRecord(JSON.parse(reportBytes.toString("utf8")));
	if (
		!report ||
		report["model"] !== MODEL ||
		report["promptVersion"] !== PROMPT_VERSION ||
		report["status"] !== "completed" ||
		report["seedId"] !== corpus.seedId ||
		report["manifestDigest"] !== corpus.manifestDigest
	)
		throw new Error("comparison_extraction_run_mismatch");
	const materials = new Map<string, Material>();
	const responseDigests: Record<string, string> = {};
	for (const entry of cases) {
		const document = corpus.documents.find(
			(item) => item.recordId === entry.recordId,
		);
		if (!document) throw new Error("comparison_source_missing");
		const bytes = await readFile(
			resolve(extractionRun, `${entry.recordId}-response.json`),
		);
		responseDigests[entry.recordId] = hash(bytes);
		const response = asRecord(JSON.parse(bytes.toString("utf8")));
		if (!response || typeof response["raw"] !== "string")
			throw new Error("comparison_missing_raw_output");
		const entity: Entity = {
			id: entry.entityId,
			scope: seedScope,
			revision: 1,
			displayName: entry.name,
			aliases: [],
			externalRefs: [],
		};
		const checked = validateOutput(
			document,
			entity,
			JSON.parse(response["raw"]),
			asOf,
		);
		if (
			checked.validation.status !== "validated" ||
			checked.assertions.length !== 1 ||
			checked.bindings.some((binding) => binding.status !== "bound")
		)
			throw new Error(`comparison_extraction_rejected:${entry.recordId}`);
		materials.set(entry.recordId, { document, entity, checked });
	}
	return {
		materials,
		extractionReportDigest: hash(reportBytes),
		responseDigests,
	};
}

export function contexts(
	db: WorldDb,
	question: Question,
	material: Material,
	asOf: number,
): Record<Arm, unknown> {
	const { document, entity, checked } = material;
	const view = readWorldSnapshot(db, {
		contractVersion: 1,
		scope: seedScope,
		asOf,
		access: {
			principal: seedScope.principal,
			scopeKeys: [seedScope.scopeKey],
			purpose: "world",
			policyRevision: "comparison-policy-v1",
		},
		hostChecks: {
			sourceSnapshot: { states: [checked.state] },
			forgetEpoch: "comparison-forget-v1",
			restoreEpoch: "comparison-restore-v1",
			policyRevision: "comparison-policy-v1",
		},
		focus: { subjectIds: [entity.id], depth: 0 },
	});
	if (view.status !== "ready")
		throw new Error(`comparison_snapshot:${view.reasonCode}`);
	const built = buildWorldSlice(
		{
			contractVersion: 1,
			snapshot: view.snapshot,
			request: { focusSubjectIds: [entity.id] },
		},
		hash,
	);
	if (
		!built.ok ||
		built.value.status !== "ready" ||
		!built.value.completeness.complete ||
		built.value.units.length !== 1
	)
		throw new Error("comparison_slice_not_complete");
	if (built.value.units.some((unit) => unit.status !== "candidate"))
		throw new Error("comparison_unexpected_adoption");
	const conditionEvaluation = built.value.units.map((unit) => {
		const evaluated = evaluateConditions({
			contractVersion: 1,
			asOf,
			authorized: true,
			maxAgeMs: 86_400_000,
			condition: unit.condition,
			observations: question.facts.map((fact, index) => ({
				observationId: `${question.id}-${index}`,
				key: fact.key,
				value: { kind: "number", value: fact.value, unit: fact.unit },
				observedAt: asOf,
				version: "v1",
				priority: 1,
			})),
		});
		if (!evaluated.ok) throw new Error("comparison_invalid_condition_probe");
		return { assertionId: unit.assertionId, ...evaluated.value };
	});
	const sources = [
		{ id: document.recordId, ref: document.source, text: document.content },
	];
	return {
		"no-seed": { sources: [], derivedView: null },
		"raw-seed": { sources, derivedView: null },
		"world-seed": {
			sources,
			derivedView: { slice: built.value, conditionEvaluation },
		},
	};
}

/** No rubric, task ID, arm name, or expected decision enters the answer prompt. */
export function answerPrompt(question: Question, context: unknown) {
	return JSON.stringify({
		referenceDate: "2026-10-16",
		question: question.question,
		scenarioFacts: question.facts,
		context,
	});
}
