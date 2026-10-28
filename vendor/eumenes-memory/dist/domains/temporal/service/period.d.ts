import type { PartialDate, TemporalReason, ValidityPeriod } from "../contracts/index.ts";
export declare class TemporalError extends Error {
    readonly name: "TemporalError";
    readonly reason: TemporalReason;
    constructor(reason: TemporalReason);
}
/** 暦として成立する日付だけを受ける（精度に無関係なフィールドは拒否）。 */
export declare function assertPartialDate(date: PartialDate): void;
/** 精度の最初の瞬間（UTC）。 */
export declare function startOfMs(date: PartialDate): number;
/** 精度の次の単位の最初の瞬間（排他的な終端）。 */
export declare function endExclusiveMs(date: PartialDate): number;
export interface PeriodBoundsMs {
    /** 含む。`null` は始まりが不明（無限の過去）。 */
    readonly startMs: number | null;
    /** 含まない。`null` は終わりが不明（継続中）。 */
    readonly endMs: number | null;
}
export declare function periodBoundsMs(period: ValidityPeriod): PeriodBoundsMs;
/** 既存の State が持つ `validFromMs` / `validUntilMs`（until は含まない）から、ミリ秒厳密の期間を作る。 */
export declare function periodFromStateMs(validFromMs: number | null, validUntilMs: number | null): ValidityPeriod | undefined;
/** 保存用の文字列（`2026` / `2026-09` / `2026-09-03`）。精度が文字列の長さで保たれる。 */
export declare function formatPartialDate(date: PartialDate): string;
export declare function parsePartialDate(text: string): PartialDate;
