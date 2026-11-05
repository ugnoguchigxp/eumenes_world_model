/** Frozen synthetic evaluation data. Gold is never part of extractor/reader input. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
	type AssertionDraft,
	type ConditionSpec,
	type ValidTime,
} from "../../src/index.ts";
import {
	checkConditionSpec,
	checkValidTime,
} from "../../src/domains/conditions/contracts/index.ts";
import type { PredicateDefinition } from "../api/grounded-extraction.ts";
export interface Fact {
	subjectId: string;
	predicate: string;
	payload: AssertionDraft["payload"];
	modality: string;
	sourceIds: string[];
	condition?: ConditionSpec;
	validTime?: ValidTime;
}
export interface QualityCase {
	id: string;
	group: string;
	purpose: "current" | "history";
	entities: { id: string; displayName: string; aliases: string[] }[];
	sources: { id: string; text: string }[];
	predicates: PredicateDefinition[];
	expected: Fact[];
	bindings: { key: string; meaning: string; type: string; unit?: string }[];
	holdModality?: string;
	eraseBeforeRead?: string[];
}
export interface Job extends QualityCase {
	split: "dev" | "evaluation";
	question: string;
	asOf: number;
	observations: {
		key: string;
		value: boolean | number | string;
		unit?: string;
	}[];
	answerFacts: Fact[];
	hold: boolean;
	requiredSources: string[];
}
export const fixtureDigests = {
	independent:
		"71baa2237c4880e2f1a54d2b6b1d378838a201a0ab22626a649a5b02ff65bda6",
	jobs: "814917afcfb6e8b10579d19e52e4e81751c76202c78ebf8c5efa16360931247b",
};
export function loadQuality<T extends QualityCase>(
	kind: keyof typeof fixtureDigests,
): T[] {
	const bytes = readFileSync(
		new URL(`../../fixtures/api-quality/${kind}.v1.json`, import.meta.url),
	);
	const hash = createHash("sha256").update(bytes).digest("hex");
	if (hash !== fixtureDigests[kind])
		throw new Error("QUALITY_FIXTURE_DIGEST_MISMATCH");
	const { cases } = JSON.parse(bytes.toString()) as { cases: T[] };
	if (
		cases.length !== (kind === "jobs" ? 40 : 60) ||
		new Set(cases.map((c) => c.id)).size !== cases.length
	)
		throw new Error("QUALITY_FIXTURE_COUNTS");
	for (const c of cases) {
		const ids = new Set(c.sources.map((s) => s.id));
		if (
			ids.size !== c.sources.length ||
			c.sources.length > 12 ||
			Buffer.byteLength(c.sources.map((s) => s.text).join("")) > 32000
		)
			throw new Error(`QUALITY_SOURCE_LIMIT:${c.id}`);
		for (const f of c.expected) {
			if (
				!c.entities.some((e) => e.id === f.subjectId) ||
				!c.predicates.some((p) => p.name === f.predicate) ||
				f.sourceIds.some((id) => !ids.has(id))
			)
				throw new Error(`QUALITY_GOLD_REFERENCE:${c.id}`);
			if (
				!checkConditionSpec(f.condition).ok ||
				(f.validTime && !checkValidTime(f.validTime).ok)
			)
				throw new Error(`QUALITY_GOLD_CONTRACT:${c.id}`);
		}
	}
	return cases;
}
