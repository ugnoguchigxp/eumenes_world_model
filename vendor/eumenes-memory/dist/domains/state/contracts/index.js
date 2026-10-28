export const LIMITS_STATE = Object.freeze({
    maxSemanticKeyBytes: 128,
    maxSubjectBytes: 128,
    maxValueTextBytes: 4096,
    maxAttributes: 16,
    maxAttributeKeyBytes: 64,
    maxAttributeValueBytes: 256,
    maxEvidencePerItem: 8,
    maxQuoteBytes: 1024,
    /** 1 回の呼び出しで渡せる出典（本文つき）の件数。 */
    maxSources: 64,
    maxListItems: 1000,
    /** `listStateScopes` が一度に読む scope の数。 */
    maxScopesPerRead: 8,
});
export const STATE_KINDS = Object.freeze([
    "preference",
    "personal_fact",
    "constraint",
    "habit",
    "other_person_note",
]);
export const STATE_ITEM_STATUSES = Object.freeze([
    "active",
    "inactive",
    "superseded",
    "disputed",
    "retracted",
    "invalidated",
    "forgotten",
]);
/** 明示操作（モデルなし）で付く origin。 */
export const USER_STATE_ORIGINS = Object.freeze([
    "user_confirmed",
    "user_edited",
]);
export const STATE_ORIGINS = Object.freeze([
    ...USER_STATE_ORIGINS,
    "admitted_extraction",
]);
export const STATE_EVENT_ACTIONS = Object.freeze([
    "assert",
    "activate",
    "edit",
    "supersede",
    "dispute",
    "retract",
    "deactivate",
    "reactivate",
    "invalidate",
    "forget",
]);
export const STATE_CAUSE_TYPES = Object.freeze([
    "user",
    "candidate",
    "lifecycle",
]);
/**
 * State 書き込みの rejected 理由（reducer + 根拠検査）。Admission の理由は
 * `ADMISSION_REASON_CODES`。両者は別タプルで、同名のコード（`OLDER_EVIDENCE` など）は同じ意味。
 */
export const STATE_REASON_CODES = Object.freeze([
    "STALE_REVISION",
    "OLDER_EVIDENCE",
    "ACTIVE_EXISTS",
    "INVALID_TRANSITION",
    "SUBJECT_KIND_MISMATCH",
    "REPLACES_MISMATCH",
    "QUOTE_MISMATCH",
    "EVIDENCE_NOT_IN_INPUT",
    "SOURCE_STALE",
    "SOURCE_TOMBSTONED",
]);
// ---- Admission ----
export const ADMISSION_DECISIONS = Object.freeze([
    "admitted",
    "pending_user",
    "rejected",
]);
/** kind ごとの採用方針。`never` = 候補も作らず rejected、`user_confirm` = 候補（pending_user）まで。 */
export const ADMISSION_MODES = Object.freeze([
    "never",
    "user_confirm",
    "auto_admit",
]);
/**
 * Admission 規則表（design §3.5）を上から評価したときの reasonCode。評価順はこのタプルの順序と
 * 同じ。ただし kind の方針が `never` のときは、`pending_user` になるはずの規則（MODALITY_QUOTED /
 * SUBJECT_OTHER / TEMPORAL_NOT_CURRENT / NOT_USER_SOURCE / 確認済み項目の保護）が当たっても候補を作らず
 * `rejected` / `POLICY_NEVER` にする（`never` が `pending_user` より優先）。`admitted` は reasonCode なし。
 * `TEMPORAL_NOT_CURRENT`（S5 で追加、§6.4(a) 過去の状態）: temporal が past / future の候補は現在の状態にしない。
 */
export const ADMISSION_REASON_CODES = Object.freeze([
    "INVALID_CANDIDATE",
    "QUOTE_MISMATCH",
    "EVIDENCE_NOT_IN_INPUT",
    "SOURCE_STALE",
    "HOST_OWNED_KIND",
    "MODALITY_QUOTED",
    "MODALITY_NOT_ASSERTED",
    "SUBJECT_OTHER",
    "SUBJECT_UNKNOWN",
    "TEMPORAL_NOT_CURRENT",
    "NOT_USER_SOURCE",
    "OLDER_EVIDENCE",
    "POLICY_NEVER",
    "POLICY_REQUIRES_USER",
]);
/** 既定は全 kind `user_confirm`（候補生成のみ）。`auto_admit` は E 段階の合格記録がある kind だけに設定する運用。 */
export const DEFAULT_ADMISSION_POLICY = Object.freeze({
    preference: "user_confirm",
    personal_fact: "user_confirm",
    constraint: "user_confirm",
    habit: "user_confirm",
    other_person_note: "user_confirm",
});
