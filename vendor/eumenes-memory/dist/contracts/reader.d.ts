import { type ContractErrorCode } from "./errors.ts";
export type Rec = Readonly<Record<string, unknown>>;
export declare function fail(code: ContractErrorCode, path: string): never;
export declare function keyPath(path: string, key: string): string;
export declare function indexPath(path: string, index: number): string;
/** plain object の own データプロパティを null-prototype のコピーへ読む。 */
export declare function readRecord(value: unknown, path: string): Rec;
/** 未知キー検査。path は親オブジェクト（キー名を出さない）。 */
export declare function checkKeys(record: Rec, path: string, allowed: readonly string[]): void;
export declare function requiredField(record: Rec, path: string, key: string): unknown;
/** 配列の長さ → 構造（穴・非 index プロパティ・accessor・symbol）を検査し、密なコピーを返す。 */
export declare function readArray(value: unknown, path: string, maxLength: number): readonly unknown[];
/** U+0000–U+001F と U+007F を含むか。 */
export declare function hasControlChars(text: string): boolean;
/** 識別子: 非空、制御文字なし、lone surrogate なし。 */
export declare function readIdentifier(value: unknown, path: string, maxBytes: number): string;
/** 名前トークン: 識別子規則 + /^[a-z][a-z0-9._-]*$/。 */
export declare function readNameToken(value: unknown, path: string, maxBytes: number): string;
/** item ID: 識別子規則 + "<名前トークン>:<非空>"。 */
export declare function readItemId(value: unknown, path: string, maxBytes: number, maxNamespaceBytes: number): string;
/** 本文: lone surrogate なし。改行・タブ等の制御文字は許可。 */
export declare function readText(value: unknown, path: string, maxBytes: number, allowEmpty: boolean): string;
export declare function readDigest(value: unknown, path: string): string;
export declare function readSafeInteger(value: unknown, path: string, min: number, max: number): number;
export declare function readBoolean(value: unknown, path: string): boolean;
export declare function readEnum<T extends string>(value: unknown, path: string, allowed: readonly T[]): T;
