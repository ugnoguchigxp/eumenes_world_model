import type { TimeEvaluation, TimeQuery, TimedEntry, ValidityClass } from "../contracts/index.ts";
/** 照会の対象時点。`current` は `atMs`、`at` は `targetMs`。 */
export declare function queryTargetMs(query: TimeQuery): number;
/** 期間と対象時点から 現在有効 / 過去有効 / 未来予定 / 時点不明 を決める。時計は読まない。 */
export declare function classifyValidity(period: TimedEntry["period"], targetMs: number): ValidityClass;
export declare function evaluateTime(entry: TimedEntry, query: TimeQuery): TimeEvaluation;
export interface TimeFilterOptions {
    /** 期間の無い（時点不明の）項目を現在の照会で残すか。既定 true（好み・事実の多くは期限を持たない）。 */
    readonly includeUnknownInCurrent?: boolean;
    /** 期間の無い項目を過去の照会でも残すか（当時すでに記録されていたものに限る）。既定 false。必須の制約・禁止に使う。 */
    readonly includeUnknownInAt?: boolean;
}
/**
 * 照会に答えられる項目か。
 * - `current`: 現在有効だけ（時点不明は `includeUnknownInCurrent` 次第）。過去・未来は混ぜない。
 * - `at`: 対象時点で有効だったもの。当時まだ記録されていない項目は、記録時点の知識に含めない。
 *   時点不明は過去の照会には入れない（当時の状態だと断定できない）。
 */
export declare function answersQuery(entry: TimedEntry, query: TimeQuery, options?: TimeFilterOptions): boolean;
