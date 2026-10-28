/**
 * E04: history vs Slice under one shared budget (additional suite).
 *
 * This module is an ADDITIONAL suite next to the four existing decision
 * conditions; it does not change the existing harness, runner or scoring.
 * The same question is answered from four inputs ("arms"):
 *
 * - h-full:   the raw history, every utterance, in episode order.
 * - h-budget: the raw history truncated to the suite budget, keeping the
 *   most recent utterances. The rule is fixed ex ante and never consults
 *   the question's gold.
 * - w-slice:  claims built from REAL extraction candidates (the loose
 *   JSON shape of the extraction eval) by deterministic selection and
 *   rendering only — supersede by quote recency, hold modalities out,
 *   question-mention tiering, then the same budget. No LLM, no embedding.
 * - w-oracle: the question's hand-written oracle claims. Diagnostic only:
 *   it separates "retrieval/extraction fell short" from "the reader fell
 *   short" and must never be mixed into product gates or official scores.
 *   It is not LongMemEval's official condition set.
 *
 * The budget is the harness's deterministic estimate (estimateTokens from
 * context.ts), shared by every arm. It is an estimate, not the reader's
 * tokenizer; results must not be reported as "same tokens" beyond that.
 *
 * Everything here is pure: no model, no clock, no network, no filesystem.
 * The suite data arrives as JSON and is validated by loadE04Suite.
 */
import { estimateTokens } from "./context.ts";

export const E04_SUITE_ID = "e04-ja-v1";

export const e04Categories = [
	"update",
	"temporal",
	"rejection",
	"multi-session",
] as const;
export type E04Category = (typeof e04Categories)[number];

export const e04Arms = ["h-full", "h-budget", "w-slice", "w-oracle"] as const;
export type E04Arm = (typeof e04Arms)[number];

export interface E04Entity {
	readonly id: string;
	readonly displayName: string;
	readonly aliases: readonly string[];
}

export interface E04Utterance {
	readonly id: string;
	readonly speaker: string;
	readonly text: string;
}

export interface E04Session {
	readonly id: string;
	readonly date: string;
	readonly utterances: readonly E04Utterance[];
}

export interface E04Episode {
	readonly id: string;
	readonly title: string;
	readonly entities: readonly E04Entity[];
	readonly sessions: readonly E04Session[];
}

export interface E04Gold {
	/** Each group needs at least one alternative substring in the answer. */
	readonly requiredGroups: readonly (readonly string[])[];
	/** Substrings that must not appear in the answer (stale/forbidden facts). */
	readonly forbidden: readonly string[];
	readonly holdExpected: boolean;
	/** Utterances the gold answer rests on (for evidence recall). */
	readonly evidenceUtteranceIds: readonly string[];
}

export interface E04OracleClaim {
	readonly text: string;
	readonly evidenceUtteranceId: string;
}

export interface E04Question {
	readonly id: string;
	readonly episodeId: string;
	readonly category: E04Category;
	readonly question: string;
	readonly gold: E04Gold;
	readonly oracleClaims: readonly E04OracleClaim[];
}

export interface E04Suite {
	readonly suiteId: string;
	/** Common context budget in estimateTokens units; question excluded. */
	readonly budgetTokens: number;
	readonly episodes: readonly E04Episode[];
	readonly questions: readonly E04Question[];
}

export class E04SuiteError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "E04SuiteError";
	}
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

function fail(path: string, problem: string): never {
	throw new E04SuiteError(`e04 suite: ${path} ${problem}`);
}

function reqString(
	record: Record<string, unknown>,
	key: string,
	path: string,
): string {
	const value = record[key];
	if (typeof value !== "string" || value === "") {
		fail(`${path}.${key}`, "must be a non-empty string");
	}
	return value as string;
}

function reqStringArray(value: unknown, path: string): readonly string[] {
	if (!Array.isArray(value)) fail(path, "must be an array of strings");
	return (value as unknown[]).map((entry, i) => {
		if (typeof entry !== "string" || entry === "") {
			fail(`${path}[${i}]`, "must be a non-empty string");
		}
		return entry as string;
	});
}

