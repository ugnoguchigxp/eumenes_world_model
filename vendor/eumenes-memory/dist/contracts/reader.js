/**
 * 入力を own-property だけで安全に読む部品。値は一切変更せず、検査済みの
 * コピーを返す。例外は MemoryContractError（code と path のみ）。
 */
import { isWellFormedUtf16, utf8ByteLength } from "../canonical/utf8.js";
import { MemoryContractError } from "./errors.js";
export function fail(code, path) {
    throw new MemoryContractError(code, path);
}
export function keyPath(path, key) {
    return `${path}.${key}`;
}
export function indexPath(path, index) {
    return `${path}[${index}]`;
}
function ownDataValue(target, key, path) {
    if (typeof key === "symbol")
        return fail("INVALID_PROPERTY", path);
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
        return fail("INVALID_PROPERTY", path);
    }
    return descriptor.value;
}
/** plain object の own データプロパティを null-prototype のコピーへ読む。 */
export function readRecord(value, path) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return fail("INVALID_TYPE", path);
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
        return fail("INVALID_PROPERTY", path);
    }
    const copy = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
        // null-prototype のコピーなので代入で own プロパティになる（__proto__ も）。
        copy[key] = ownDataValue(value, key, path);
    }
    return copy;
}
/** 未知キー検査。path は親オブジェクト（キー名を出さない）。 */
export function checkKeys(record, path, allowed) {
    for (const key of Object.keys(record)) {
        if (!allowed.includes(key))
            fail("UNKNOWN_KEY", path);
    }
}
export function requiredField(record, path, key) {
    if (!Object.hasOwn(record, key))
        return fail("MISSING_KEY", keyPath(path, key));
    return record[key];
}
/** 配列の長さ → 構造（穴・非 index プロパティ・accessor・symbol）を検査し、密なコピーを返す。 */
export function readArray(value, path, maxLength) {
    if (!Array.isArray(value))
        return fail("INVALID_TYPE", path);
    const length = value.length;
    if (length > maxLength)
        return fail("ARRAY_TOO_LONG", path);
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1)
        return fail("INVALID_PROPERTY", path);
    const copy = [];
    for (let index = 0; index < length; index += 1) {
        copy.push(ownDataValue(value, String(index), path));
    }
    // keys.length === length + 1 かつ 0..length-1 がすべて own なので、残りは "length"。
    return copy;
}
// ---- 文字列 ----
/** U+0000–U+001F と U+007F を含むか。 */
export function hasControlChars(text) {
    for (let i = 0; i < text.length; i += 1) {
        const c = text.charCodeAt(i);
        if (c <= 0x1f || c === 0x7f)
            return true;
    }
    return false;
}
const NAME_TOKEN = /^[a-z][a-z0-9._-]*$/;
const DIGEST = /^[0-9a-f]{64}$/;
function checkedString(value, path, maxBytes, allowEmpty, rejectControls) {
    if (typeof value !== "string")
        return fail("INVALID_TYPE", path);
    if (value.length === 0 && !allowEmpty)
        return fail("EMPTY_STRING", path);
    if (value.length > maxBytes || utf8ByteLength(value) > maxBytes) {
        return fail("STRING_TOO_LONG", path);
    }
    if (!isWellFormedUtf16(value))
        return fail("INVALID_STRING", path);
    if (rejectControls && hasControlChars(value)) {
        return fail("INVALID_STRING", path);
    }
    return value;
}
/** 識別子: 非空、制御文字なし、lone surrogate なし。 */
export function readIdentifier(value, path, maxBytes) {
    return checkedString(value, path, maxBytes, false, true);
}
/** 名前トークン: 識別子規則 + /^[a-z][a-z0-9._-]*$/。 */
export function readNameToken(value, path, maxBytes) {
    const text = readIdentifier(value, path, maxBytes);
    if (!NAME_TOKEN.test(text))
        return fail("INVALID_ID_FORMAT", path);
    return text;
}
/** item ID: 識別子規則 + "<名前トークン>:<非空>"。 */
export function readItemId(value, path, maxBytes, maxNamespaceBytes) {
    const text = readIdentifier(value, path, maxBytes);
    const colon = text.indexOf(":");
    if (colon <= 0 || colon === text.length - 1) {
        return fail("INVALID_ID_FORMAT", path);
    }
    const namespace = text.slice(0, colon);
    if (!NAME_TOKEN.test(namespace) || namespace.length > maxNamespaceBytes) {
        return fail("INVALID_ID_FORMAT", path);
    }
    return text;
}
/** 本文: lone surrogate なし。改行・タブ等の制御文字は許可。 */
export function readText(value, path, maxBytes, allowEmpty) {
    return checkedString(value, path, maxBytes, allowEmpty, false);
}
export function readDigest(value, path) {
    if (typeof value !== "string")
        return fail("INVALID_TYPE", path);
    if (!DIGEST.test(value))
        return fail("INVALID_DIGEST", path);
    return value;
}
export function readSafeInteger(value, path, min, max) {
    if (typeof value !== "number")
        return fail("INVALID_TYPE", path);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        return fail("INVALID_INTEGER", path);
    }
    return value === 0 ? 0 : value;
}
export function readBoolean(value, path) {
    if (typeof value !== "boolean")
        return fail("INVALID_TYPE", path);
    return value;
}
export function readEnum(value, path, allowed) {
    if (typeof value !== "string")
        return fail("INVALID_TYPE", path);
    const found = allowed.find((candidate) => candidate === value);
    if (found === undefined)
        return fail("INVALID_ENUM", path);
    return found;
}
