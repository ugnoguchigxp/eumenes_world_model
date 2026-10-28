/**
 * E01: JacRED external-validity suite (adapter + deterministic selection).
 *
 * This is a separate suite from the frozen ext-ja-v2 / A46 evaluation: the
 * upstream Japanese documents are converted, never rewritten, and the
 * conversion rules below are the versioned schema mapping of the plan
 * (spec/plan/research-experiments.md, E01). Nothing here touches the World
 * relation kinds; gold relations stay Wikidata codes.
 *
 * Input representation: a sentence's text is its upstream tokens joined
 * with "" (the empty string). That joined text is a constructed input
 * representation defined by this adapter; it is NOT the raw upstream
 * document text and is never presented as such.
 */
import { createHash } from "node:crypto";

/** One entity mention in an upstream document (DocRED-style). */
export interface JacredMention {
	readonly type: string;
	readonly name: string;
	readonly sent_id: number;
	/** Token span [start, end) inside the sentence. */
	readonly pos: readonly [number, number];
}

/** One upstream relation label; `h`/`t` index into `vertexSet`. */
export interface JacredLabel {
	readonly h: number;
	readonly t: number;
	/** Wikidata relation code, or "Na" for no relation. */
	readonly r: string;
	readonly evidence: readonly number[];
}

/** One upstream JacRED document, as parsed from the split JSON files. */
export interface JacredDoc {
	readonly title: string;
	readonly sents: readonly (readonly string[])[];
	readonly vertexSet: readonly (readonly JacredMention[])[];
	readonly labels: readonly JacredLabel[];
}

export interface JacredEntity {
	/** "ent-<vertexIndex>" in the upstream document. */
	readonly id: string;
	/** Name of the mention with the lowest sent_id (tie: first mention). */
	readonly displayName: string;
	/** Remaining distinct mention names, in first-appearance order. */
	readonly aliases: readonly string[];
	/** Upstream entity type of the display-name mention. */
	readonly type: string;
}

export interface JacredGoldTriple {
	readonly subjectId: string;
	/** Wikidata relation code (never "Na"). */
	readonly relation: string;
	readonly objectId: string;
	/** "s<sentenceIndex>" of the single supporting sentence. */
	readonly evidenceUtteranceId: string;
}

/**
 * Gold material the current quote contract cannot represent. These counts
 * are reported per case; they are never dropped silently and never counted
 * as model failures.
 */
export interface JacredUnsupportedCounts {
	/** Labels (excluding "Na") whose evidence is not exactly one sentence. */
	readonly multiEvidence: number;
	/** Labels with r === "Na". */
	readonly naLabels: number;
	/** Representable labels dropped as exact (subject, relation, object)
	 * duplicates of an earlier kept triple. */
	readonly duplicateGold: number;
}

export interface JacredUtterance {
	/** "s<sentenceIndex>". */
	readonly utteranceId: string;
	/** Sentence tokens joined with "" (see module comment). */
	readonly text: string;
}

export interface JacredCase {
	/** "jacred-<split>-<upstreamIndex>"; stable within a suite build. */
	readonly caseId: string;
	readonly upstreamIndex: number;
	readonly title: string;
	readonly utterances: readonly JacredUtterance[];
	readonly entities: readonly JacredEntity[];
	readonly gold: readonly JacredGoldTriple[];
	readonly unsupported: JacredUnsupportedCounts;
}

export interface JacredPredicate {
	/** Wikidata relation code, e.g. "P131". */
	readonly code: string;
	/** English name from upstream rel_info ("" when absent). */
	readonly name: string;
}

export const JACRED_SUITE_ID = "jacred-ja-v1";

/** The measurement condition: entity candidates are given, not discovered. */
export const JACRED_CONDITION =
	"given-candidate relation extraction (entity candidates supplied)";

/** The input-text definition, recorded verbatim in suite metadata. */
export const JACRED_TEXT_JOIN_RULE =
	'sentence text = upstream tokens joined with "" (empty string); ' +
	"a constructed input representation, not the raw upstream document text";