function optStringArray(
	record: Record<string, unknown>,
	key: string,
	path: string,
): readonly string[] {
	const value = record[key];
	if (value === undefined) return [];
	return reqStringArray(value, `${path}.${key}`);
}

function parseEntity(raw: unknown, path: string): E04Entity {
	if (!isRecord(raw)) fail(path, "must be an object");
	return {
		id: reqString(raw, "id", path),
		displayName: reqString(raw, "displayName", path),
		aliases: optStringArray(raw, "aliases", path),
	};
}

function parseEpisode(raw: unknown, path: string): E04Episode {
	if (!isRecord(raw)) fail(path, "must be an object");
	const entitiesRaw = raw["entities"];
	if (!Array.isArray(entitiesRaw)) fail(`${path}.entities`, "must be an array");
	const sessionsRaw = raw["sessions"];
	if (!Array.isArray(sessionsRaw)) fail(`${path}.sessions`, "must be an array");
	const sessions = (sessionsRaw as unknown[]).map((s, si) => {
		const sp = `${path}.sessions[${si}]`;
		if (!isRecord(s)) fail(sp, "must be an object");
		const utterancesRaw = s["utterances"];
		if (!Array.isArray(utterancesRaw)) {
			fail(`${sp}.utterances`, "must be an array");
		}
		const utterances = (utterancesRaw as unknown[]).map((u, ui) => {
			const up = `${sp}.utterances[${ui}]`;
			if (!isRecord(u)) fail(up, "must be an object");
			return {
				id: reqString(u, "id", up),
				speaker: reqString(u, "speaker", up),
				text: reqString(u, "text", up),
			};
		});
		return {
			id: reqString(s, "id", sp),
			date: reqString(s, "date", sp),
			utterances,
		};
	});
	return {
		id: reqString(raw, "id", path),
		title: reqString(raw, "title", path),
		entities: (entitiesRaw as unknown[]).map((e, ei) =>
			parseEntity(e, `${path}.entities[${ei}]`),
		),
		sessions,
	};
}

function parseQuestion(
	raw: unknown,
	path: string,
	episodesById: ReadonlyMap<string, E04Episode>,
	utteranceIdsOf: (episode: E04Episode) => ReadonlySet<string>,
): E04Question {
	if (!isRecord(raw)) fail(path, "must be an object");
	const id = reqString(raw, "id", path);
	const episodeId = reqString(raw, "episodeId", path);
	const episode = episodesById.get(episodeId);
	if (episode === undefined) {
		fail(`${path}.episodeId`, `refers to unknown episode "${episodeId}"`);
	}
	const category = raw["category"];
	if (
		typeof category !== "string" ||
		!(e04Categories as readonly string[]).includes(category)
	) {
		fail(`${path}.category`, `must be one of ${e04Categories.join(", ")}`);
	}
	const goldRaw = raw["gold"];
	if (!isRecord(goldRaw)) fail(`${path}.gold`, "must be an object");
	const groupsRaw = goldRaw["requiredGroups"];
	if (!Array.isArray(groupsRaw)) {
		fail(`${path}.gold.requiredGroups`, "must be an array of string arrays");
	}
	const requiredGroups = (groupsRaw as unknown[]).map((g, gi) =>
		reqStringArray(g, `${path}.gold.requiredGroups[${gi}]`),
	);
	for (const [gi, group] of requiredGroups.entries()) {
		if (group.length === 0) {
			fail(
				`${path}.gold.requiredGroups[${gi}]`,
				"must name at least one alternative",
			);
		}
	}
	const holdExpected = goldRaw["holdExpected"];
	if (typeof holdExpected !== "boolean") {
		fail(`${path}.gold.holdExpected`, "must be a boolean");
	}
	const known = utteranceIdsOf(episode);
	const evidenceUtteranceIds = reqStringArray(
		goldRaw["evidenceUtteranceIds"],
		`${path}.gold.evidenceUtteranceIds`,
	);
	for (const uid of evidenceUtteranceIds) {
		if (!known.has(uid)) {
			fail(
				`${path}.gold.evidenceUtteranceIds`,
				`refers to unknown utterance "${uid}" of episode "${episodeId}"`,
			);
		}
	}
	const oracleRaw = raw["oracleClaims"];
	if (!Array.isArray(oracleRaw)) {
		fail(`${path}.oracleClaims`, "must be an array");
	}
	const oracleClaims = (oracleRaw as unknown[]).map((o, oi) => {
		const op = `${path}.oracleClaims[${oi}]`;
		if (!isRecord(o)) fail(op, "must be an object");
		const claim = {
			text: reqString(o, "text", op),
			evidenceUtteranceId: reqString(o, "evidenceUtteranceId", op),
		};
		if (!known.has(claim.evidenceUtteranceId)) {
			fail(
				`${op}.evidenceUtteranceId`,
				`refers to unknown utterance "${claim.evidenceUtteranceId}" of episode "${episodeId}"`,
			);
		}
		return claim;
	});
	return {
		id,
		episodeId,
		category: category as E04Category,
		question: reqString(raw, "question", path),
		gold: {
			requiredGroups,
			forbidden: reqStringArray(goldRaw["forbidden"], `${path}.gold.forbidden`),
			holdExpected,
			evidenceUtteranceIds,
		},
		oracleClaims,
	};
}

