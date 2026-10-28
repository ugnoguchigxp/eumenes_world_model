export declare const CONTRACT_ERROR_CODES: readonly ["INVALID_TYPE", "INVALID_PROPERTY", "UNSUPPORTED_SCHEMA_VERSION", "UNKNOWN_KEY", "MISSING_KEY", "INVALID_ENUM", "EMPTY_STRING", "INVALID_STRING", "STRING_TOO_LONG", "ARRAY_TOO_LONG", "INVALID_INTEGER", "INVALID_DIGEST", "INVALID_ID_FORMAT", "INVALID_RANGE", "INVALID_VALUE", "DUPLICATE_SCOPE_KEY", "DUPLICATE_SOURCE", "TOTAL_CONTENT_TOO_LARGE", "DUPLICATE_DEPENDENCY", "CONFLICTING_DEPENDENCY", "PRIMARY_SOURCE_NOT_IN_DEPENDENCIES", "DUPLICATE_ITEM_ID"];
export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[number];
/**
 * 入力契約違反。message は `${code} at ${path}` 固定で、入力値・キー名・原文を
 * 含めない。インスタンスは freeze しない（Error の stack 書き換えと衝突する）。
 */
export declare class MemoryContractError extends Error {
    readonly name: "MemoryContractError";
    readonly code: ContractErrorCode;
    readonly path: string;
    constructor(code: ContractErrorCode, path: string);
}
/** instanceof に加え、複数コピーのパッケージでも判定できるよう構造でも判定する。 */
export declare function isMemoryContractError(value: unknown): value is MemoryContractError;
