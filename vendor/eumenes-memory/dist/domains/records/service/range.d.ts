import type { RecordRangeReasonCode } from "../contracts/index.ts";
import type { ByteRange } from "../../../contracts/types.ts";
export type RangeSlice = {
    readonly status: "ok";
    readonly text: string;
    /** 範囲の bytes の SHA-256 hex（quote digest）。 */
    readonly digest: string;
} | {
    readonly status: "invalid_range";
    readonly reasonCode: RecordRangeReasonCode;
};
/**
 * 判定順: 範囲が上限超過 → `RANGE_TOO_LARGE`（本文の長さに依存しない）、本文の外 →
 * `SOURCE_RANGE_OUT_OF_BOUNDS`、端がコードポイント境界でない → `SOURCE_RANGE_NOT_CHAR_BOUNDARY`。
 */
export declare function sliceUtf8Range(content: string, range: ByteRange, maxBytes?: number): RangeSlice;