/**
 * Strictly validates suite JSON: structure, id uniqueness, valid
 * categories, and every cross-reference (question -> episode, gold and
 * oracle evidence -> utterances of that episode). Throws E04SuiteError.
 */
export function loadE04Suite(json: unknown): E04Suite {
	if (!isRecord(json)) fail("(root)", "must be an object");
	const suiteId = reqString(json, "suiteId", "(root)");
	const budgetTokens = json["budgetTokens"];
	if (
		typeof budgetTokens !== "number" ||
		!Number.isFinite(budgetTokens) ||
		budgetTokens <= 0
	) {
		fail("(root).budgetTokens", "must be a positive number");
	}
	const episodesRaw = json["episodes"];
	if (!Array.isArray(episodesRaw)) fail("(root).episodes", "must be an array");
	const episodes = (episodesRaw as unknown[]).map((e, ei) =>
		parseEpisode(e, `episodes[${ei}]`),
	);
	const episodesById = new Map<string, E04Episode>();
	for (const episode of episodes) {
		if (episodesById.has(episode.id)) {
			fail("episodes", `duplicate episode id "${episode.id}"`);
		}
		episodesById.set(episode.id, episode);
		const utteranceIds = new Set<string>();
		for (const session of episode.sessions) {
			for (const utterance of session.utterances) {
				if (utteranceIds.has(utterance.id)) {
					fail(
						`episode "${episode.id}"`,
						`duplicate utterance id "${utterance.id}"`,
					);
				}
				utteranceIds.add(utterance.id);
			}
		}
	}
	const utteranceIdsOf = (episode: E04Episode): ReadonlySet<string> =>
		new Set(episode.sessions.flatMap((s) => s.utterances.map((u) => u.id)));
	const questionsRaw = json["questions"];
	if (!Array.isArray(questionsRaw)) {
		fail("(root).questions", "must be an array");
	}
	const questions = (questionsRaw as unknown[]).map((q, qi) =>
		parseQuestion(q, `questions[${qi}]`, episodesById, utteranceIdsOf),
	);
	const questionIds = new Set<string>();
	for (const question of questions) {
		if (questionIds.has(question.id)) {
			fail("questions", `duplicate question id "${question.id}"`);
		}
		questionIds.add(question.id);
	}
	return { suiteId, budgetTokens, episodes, questions };
}

/** One rendered history line plus the utterance it came from. */
interface HistoryLine {
	readonly utteranceId: string;
	readonly line: string;
}

function historyLines(episode: E04Episode): HistoryLine[] {
	const lines: HistoryLine[] = [];
	for (const session of episode.sessions) {
		for (const utterance of session.utterances) {
			lines.push({
				utteranceId: utterance.id,
				line: `[${utterance.id}] (${session.date} ${utterance.speaker}) ${utterance.text}`,
			});
		}
	}
	return lines;
}

export interface E04HistoryRender {
	readonly text: string;
	readonly utteranceIds: readonly string[];
}

