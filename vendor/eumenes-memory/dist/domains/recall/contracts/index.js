export const LIMITS_RECALL = Object.freeze({
    maxQueryBytes: 256,
    maxTerms: 8,
    minLimit: 1,
    maxLimit: 50,
    maxSnippetBytes: 256,
    maxCursorBytes: 512,
    /** M0 の LIMITS.maxScopeKeys と同じ。 */
    maxScopeKeys: 64,
});
export const RECALL_STRATEGIES = Object.freeze(["like", "fts"]);
export const RECALL_BLOCKED_REASON_CODES = Object.freeze([
    "SCOPE_NOT_PERMITTED",
]);
