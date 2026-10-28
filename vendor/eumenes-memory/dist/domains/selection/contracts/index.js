export const SCOPE_KINDS = Object.freeze([
    "user_common",
    "project",
    "task",
    "topic",
    "request",
]);
export const REQUIRED_REASONS = Object.freeze([
    "current_request",
    "prohibition",
    "constraint",
    "goal",
    "decision",
    "open_question",
    "recent_turn",
    "tool_pairing",
]);
export const OMIT_REASONS = Object.freeze([
    "SCOPE_NOT_AUTHORIZED",
    "SCOPE_NOT_ACTIVE",
    "NOT_THIS_REQUEST",
    "NOT_CURRENT",
    "NOT_KNOWN_AT_TARGET",
    /** 期間の記述が不正（暦として成立しない・逆転）。追加集合では除外、必須集合では解決不能として hold。 */
    "INVALID_PERIOD",
    "SUPERSEDED_BY_CONFLICT",
    "DUPLICATE",
    "BUDGET",
    "ITEM_LIMIT",
]);
export const RETRIEVAL_FLAGS = Object.freeze([
    "not_found_in_searched_scopes",
    "search_truncated",
    "evidence_stale",
    "correction_pending",
    "raw_unprocessed",
]);
export const REVALIDATION_REASONS = Object.freeze([
    "PRINCIPAL_CHANGED",
    "POLICY_CHANGED",
    "SELECTION_POLICY_CHANGED",
    "SCOPE_GRANT_CHANGED",
    "ITEM_CHANGED",
    "REQUIRED_SET_CHANGED",
    "CORRECTION_PENDING",
    "BOUNDARY_REGRESSED",
    "ITEM_EXPIRED",
]);