/** H-full arm: every utterance, in episode order, one line each. */
export function renderHistory(episode: E04Episode): E04HistoryRender {
	const lines = historyLines(episode);
	return {
		text: lines.map((l) => l.line).join("\n"),
		utteranceIds: lines.map((l) => l.utteranceId),
	};
}

export interface E04TruncatedHistory {
	readonly text: string;
	readonly keptIds: readonly string[];
	readonly droppedIds: readonly string[];
}

/**
 * H-budget arm: keep the most recent utterances whose rendered lines fit
 * the budget, walking from the newest backwards and stopping at the first
 * line that no longer fits (the rule is fixed ex ante and gold-free, the
 * same stop rule as the existing harness's applyBudget). Kept lines are
 * rendered in chronological order.
 */
export function truncateHistory(
	episode: E04Episode,
	budgetTokens: number,
): E04TruncatedHistory {
	const lines = historyLines(episode);
	let used = 0;
	const kept = new Set<string>();
	for (let i = lines.length - 1; i >= 0; i--) {
		const entry = lines[i] as HistoryLine;
		const cost = estimateTokens(entry.line);
		if (used + cost > budgetTokens) break;
		used += cost;
		kept.add(entry.utteranceId);
	}
	return {
		text: lines
			.filter((l) => kept.has(l.utteranceId))
			.map((l) => l.line)
			.join("\n"),
		keptIds: lines
			.filter((l) => kept.has(l.utteranceId))
			.map((l) => l.utteranceId),
		droppedIds: lines
			.filter((l) => !kept.has(l.utteranceId))
			.map((l) => l.utteranceId),
	};
}

/** A reference to an entity in an extraction candidate. */
export type E04Ref =
	| { readonly kind: "id"; readonly id: string }
	| { readonly kind: "alias"; readonly text: string };

export type E04TypedValue =
	| { readonly kind: "string"; readonly value: string; readonly unit?: string }
	| {
			readonly kind: "boolean";
			readonly value: boolean;
			readonly unit?: string;
	  }
	| { readonly kind: "number"; readonly value: number; readonly unit?: string }
	| { readonly kind: "entity"; readonly entityId: string };

export type E04CandidatePayload =
	| { readonly kind: "value"; readonly value: E04TypedValue }
	| {
			readonly kind: "relation";
			readonly relation: string;
			readonly object: E04Ref;
	  };

export interface E04ExtractionCandidate {
	readonly subject: E04Ref;
	readonly predicate: string;
	readonly payload: E04CandidatePayload;
	readonly quote: {
		readonly utteranceId: string;
		readonly startByte: number;
		readonly endByte: number;
	};
	readonly modality: string;
	readonly condition?: unknown;
	readonly validTime?: unknown;
}

function parseRef(raw: unknown): E04Ref | null {
	if (!isRecord(raw)) return null;
	if (raw["kind"] === "id") {
		const id = raw["id"];
		return typeof id === "string" && id !== "" ? { kind: "id", id } : null;
	}
	if (raw["kind"] === "alias") {
		const text = raw["text"];
		return typeof text === "string" && text !== ""
			? { kind: "alias", text }
			: null;
	}
	return null;
}

function parseTypedValue(raw: unknown): E04TypedValue | null {
	if (!isRecord(raw)) return null;
	const unit =
		typeof raw["unit"] === "string" ? (raw["unit"] as string) : undefined;
	switch (raw["kind"]) {
		case "string": {
			const value = raw["value"];
			return typeof value === "string"
				? { kind: "string", value, ...(unit !== undefined ? { unit } : {}) }
				: null;
		}
		case "boolean": {
			const value = raw["value"];
			return typeof value === "boolean"
				? { kind: "boolean", value, ...(unit !== undefined ? { unit } : {}) }
				: null;
		}
		case "number": {
			const value = raw["value"];
			return typeof value === "number" && Number.isFinite(value)
				? { kind: "number", value, ...(unit !== undefined ? { unit } : {}) }
				: null;
		}
		case "entity": {
			const ref = raw["entityId"] ?? raw["id"];
			return typeof ref === "string" && ref !== ""
				? { kind: "entity", entityId: ref }
				: null;
		}
		default:
			return null;
	}
}

