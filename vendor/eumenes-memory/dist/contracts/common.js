export const POLARITIES = Object.freeze(["affirmed", "negated"]);
export const MODALITIES = Object.freeze([
    "asserted",
    "hypothetical",
    "quoted",
    "reported",
    "question",
]);
export const TEMPORALS = Object.freeze([
    "current",
    "past",
    "future",
    "unspecified",
]);
/** 出典となる発言・取得物の役割。ホストが付与する。 */
export const SOURCE_ROLES = Object.freeze([
    "user",
    "assistant",
    "tool",
]);
/** 永続 API が access 検査で返す reasonCode（family 共通）。 */
export const STORE_ACCESS_REASON_CODES = Object.freeze([
    "SCOPE_NOT_PERMITTED",
]);
/**
 * 本体が host の中立な出典として扱う、Memory 所有出典の SourceRef の固定値
 * （Records: namespace `memory`, kind `record`, id = recordId, representation `text`）。
 */
export const MEMORY_SOURCE_NAMESPACE = "memory";
export const MEMORY_RECORD_SOURCE_KIND = "record";
export const MEMORY_RECORD_REPRESENTATION = "text";