export interface JacredSuite {
	readonly suiteId: typeof JACRED_SUITE_ID;
	readonly split: string;
	readonly condition: typeof JACRED_CONDITION;
	readonly textJoinRule: typeof JACRED_TEXT_JOIN_RULE;
	/** SHA-256 of the upstream split file the suite was built from. */
	readonly upstreamSha256: string;
	/** All rel2id codes except "Na", in upstream rel2id order. */
	readonly predicates: readonly JacredPredicate[];
	readonly cases: readonly JacredCase[];
}

export type JacredExclusionReason =
	| "tooManySentences"
	| "textTooLarge"
	| "tooManyEntities"
	| "noRepresentableRelation"
	| "beyondCap";

export interface JacredSelectionManifest {
	readonly split: string;
	readonly upstreamCount: number;
	/** Per-reason exclusion counts; selected + sum(excluded) = upstream. */
	readonly excluded: Readonly<Record<JacredExclusionReason, number>>;
	readonly selectedCount: number;
	/** Upstream indices of the selected documents, in selection order. */
	readonly selectedUpstreamIndices: readonly number[];
	readonly config: {
		readonly seed: string;
		readonly maxSentences: number;
		readonly maxTextBytes: number;
		readonly maxEntities: number;
		readonly cap: number;
	};
}

/**
 * Frozen selection configuration (E01). Changing any value is a new suite
 * version, not an edit of this one. Caps exist only for the splits the plan
 * budgets (dev 30, test 60); other splits are refused rather than silently
 * uncapped.
 */
export const JACRED_SELECTION_CONFIG = {
	seed: "jacred-e01-v1",
	maxSentences: 16,
	maxTextBytes: 6000,
	maxEntities: 24,
	caps: { dev: 30, test: 60 } as Readonly<Record<string, number>>,
} as const;

const encoder = new TextEncoder();
const sha256Hex = (text: string): string =>
	createHash("sha256").update(text).digest("hex");

function convertEntities(doc: JacredDoc): JacredEntity[] {
	return doc.vertexSet.map((mentions, vertexIndex) => {
		let display = 0;
		for (let i = 1; i < mentions.length; i++) {
			if (mentions[i]!.sent_id < mentions[display]!.sent_id) display = i;
		}
		const chosen = mentions[display]!;
		const aliases: string[] = [];
		for (let i = 0; i < mentions.length; i++) {
			if (i === display) continue;
			const name = mentions[i]!.name;
			if (name !== chosen.name && !aliases.includes(name)) aliases.push(name);
		}
		return {
			id: `ent-${vertexIndex}`,
			displayName: chosen.name,
			aliases,
			type: chosen.type,
		};
	});
}

interface Converted {
	readonly gold: readonly JacredGoldTriple[];
	readonly unsupported: JacredUnsupportedCounts;
}

function convertGold(doc: JacredDoc): Converted {
	const gold: JacredGoldTriple[] = [];
	const seen = new Set<string>();
	let multiEvidence = 0;
	let naLabels = 0;
	let duplicateGold = 0;
	for (const label of doc.labels) {
		if (label.r === "Na") {
			naLabels += 1;
			continue;
		}
		if (label.evidence.length !== 1) {
			multiEvidence += 1;
			continue;
		}
		const triple: JacredGoldTriple = {
			subjectId: `ent-${label.h}`,
			relation: label.r,
			objectId: `ent-${label.t}`,
			evidenceUtteranceId: `s${label.evidence[0]!}`,
		};
		const key = JSON.stringify([
			triple.subjectId,
			triple.relation,
			triple.objectId,
		]);
		if (seen.has(key)) {
			duplicateGold += 1;
			continue;
		}
		seen.add(key);
		gold.push(triple);
	}
	return { gold, unsupported: { multiEvidence, naLabels, duplicateGold } };
}