function parsePayload(raw: unknown): E04CandidatePayload | null {
	if (!isRecord(raw)) return null;
	if (raw["kind"] === "value") {
		const value = parseTypedValue(raw["value"]);
		return value !== null ? { kind: "value", value } : null;
	}
	if (raw["kind"] === "relation") {
		const relation = raw["relation"];
		const object = parseRef(raw["object"]);
		return typeof relation === "string" && relation !== "" && object !== null
			? { kind: "relation", relation, object }
			: null;
	}
	return null;
}

function parseCandidate(raw: unknown): E04ExtractionCandidate | null {
	if (!isRecord(raw)) return null;
	const subject = parseRef(raw["subject"]);
	const predicate = raw["predicate"];
	const payload = parsePayload(raw["payload"]);
	const quoteRaw = raw["quote"];
	const modality = raw["modality"];
	if (
		subject === null ||
		typeof predicate !== "string" ||
		predicate === "" ||
		payload === null ||
		!isRecord(quoteRaw) ||
		typeof modality !== "string" ||
		modality === ""
	) {
		return null;
	}
	const utteranceId = quoteRaw["utteranceId"];
	const startByte = quoteRaw["startByte"];
	const endByte = quoteRaw["endByte"];
	if (
		typeof utteranceId !== "string" ||
		utteranceId === "" ||
		typeof startByte !== "number" ||
		typeof endByte !== "number" ||
		!Number.isInteger(startByte) ||
		!Number.isInteger(endByte) ||
		startByte < 0 ||
		endByte < startByte
	) {
		return null;
	}
	return {
		subject,
		predicate,
		payload,
		quote: { utteranceId, startByte, endByte },
		modality,
		...("condition" in raw ? { condition: raw["condition"] } : {}),
		...("validTime" in raw ? { validTime: raw["validTime"] } : {}),
	};
}

export interface E04ParsedCandidates {
	readonly candidates: readonly E04ExtractionCandidate[];
	/** Entries that were malformed and skipped (never thrown on). */
	readonly skipped: number;
}

/**
 * Tolerant reader for extraction-eval output: accepts a bare array or an
 * object with a `candidates` array. Malformed entries are skipped and
 * counted; this never throws on candidate-level problems.
 */
export function parseExtractionCandidates(raw: unknown): E04ParsedCandidates {
	const list: readonly unknown[] = Array.isArray(raw)
		? raw
		: isRecord(raw) && Array.isArray(raw["candidates"])
			? (raw["candidates"] as unknown[])
			: [];
	const candidates: E04ExtractionCandidate[] = [];
	let skipped = 0;
	for (const entry of list) {
		const parsed = parseCandidate(entry);
		if (parsed !== null) candidates.push(parsed);
		else skipped++;
	}
	return { candidates, skipped };
}

/** Modalities that never enter the Slice as asserted state. */
const HOLD_MODALITIES: ReadonlySet<string> = new Set([
	"negated",
	"hypothetical",
	"question",
]);

interface ResolvedClaim {
	readonly subjectId: string;
	readonly subjectName: string;
	readonly predicate: string;
	/** Rendered value (typed value or entity display name). */
	readonly valueText: string;
	/** Entity names checked against the question for tiering. */
	readonly names: readonly string[];
	readonly quoteUtteranceId: string;
	/** Position in episode utterance order; -1 when the quote is unknown. */
	readonly recency: number;
	readonly inputIndex: number;
	readonly line: string;
}

function sliceQuoteText(
	utteranceText: string,
	startByte: number,
	endByte: number,
): string {
	const bytes = new TextEncoder().encode(utteranceText);
	if (endByte > bytes.length) return utteranceText;
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(
			bytes.subarray(startByte, endByte),
		);
	} catch {
		return utteranceText;
	}
}

export interface E04SliceResult {
	readonly text: string;
	readonly claimIds: readonly string[];
	/** Distinct quote utterance ids of included claims, in inclusion order. */
	readonly includedEvidenceIds: readonly string[];
	/** Claims cut by the budget (after supersede and hold filtering). */
	readonly droppedClaims: number;
	readonly supersededCount: number;
	readonly heldOutCount: number;
	readonly partial: boolean;
}

