/**
 * SHA-256 を小文字 hex 64 文字で返す。文字列は UTF-8 に変換してハッシュする。
 * node:crypto を import するのはこのファイルだけ（将来の差し替え点）。
 */
export declare function sha256Hex(data: string | Uint8Array): string;
