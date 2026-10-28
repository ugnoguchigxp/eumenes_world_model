export const LIMITS_RECORDS = Object.freeze({
    /** 1 回の capture の本文上限（UTF-8 byte）。M0 の maxSourceContentBytes と同じ。 */
    maxContentBytes: 1048576,
    /** readRecordRange の上限（UTF-8 byte）。 */
    maxRangeBytes: 65536,
    maxOriginNamespaceBytes: 64,
    maxOriginKindBytes: 64,
    maxOriginIdBytes: 256,
    maxProviderRefBytes: 64,
    /** recordSourceStates 1 回の refs 件数。 */
    maxSourceStateRefs: 256,
});
export const RECORD_MEDIA_TYPES = Object.freeze([
    "text/plain",
    "text/markdown",
    "application/json",
]);
export const RECORD_CAPTURE_STATES = Object.freeze([
    "complete",
    "partial",
]);
/** 現存する record の状態。`forgotten` の record は本文もメタも返さないので含めない。 */
export const RECORD_STATUSES = Object.freeze(["active", "inactive"]);
/** capture が拒否される理由。 */
export const RECORD_BLOCKED_REASON_CODES = Object.freeze([
    "SCOPE_NOT_PERMITTED",
    "TOMBSTONED",
]);
/** readRecordRange の範囲異常（M0 の SourceReasonCode と同名、+ 上限超過）。 */
export const RECORD_RANGE_REASON_CODES = Object.freeze([
    "SOURCE_RANGE_OUT_OF_BOUNDS",
    "SOURCE_RANGE_NOT_CHAR_BOUNDARY",
    "RANGE_TOO_LARGE",
]);