/**
 * W-slice arm: build the Slice from real extraction candidates by
 * deterministic selection and rendering only.
 *
 * Subject/object references resolve to episode entities by id, or by
 * display name / alias text for alias references. Hold modalities are
 * excluded, then candidates are grouped by (subject, predicate) and only
 * the one quoting the latest utterance survives. Survivors are ordered by
 * question mention (tier 1: subject or object name/alias appears in the
 * question text) and then by utterance recency, and rendered until the
 * next line would exceed the budget.
 */
export function buildSlice(
	episode: E04Episode,
	candidates: readonly E04ExtractionCandidate[],
	question: E04Question,
	budgetTokens: number,
): E04SliceResult {
	const entityById = new Map(episode.entities.map((e) => [e.id, e]));
	const entityByName = new Map<string, E04Entity>();
	for (const entity of episode.entities) {
		entityByName.set(entity.displayName, entity);
		for (const alias of entity.aliases) entityByName.set(alias, entity);
	}
	const resolveRef = (ref: E04Ref): E04Entity | undefined =>
		ref.kind === "id" ? entityById.get(ref.id) : entityByName.get(ref.text);
	const refFallback = (ref: E04Ref): string =>
		ref.kind === "id" ? ref.id : ref.text;

	const utteranceOrder = new Map<string, number>();
	const utteranceText = new Map<string, string>();
	{
		let index = 0;
		for (const session of episode.sessions) {
			for (const utterance of session.utterances) {
				utteranceOrder.set(utterance.id, index++);
				utteranceText.set(utterance.id, utterance.text);
			}
		}
	}

	let heldOutCount = 0;
	const resolved: ResolvedClaim[] = [];
	candidates.forEach((candidate, inputIndex) => {
		if (HOLD_MODALITIES.has(candidate.modality)) {
			heldOutCount++;
			return;
		}
		const subjectEntity = resolveRef(candidate.subject);
		const subjectId = subjectEntity?.id ?? refFallback(candidate.subject);
		const subjectName = subjectEntity?.displayName ?? subjectId;
		const names: string[] = [subjectName, ...(subjectEntity?.aliases ?? [])];
		let valueText: string;
		if (candidate.payload.kind === "relation") {
			const objectEntity = resolveRef(candidate.payload.object);
			const objectName =
				objectEntity?.displayName ?? refFallback(candidate.payload.object);
			valueText = objectName;
			names.push(objectName, ...(objectEntity?.aliases ?? []));
		} else if (candidate.payload.value.kind === "entity") {
			const target = entityById.get(candidate.payload.value.entityId);
			valueText = target?.displayName ?? candidate.payload.value.entityId;
			names.push(valueText, ...(target?.aliases ?? []));
		} else {
			const v = candidate.payload.value;
			valueText = `${String(v.value)}${v.unit ?? ""}`;
		}
		const quoteId = candidate.quote.utteranceId;
		const fullText = utteranceText.get(quoteId);
		const quoteText =
			fullText === undefined
				? ""
				: sliceQuoteText(
						fullText,
						candidate.quote.startByte,
						candidate.quote.endByte,
					);
		resolved.push({
			subjectId,
			subjectName,
			predicate: candidate.predicate,
			valueText,
			names,
			quoteUtteranceId: quoteId,
			recency: utteranceOrder.get(quoteId) ?? -1,
			inputIndex,
			line: `${subjectName} ${candidate.predicate} ${valueText} (根拠: ${quoteId}「${quoteText}」)`,
		});
	});

	// Supersede: within a (subject, predicate) group only the candidate
	// quoting the latest utterance survives; ties go to the later input.
	const groups = new Map<string, ResolvedClaim[]>();
	for (const claim of resolved) {
		const key = `${claim.subjectId} ${claim.predicate}`;
		const group = groups.get(key);
		if (group !== undefined) group.push(claim);
		else groups.set(key, [claim]);
	}
	let supersededCount = 0;
	const survivors: ResolvedClaim[] = [];
	for (const group of groups.values()) {
		let winner = group[0] as ResolvedClaim;
		for (const claim of group) {
			if (
				claim.recency > winner.recency ||
				(claim.recency === winner.recency &&
					claim.inputIndex > winner.inputIndex)
			) {
				winner = claim;
			}
		}
		supersededCount += group.length - 1;
		survivors.push(winner);
	}

	const tierOf = (claim: ResolvedClaim): number =>
		claim.names.some((name) => name !== "" && question.question.includes(name))
			? 1
			: 2;
	const ordered = [...survivors].sort((a, b) => {
		const tier = tierOf(a) - tierOf(b);
		if (tier !== 0) return tier;
		if (a.recency !== b.recency) return b.recency - a.recency;
		return b.inputIndex - a.inputIndex;
	});

	let used = 0;
	let full = false;
	const lines: string[] = [];
	const claimIds: string[] = [];
	const includedEvidenceIds: string[] = [];
	let droppedClaims = 0;
	for (const claim of ordered) {
		const rendered = `[c${claimIds.length + 1}] ${claim.line}`;
		const cost = estimateTokens(rendered);
		if (!full && used + cost <= budgetTokens) {
			used += cost;
			lines.push(rendered);
			claimIds.push(`c${claimIds.length + 1}`);
			if (!includedEvidenceIds.includes(claim.quoteUtteranceId)) {
				includedEvidenceIds.push(claim.quoteUtteranceId);
			}
		} else {
			full = true;
			droppedClaims++;
		}
	}
	return {
		text: lines.join("\n"),
		claimIds,
		includedEvidenceIds,
		droppedClaims,
		supersededCount,
		heldOutCount,
		partial: droppedClaims > 0,
	};
}