/** Converts one upstream document into a suite case (no selection applied). */
export function convertJacredCase(
	split: string,
	doc: JacredDoc,
	upstreamIndex: number,
): JacredCase {
	const { gold, unsupported } = convertGold(doc);
	return {
		caseId: `jacred-${split}-${upstreamIndex}`,
		upstreamIndex,
		title: doc.title,
		utterances: doc.sents.map((tokens, i) => ({
			utteranceId: `s${i}`,
			text: tokens.join(""),
		})),
		entities: convertEntities(doc),
		gold,
		unsupported,
	};
}

function totalJoinedBytes(doc: JacredDoc): number {
	let bytes = 0;
	for (const tokens of doc.sents)
		bytes += encoder.encode(tokens.join("")).length;
	return bytes;
}

function exclusionReason(doc: JacredDoc): JacredExclusionReason | undefined {
	if (doc.sents.length > JACRED_SELECTION_CONFIG.maxSentences)
		return "tooManySentences";
	if (totalJoinedBytes(doc) > JACRED_SELECTION_CONFIG.maxTextBytes)
		return "textTooLarge";
	if (doc.vertexSet.length > JACRED_SELECTION_CONFIG.maxEntities)
		return "tooManyEntities";
	if (convertGold(doc).gold.length === 0) return "noRepresentableRelation";
	return undefined;
}

/**
 * Builds the suite for one split: converts the selected documents and
 * returns the selection manifest alongside. Selection order is
 * sha256(`${seed}:${split}:${upstreamIndex}`) ascending; filters are
 * applied in the frozen order (sentences, bytes, entities, representable
 * gold), then the split cap.
 */
export function buildJacredSuite(
	split: string,
	docs: readonly JacredDoc[],
	rel2id: Readonly<Record<string, number>>,
	upstreamSha256: string,
	relInfo: Readonly<Record<string, string>> = {},
): { suite: JacredSuite; manifest: JacredSelectionManifest } {
	const cap = JACRED_SELECTION_CONFIG.caps[split];
	if (cap === undefined)
		throw new Error(
			`no frozen selection cap for split "${split}" (E01 budgets dev/test only)`,
		);
	const order = docs
		.map((_, upstreamIndex) => upstreamIndex)
		.sort((a, b) => {
			const ka = sha256Hex(`${JACRED_SELECTION_CONFIG.seed}:${split}:${a}`);
			const kb = sha256Hex(`${JACRED_SELECTION_CONFIG.seed}:${split}:${b}`);
			return ka < kb ? -1 : ka > kb ? 1 : a - b;
		});
	const excluded: Record<JacredExclusionReason, number> = {
		tooManySentences: 0,
		textTooLarge: 0,
		tooManyEntities: 0,
		noRepresentableRelation: 0,
		beyondCap: 0,
	};
	const cases: JacredCase[] = [];
	const selectedUpstreamIndices: number[] = [];
	for (const upstreamIndex of order) {
		const doc = docs[upstreamIndex]!;
		const reason = exclusionReason(doc);
		if (reason !== undefined) {
			excluded[reason] += 1;
			continue;
		}
		if (cases.length >= cap) {
			excluded.beyondCap += 1;
			continue;
		}
		cases.push(convertJacredCase(split, doc, upstreamIndex));
		selectedUpstreamIndices.push(upstreamIndex);
	}
	const predicates: JacredPredicate[] = Object.keys(rel2id)
		.filter((code) => code !== "Na")
		.map((code) => ({ code, name: relInfo[code] ?? "" }));
	const suite: JacredSuite = {
		suiteId: JACRED_SUITE_ID,
		split,
		condition: JACRED_CONDITION,
		textJoinRule: JACRED_TEXT_JOIN_RULE,
		upstreamSha256,
		predicates,
		cases,
	};
	const manifest: JacredSelectionManifest = {
		split,
		upstreamCount: docs.length,
		excluded,
		selectedCount: cases.length,
		selectedUpstreamIndices,
		config: {
			seed: JACRED_SELECTION_CONFIG.seed,
			maxSentences: JACRED_SELECTION_CONFIG.maxSentences,
			maxTextBytes: JACRED_SELECTION_CONFIG.maxTextBytes,
			maxEntities: JACRED_SELECTION_CONFIG.maxEntities,
			cap,
		},
	};
	return { suite, manifest };
}
