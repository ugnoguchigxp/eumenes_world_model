import { BUILD_REASON_CODES, VALIDATION_REASON_CODES } from "./reason-codes.js";
export const LIMITS_VIEW_V2 = Object.freeze({
    /** `evidence.hits` の件数上限（`LIMITS_RECALL.maxLimit` と同じ）。 */
    maxEvidenceHits: 50,
    /** `evidence.maxEvidenceBytes` の上限。 */
    maxEvidenceBytes: 65536,
    /** 1 件の evidence snippet の上限（byte）。 */
    maxEvidenceSnippetBytes: 256,
    /** coverage.omitted の要素数上限（v2 は kind 別 1 要素ずつなので小さい）。 */
    maxCoverageOmitted: 16,
});
/** v1 の kind（goal / decision / open_question）+ State 由来 4 種。`other_person_note` は view に入らない。 */
export const ITEM_KINDS_V2 = Object.freeze([
    "goal",
    "decision",
    "open_question",
    "preference",
    "personal_fact",
    "constraint",
    "habit",
]);
export const ITEM_ORIGINS_V2 = Object.freeze([
    "user_confirmed",
    "user_edited",
    "admitted_extraction",
]);
/**
 * v2 の build / validate reasonCode。v1 の全要素を同順で含み、v2 で追加する要素は S0 時点で無い
 * （evidence は既存の SOURCE_* / BUDGET_EXCEEDED で表す）。追加が必要になったら末尾に足す
 * （v1 のタプルは変更しない）。v1 結果に v2 専用コードは出ない。
 */
export const BUILD_V2_REASON_CODES = Object.freeze([
    ...BUILD_REASON_CODES,
]);
export const VALIDATION_V2_REASON_CODES = Object.freeze([
    ...VALIDATION_REASON_CODES,
]);