export interface E04OracleResult {
	readonly text: string;
	readonly claimIds: readonly string[];
	readonly includedEvidenceIds: readonly string[];
	readonly partial: boolean;
}

/**
 * W-oracle arm (diagnostic only): render the question's oracle claims
 * under the same budget rule as the Slice.
 */
export function buildOracleContext(
	question: E04Question,
	episode: E04Episode,
	budgetTokens: number,
): E04OracleResult {
	void episode; // Oracle claims are self-contained; the episode fixes ids.
	let used = 0;
	let full = false;
	const lines: string[] = [];
	const claimIds: string[] = [];
	const includedEvidenceIds: string[] = [];
	for (const claim of question.oracleClaims) {
		const rendered = `[c${claimIds.length + 1}] ${claim.text} (根拠: ${claim.evidenceUtteranceId})`;
		const cost = estimateTokens(rendered);
		if (!full && used + cost <= budgetTokens) {
			used += cost;
			lines.push(rendered);
			claimIds.push(`c${claimIds.length + 1}`);
			if (!includedEvidenceIds.includes(claim.evidenceUtteranceId)) {
				includedEvidenceIds.push(claim.evidenceUtteranceId);
			}
		} else {
			full = true;
		}
	}
	return {
		text: lines.join("\n"),
		claimIds,
		includedEvidenceIds,
		partial: claimIds.length < question.oracleClaims.length,
	};
}

export interface E04AnswerOutput {
	readonly answer: string;
	readonly hold: boolean;
	readonly citations: readonly string[];
}

export interface E04AnswerScore {
	readonly correct: boolean;
	/** A forbidden (stale/superseded) substring appears in the answer. */
	readonly contamination: boolean;
	readonly holdCorrect: boolean;
	/** Every citation names an id that was in the presented context. */
	readonly citationValid: boolean;
	readonly reasons: readonly string[];
}

/**
 * Score one answer against the question's gold. `contextIds` is the set
 * of ids the arm actually presented (utterance ids for history arms,
 * claim ids for Slice/oracle arms). Phrase matching follows the existing
 * harness convention (plain substring, as in the rubric scorer).
 */
