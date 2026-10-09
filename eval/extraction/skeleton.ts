/**
 * Surface-form skeletons. Dev and holdout must not merely differ in the
 * entity, person, number or lead-in that a template is filled with: they must
 * use different sentence structures. A skeleton is the text with those slots
 * replaced by placeholders; two cases (or sentences) with the same skeleton are
 * the same template. Pure: no I/O, clock or randomness.
 */
import type { Dataset, Split } from "./dataset.ts";
import {
	devPrefixes,
	holdoutPrefixes,
	people,
	tanakaSurname,
	things,
	yamadaName,
} from "./vocabulary.ts";

/** Every lead-in any dataset version ever used (v1 used the dev list). */
const knownPrefixes = [...devPrefixes, ...holdoutPrefixes];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const honorific = "(?:さん|氏)?";

const thingPattern = new RegExp(
	[...things]
		.map((t) => escapeRegExp(t.name))
		.sort((a, b) => b.length - a.length)
		.join("|"),
	"g",
);
const personPattern = new RegExp(
	`(?:${people.map((p) => escapeRegExp(p.name)).join("|")})${honorific}`,
	"g",
);
const tanakaPattern = new RegExp(
	`${tanakaSurname}(?:太郎|花子)?${honorific}`,
	"g",
);
const yamadaPattern = new RegExp(`${yamadaName}${honorific}`, "g");

/** Strips the lead-in and replaces entities, people and numbers. */
export function normalizeText(text: string): string {
	let out = text;
	for (const prefix of knownPrefixes)
		if (out.startsWith(prefix)) {
			out = out.slice(prefix.length);
			break;
		}
	return out
		.replace(thingPattern, "<S>")
		.replace(tanakaPattern, "<T>")
		.replace(yamadaPattern, "<Y>")
		.replace(personPattern, "<P>")
		.replace(/[0-9]+/g, "#");
}

/** Sentences of an utterance (the terminator stays with the sentence). */
export const sentencesOf = (text: string): string[] =>
	text.split(/(?<=[。？])/).filter((s) => s.length > 0);

/** The case skeleton: its normalized utterances joined. */
export const caseSkeleton = (utterances: readonly { text: string }[]): string =>
	utterances.map((u) => normalizeText(u.text)).join("|");

export interface SplitSkeletons {
	/** Case-level skeletons. */
	readonly cases: ReadonlySet<string>;
	/** Sentence-level skeletons (each sentence, normalized on its own). */
	readonly sentences: ReadonlySet<string>;
}

export function skeletonsOf(dataset: Dataset, split: Split): SplitSkeletons {
	const cases = new Set<string>();
	const sentences = new Set<string>();
	for (const c of dataset.cases) {
		if (c.split !== split) continue;
		cases.add(caseSkeleton(c.utterances));
		for (const u of c.utterances)
			for (const sentence of sentencesOf(normalizeText(u.text)))
				sentences.add(sentence);
	}
	return { cases, sentences };
}

export interface SkeletonOverlap {
	/** Holdout case ids whose skeleton also exists in dev. */
	readonly sharedCaseIds: readonly string[];
	/** Normalized sentences present in both splits. */
	readonly sharedSentences: readonly string[];
}

/** What of the holdout is not independent of the dev split. */
export function skeletonOverlap(dataset: Dataset): SkeletonOverlap {
	const dev = skeletonsOf(dataset, "dev");
	const holdout = skeletonsOf(dataset, "holdout");
	return {
		sharedCaseIds: dataset.cases
			.filter(
				(c) =>
					c.split === "holdout" && dev.cases.has(caseSkeleton(c.utterances)),
			)
			.map((c) => c.caseId),
		sharedSentences: [...holdout.sentences]
			.filter((s) => dev.sentences.has(s))
			.sort(),
	};
}
