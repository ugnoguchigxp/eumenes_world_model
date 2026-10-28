export const CONTRACT_ERROR_CODES = Object.freeze([
    "INVALID_TYPE",
    "INVALID_PROPERTY",
    "UNSUPPORTED_SCHEMA_VERSION",
    "UNKNOWN_KEY",
    "MISSING_KEY",
    "INVALID_ENUM",
    "EMPTY_STRING",
    "INVALID_STRING",
    "STRING_TOO_LONG",
    "ARRAY_TOO_LONG",
    "INVALID_INTEGER",
    "INVALID_DIGEST",
    "INVALID_ID_FORMAT",
    "INVALID_RANGE",
    "INVALID_VALUE",
    "DUPLICATE_SCOPE_KEY",
    "DUPLICATE_SOURCE",
    "TOTAL_CONTENT_TOO_LARGE",
    "DUPLICATE_DEPENDENCY",
    "CONFLICTING_DEPENDENCY",
    "PRIMARY_SOURCE_NOT_IN_DEPENDENCIES",
    "DUPLICATE_ITEM_ID",
]);
/**
 * 入力契約違反。message は `${code} at ${path}` 固定で、入力値・キー名・原文を
 * 含めない。インスタンスは freeze しない（Error の stack 書き換えと衝突する）。
 */
export class MemoryContractError extends Error {
    name = "MemoryContractError";
    code;
    path;
    constructor(code, path) {
        super(`${code} at ${path}`);
        this.code = code;
        this.path = path;
    }
}
/** instanceof に加え、複数コピーのパッケージでも判定できるよう構造でも判定する。 */
export function isMemoryContractError(value) {
    if (value instanceof MemoryContractError)
        return true;
    if (!(value instanceof Error))
        return false;
    const candidate = value;
    return (candidate["name"] === "MemoryContractError" &&
        typeof candidate["code"] === "string" &&
        CONTRACT_ERROR_CODES.includes(candidate["code"]) &&
        typeof candidate["path"] === "string");
}
