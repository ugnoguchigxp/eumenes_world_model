/** エンコードせずコード単位から UTF-8 byte 長を計算する。 */
export declare function utf8ByteLength(s: string): number;
export declare function encodeUtf8(s: string): Uint8Array;
/** lone surrogate を含まない場合に true。String.prototype.isWellFormed に依存しない。 */
export declare function isWellFormedUtf16(s: string): boolean;
/** UTF-8 コードポイント境界か。書記素クラスタは考慮しない。 */
export declare function isUtf8CharBoundary(bytes: Uint8Array, index: number): boolean;
