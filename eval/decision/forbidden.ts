/**
 * Negation- and condition-aware matching of forbidden phrases.
 *
 * A plain substring match fires on correct answers that mention a forbidden
 * phrase only to deny or condition it ("3営業日で届くとは限らない",
 * "自動化のおかげとは言えない"). Every occurrence of a phrase is therefore
 * classified at sentence/clause level, deterministically, in this order:
 *
 *   1. excused (not a failure):
 *      - quoted: the phrase sits between a matching pair of quotes
 *        (「」『』“”"") in its sentence;
 *      - negated: in the same clause (up to the next 、，,；;) the text right
 *        after the phrase is at most 8 hiragana followed by a negation
 *        ending (ない, ません, 言えない, 限らない, 断定できない, なかった, なく ...);
 *        doubt endings (かもしれない, ではないか) are not negation.
 *   2. ambiguous (needs-adjudication): not excused, but the sentence (with the
 *      phrase masked out) carries a negation cue elsewhere, a conditional cue
 *      (場合, なら, 限り, のみ, ただし, 以上, 未満 ...) or an uncertainty cue
 *      (かもしれ, 可能性, 未確認 ...). The answer may be correct and
 *      conditional, or a wrong answer that hedges; a human decides.
 *   3. violation: neither of the above. The phrase is asserted plainly.
 *
 * Verdict over all occurrences: violation > needs-adjudication > clear.
 *
 * Known limits (also recorded in spec/decision-evaluation.md):
 *   false negatives (a violation excused): a quotation that the answer then
 *     endorses ("「3営業日で届く」で正しい"); a negation ending unrelated to the
 *     phrase that happens to follow within 8 hiragana ("届くしかない").
 *   false positives (a correct answer flagged): a phrase used descriptively
 *     with no cue ("以前は3営業日で届く運用だった"); paraphrases that put the
 *     negation in another clause. Those surface as violations, so they are
 *     visible in the report reasons and reviewed by a human.
 */
import type { Adjudication, SafetyKind } from "./types.ts";

const SENTENCE_BREAK = /[。！？!?\n]/;
const CLAUSE_BREAK = /[、，,；;]/;

const NEGATED_TAIL =
	/^[ぁ-ん]{0,8}(?:言えない|言えません|いえない|いえません|断定できない|断定できません|限らない|限りません|できない|できません|なかった|なく|ない|ません|ぬ)/;

/** "かもしれない" / "ではないか" end in ない but express doubt, not negation. */
const DOUBT_TAIL = /^[ぁ-ん]{0,8}?(?:かもしれ|ではないか|じゃないか)/;

const NEGATION_CUE =
	/ない|ません|なかった|不可|誤り|間違い|否定|言えず|できず|ではなく/;
const CONDITION_CUE =
	/場合|なら|であれば|れば|たら|限り|限る|のみ|ただし|もし|条件|以上|未満|以下|のとき|ときは|時は/;
const UNCERTAIN_CUE =
	/かもしれ|ではないか|じゃないか|可能性|未確認|確認でき|確認が必要|不明|未定/;

const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
	["「", "」"],
	["『", "』"],
	["“", "”"],
];

export type ForbiddenVerdict = "clear" | "needs-adjudication" | "violation";

export interface ForbiddenOccurrence {
	readonly index: number;
	readonly outcome: "excused" | "ambiguous" | "violation";
	readonly reason: string;
	readonly sentence: string;
}

export interface ForbiddenMatch {
	readonly verdict: ForbiddenVerdict;
	readonly occurrences: readonly ForbiddenOccurrence[];
}

function sentenceBounds(
	text: string,
	start: number,
	end: number,
): readonly [number, number] {
	let from = start;
	while (from > 0 && !SENTENCE_BREAK.test(text[from - 1] ?? "")) from -= 1;
	let to = end;
	while (to < text.length && !SENTENCE_BREAK.test(text[to] ?? "")) to += 1;
	return [from, to];
}

function isQuoted(sentence: string, at: number, length: number): boolean {
	for (const [open, close] of QUOTE_PAIRS) {
		const lastOpen = sentence.lastIndexOf(open, at);
		const lastClose = sentence.lastIndexOf(close, at);
		if (
			lastOpen >= 0 &&
			lastOpen > lastClose &&
			sentence.indexOf(close, at + length) >= 0
		) {
			return true;
		}
	}
	const before = sentence.slice(0, at).split('"').length - 1;
	return before % 2 === 1 && sentence.indexOf('"', at + length) >= 0;
}

function classify(
	text: string,
	index: number,
	phrase: string,
): ForbiddenOccurrence {
	const end = index + phrase.length;
	const [from, to] = sentenceBounds(text, index, end);
	const sentence = text.slice(from, to);
	const local = index - from;
	if (isQuoted(sentence, local, phrase.length)) {
		return { index, outcome: "excused", reason: "引用符内", sentence };
	}
	let clauseEnd = end;
	while (clauseEnd < to && !CLAUSE_BREAK.test(text[clauseEnd] ?? "")) {
		clauseEnd += 1;
	}
	const tail = text.slice(end, clauseEnd);
	if (!DOUBT_TAIL.test(tail) && NEGATED_TAIL.test(tail)) {
		return { index, outcome: "excused", reason: "同一節内で否定", sentence };
	}
	const masked = `${sentence.slice(0, local)}◇${sentence.slice(local + phrase.length)}`;
	if (NEGATION_CUE.test(masked)) {
		return {
			index,
			outcome: "ambiguous",
			reason: "文中に否定の手掛かりがあるが同一節で否定されていない",
			sentence,
		};
	}
	if (CONDITION_CUE.test(masked)) {
		return {
			index,
			outcome: "ambiguous",
			reason: "文中に条件の手掛かりがある（条件付きの正答か判別できない）",
			sentence,
		};
	}
	if (UNCERTAIN_CUE.test(masked)) {
		return {
			index,
			outcome: "ambiguous",
			reason: "文中に不確実性の手掛かりがある",
			sentence,
		};
	}
	return { index, outcome: "violation", reason: "断定として出現", sentence };
}

export function matchForbidden(text: string, phrase: string): ForbiddenMatch {
	if (phrase === "") return { verdict: "clear", occurrences: [] };
	const occurrences: ForbiddenOccurrence[] = [];
	let from = 0;
	for (;;) {
		const index = text.indexOf(phrase, from);
		if (index < 0) break;
		occurrences.push(classify(text, index, phrase));
		from = index + phrase.length;
	}
	const verdict: ForbiddenVerdict = occurrences.some(
		(o) => o.outcome === "violation",
	)
		? "violation"
		: occurrences.some((o) => o.outcome === "ambiguous")
			? "needs-adjudication"
			: "clear";
	return { verdict, occurrences };
}

export function toAdjudications(
	kind: SafetyKind,
	phrase: string,
	match: ForbiddenMatch,
): Adjudication[] {
	return match.occurrences
		.filter((o) => o.outcome === "ambiguous")
		.map((o) => ({
			kind,
			phrase,
			context: o.sentence,
			reason: o.reason,
		}));
}
