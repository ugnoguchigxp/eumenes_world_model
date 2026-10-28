/**
 * P4-05.a (N01): the entity supply contract of one evaluation case.
 *
 * A score alone cannot tell three very different failures apart: the gold
 * subject was never among the entities shown to the model (a supply
 * shortage, not a model error), the case is an intended hold because the
 * subject cannot be resolved from what was supplied (supplying more would
 * not change the task), and the subject was supplied yet the model still
 * failed. This module records, per case, exactly which entities were
 * supplied (with their dataset revisions) and classifies the case, so the
 * runner can count model-attributable failures over supplied cases only.
 *
 * Pure: built from the dataset alone. Gold is read here for the
 * classification; nothing from the gold reaches a model-facing request.
 */
import { createHash } from "node:crypto";
import {
	stableStringify,
	type Dataset,
	type DatasetEntity,
	type EntitySetName,
	type EvalCase,
	type SubjectQuery,
} from "./dataset.ts";
import {
	evaluationMatched,
	type CaseEvaluation,
	type SampleStatus,
} from "./scoring.ts";

/**
 * The model-visible request content, in the shape the runner builds it.
 * The supply digest is taken over exactly this content.
 */
export interface VisibleRequestContent {
	readonly window: readonly {
		readonly utteranceId: string;
		readonly text: string;
	}[];
	readonly entities: readonly {
		readonly id: string;
		readonly displayName: string;
		readonly aliases: readonly string[];
	}[];
	readonly predicates: readonly string[];
}

/** The visible content of one case, as the runner sends it. */
export function visibleRequestOf(
	dataset: Dataset,
	tc: EvalCase,
): VisibleRequestContent {
	return {
		window: tc.utterances.map((u) => ({
			utteranceId: u.utteranceId,
			text: u.text,
		})),
		entities: dataset.entitySets[tc.entitySet].map((e) => ({
			id: e.id,
			displayName: e.displayName,
			aliases: e.aliases,
		})),
		predicates: dataset.predicates,
	};
}

/** The entity supply of one case, recorded for verification (N01). */
export interface SupplyManifest {
	readonly datasetVersion: string;
	readonly entitySet: EntitySetName;
	/** Entities shown to the model, with their dataset revisions. */
	readonly supplied: readonly {
		readonly id: string;
		readonly revision: number;
	}[];
	readonly suppliedCount: number;
	/**
	 * Cap on the supplied entity count. This harness supplies the whole
	 * entity set, so the limit is null (no cap) and `truncated` is always
	 * false; the fields exist so that a capped host supply can be recorded
	 * as such instead of being mistaken for a full one.
	 */
	readonly limit: number | null;
	readonly truncated: boolean;
	readonly scope: {
		readonly principal: string;
		readonly scopeKey: string;
	};
	/** sha256 hex of the canonical JSON of the visible request content. */
	readonly requestDigest: string;
}

/** Builds the supply manifest of one case from the dataset. */
export function buildSupplyManifest(
	dataset: Dataset,
	tc: EvalCase,
): SupplyManifest {
	const entities = dataset.entitySets[tc.entitySet];
	return {
		datasetVersion: dataset.version,
		entitySet: tc.entitySet,
		supplied: entities.map((e) => ({ id: e.id, revision: e.revision })),
		suppliedCount: entities.length,
		limit: null,
		truncated: false,
		scope: {
			principal: dataset.scope.principal,
			scopeKey: dataset.scope.scopeKey,
		},
		requestDigest: createHash("sha256")
			.update(stableStringify(visibleRequestOf(dataset, tc)))
			.digest("hex"),
	};
}

export const supplyClasses = [
	"supplied",
	"gold_not_supplied",
	"intended_hold",
	"ambiguous_supply",
] as const;
export type SupplyClass = (typeof supplyClasses)[number];

/** Resolves a gold subject against the entities supplied for the case. */
function resolveSubject(
	supplied: readonly DatasetEntity[],
	subject: SubjectQuery,
): SupplyClass {
	if (subject.kind === "id")
		return supplied.some((e) => e.id === subject.id)
			? "supplied"
			: "gold_not_supplied";
	const matches = supplied.filter(
		(e) => e.displayName === subject.text || e.aliases.includes(subject.text),
	);
	if (matches.length === 1) return "supplied";
	return matches.length === 0 ? "gold_not_supplied" : "ambiguous_supply";
}

/**
 * Classifies the supply of one case:
 * - "intended_hold": the gold is a hold because the subject is unresolved
 *   or ambiguous; holding is the intended behaviour, never a model failure.
 * - "supplied": the gold subject resolves to exactly one supplied entity.
 * - "gold_not_supplied": the gold subject is not among the supplied
 *   entities at all: a supply shortage, not a model error.
 * - "ambiguous_supply": an alias subject matches more than one supplied
 *   entity, so the case cannot be attributed to the model either.
 *
 * Holds for other reasons (negation, hypothesis, question, forgotten) are
 * decided by classification, not by supply, so they are classified by
 * their reference subject like an adoption.
 */
export function classifySupply(dataset: Dataset, tc: EvalCase): SupplyClass {
	const supplied = dataset.entitySets[tc.entitySet];
	const gold = tc.gold;
	if (gold.outcome === "hold") {
		if (
			gold.reason === "unresolved_subject" ||
			gold.reason === "ambiguous_subject"
		)
			return "intended_hold";
		const first = gold.reference[0];
		return first
			? resolveSubject(supplied, first.candidate.subject)
			: "supplied";
	}
	return resolveSubject(supplied, gold.candidate.subject);
}

/** Per-run supply tallies (N01). */
export interface SupplySummary {
	/** Case counts per supply class; sums to the number of samples. */
	readonly counts: Readonly<Record<SupplyClass, number>>;
	/**
	 * Failures attributable to the model: samples over "supplied" cases
	 * whose status is not "ok" or whose evaluation does not match the gold.
	 * Failures in every other class are excluded: a supply shortage or an
	 * intended hold is not a model error.
	 */
	readonly modelAttributableFailures: number;
}

/** Tallies the supply classes and model-attributable failures of a run. */
export function summarizeSupply(
	samples: readonly {
		readonly supplyClass: SupplyClass;
		readonly status: SampleStatus;
		readonly evaluation: CaseEvaluation;
	}[],
): SupplySummary {
	const counts: Record<SupplyClass, number> = {
		supplied: 0,
		gold_not_supplied: 0,
		intended_hold: 0,
		ambiguous_supply: 0,
	};
	let failures = 0;
	for (const sample of samples) {
		counts[sample.supplyClass] += 1;
		if (
			sample.supplyClass === "supplied" &&
			(sample.status !== "ok" || !evaluationMatched(sample.evaluation))
		)
			failures += 1;
	}
	return { counts, modelAttributableFailures: failures };
}