export function scoreE04Answer(
	question: E04Question,
	output: E04AnswerOutput,
	contextIds: ReadonlySet<string>,
): E04AnswerScore {
	const gold = question.gold;
	const reasons: string[] = [];
	const holdCorrect = output.hold === gold.holdExpected;
	let correct: boolean;
	if (gold.holdExpected) {
		correct = output.hold === true;
		reasons.push(
			output.hold
				? "保留すべきところで保留している"
				: "保留すべきところで保留していない",
		);
	} else {
		if (output.hold) {
			reasons.push("保留不要なところで保留している");
		}
		const missingGroups = gold.requiredGroups.filter(
			(group) => !group.some((alt) => output.answer.includes(alt)),
		);
		if (missingGroups.length > 0) {
			reasons.push(
				`必要な記述が欠落: ${missingGroups
					.map((g) => `(${g.join(" | ")})`)
					.join(", ")}`,
			);
		}
		correct = output.hold === false && missingGroups.length === 0;
		if (correct) reasons.push("必要な記述がすべてあり、保留もしていない");
	}
	const contaminationHits = gold.forbidden.filter((phrase) =>
		output.answer.includes(phrase),
	);
	if (contaminationHits.length > 0) {
		reasons.push(`禁止された記述が含まれる: ${contaminationHits.join(", ")}`);
	}
	const unknownCitations = output.citations.filter((id) => !contextIds.has(id));
	if (unknownCitations.length > 0) {
		reasons.push(`文脈に存在しない引用: ${unknownCitations.join(", ")}`);
	}
	return {
		correct,
		contamination: contaminationHits.length > 0,
		holdCorrect,
		citationValid: unknownCitations.length === 0,
		reasons,
	};
}

/** One scored answer, with the score fields flattened in. */
export interface E04ResultItem extends E04AnswerScore {
	readonly arm: E04Arm;
	readonly category: E04Category;
	readonly inputTokens: number;
	/** Share of the gold evidence the presented context contained. */
	readonly evidenceRecall: number | null;
	/** The arm's context was cut by the budget. */
	readonly partial: boolean;
}

export interface E04Aggregate {
	readonly n: number;
	/** Null when n is 0. Failures and partials stay in the denominator. */
	readonly correctRate: number | null;
	readonly contaminationCount: number;
	readonly holdAccuracy: number | null;
	readonly meanInputTokens: number | null;
	/** Mean over items whose evidenceRecall is not null; null if none. */
	readonly meanEvidenceRecall: number | null;
	readonly partialCount: number;
}

export interface E04Summary {
	readonly byArm: Readonly<Record<E04Arm, E04Aggregate>>;
	readonly byArmCategory: Readonly<
		Record<E04Arm, Readonly<Record<E04Category, E04Aggregate>>>
	>;
}

function aggregate(items: readonly E04ResultItem[]): E04Aggregate {
	const n = items.length;
	const recalls = items
		.map((i) => i.evidenceRecall)
		.filter((r): r is number => r !== null);
	const mean = (values: readonly number[]): number | null =>
		values.length === 0
			? null
			: values.reduce((sum, v) => sum + v, 0) / values.length;
	return {
		n,
		correctRate: n === 0 ? null : items.filter((i) => i.correct).length / n,
		contaminationCount: items.filter((i) => i.contamination).length,
		holdAccuracy:
			n === 0 ? null : items.filter((i) => i.holdCorrect).length / n,
		meanInputTokens: mean(items.map((i) => i.inputTokens)),
		meanEvidenceRecall: mean(recalls),
		partialCount: items.filter((i) => i.partial).length,
	};
}

/** Per-arm and per-arm-by-category aggregates over scored results. */
export function summarizeE04(results: readonly E04ResultItem[]): E04Summary {
	const byArm = Object.fromEntries(
		e04Arms.map((arm) => [
			arm,
			aggregate(results.filter((r) => r.arm === arm)),
		]),
	) as Record<E04Arm, E04Aggregate>;
	const byArmCategory = Object.fromEntries(
		e04Arms.map((arm) => [
			arm,
			Object.fromEntries(
				e04Categories.map((category) => [
					category,
					aggregate(
						results.filter((r) => r.arm === arm && r.category === category),
					),
				]),
			),
		]),
	) as Record<E04Arm, Record<E04Category, E04Aggregate>>;
	return { byArm, byArmCategory };
}
