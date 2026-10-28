import { VALIDITY_BASES } from "../contracts/index.js";
import { TemporalError, periodBoundsMs } from "./period.js";
/** 記録時刻・現在時刻は 1970 年以降（非負）。 */
function assertMs(value) {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new TemporalError("INVALID_TIME");
}
/** 照会の対象時点は 1970 年より前（負の ms）でもよい（「1965 年には何だったか」）。 */
function assertTarget(value) {
    if (!Number.isSafeInteger(value))
        throw new TemporalError("INVALID_TIME");
}
/** 照会の対象時点。`current` は `atMs`、`at` は `targetMs`。 */
export function queryTargetMs(query) {
    assertMs(query.atMs);
    if (query.mode === "current")
        return query.atMs;
    assertTarget(query.targetMs);
    return query.targetMs;
}
/** 期間と対象時点から 現在有効 / 過去有効 / 未来予定 / 時点不明 を決める。時計は読まない。 */
export function classifyValidity(period, targetMs) {
    assertTarget(targetMs);
    if (period === undefined)
        return "unknown";
    if (period === null || typeof period !== "object")
        throw new TemporalError("INVALID_PERIOD");
    if (!VALIDITY_BASES.includes(period.basis))
        throw new TemporalError("INVALID_PERIOD");
    // 根拠が unknown でも境界の記述は検査する（不正な期間を黙って通さない）。
    const { startMs, endMs } = periodBoundsMs(period);
    if (period.basis === "unknown")
        return "unknown";
    if (startMs === null && endMs === null)
        return "unknown";
    if (startMs !== null && targetMs < startMs)
        return "future";
    if (endMs !== null && targetMs >= endMs)
        return "past";
    return "current";
}
export function evaluateTime(entry, query) {
    const targetMs = queryTargetMs(query);
    assertMs(entry.recordedAtMs);
    // 先に期間を検査する（不正な期間は coarse の計算より前に TemporalError）。
    const validity = classifyValidity(entry.period, targetMs);
    const coarse = entry.period !== undefined &&
        [entry.period.from, entry.period.until].some((date) => date !== undefined && date.precision !== "day");
    return {
        validity,
        recordedAfterTarget: query.mode === "at" && entry.recordedAtMs > query.targetMs,
        coarse,
    };
}
/**
 * 照会に答えられる項目か。
 * - `current`: 現在有効だけ（時点不明は `includeUnknownInCurrent` 次第）。過去・未来は混ぜない。
 * - `at`: 対象時点で有効だったもの。当時まだ記録されていない項目は、記録時点の知識に含めない。
 *   時点不明は過去の照会には入れない（当時の状態だと断定できない）。
 */
export function answersQuery(entry, query, options = {}) {
    const evaluation = evaluateTime(entry, query);
    if (query.mode === "current") {
        if (evaluation.validity === "current")
            return true;
        return (evaluation.validity === "unknown" &&
            (options.includeUnknownInCurrent ?? true));
    }
    const known = query.basis === "valid_then" || !evaluation.recordedAfterTarget;
    if (evaluation.validity === "unknown")
        return options.includeUnknownInAt === true && known;
    return evaluation.validity === "current" && known;
}
