/**
 * RFC 8785 (JCS) のサブセット。受理する値は plain object / array / string /
 * boolean / 安全な整数のみ。それ以外はコアのバグとして TypeError を投げる。
 */
export declare function canonicalJson(value: unknown): string;
