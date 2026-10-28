import type { BuildMemoryViewInputV2, MemoryViewV2 } from "../../../contracts/view-v2.ts";
/**
 * View v2 の build（full-system-design §3.4）。判定順: parse → disabled → access → 依存検査
 * （eligible item → evidence の出典）→ 必須構成の予算（超過は overflow）→ evidence の充填。
 * snapshot の items が `LIMITS.maxItems`、sources が `LIMITS.maxSources` を超えるときは（例外にせず）`overflow`
 * （`BUDGET_EXCEEDED`）。disabled / blocked の判定は先に行う。
 * evidence は検索順位の先頭から、evidence 予算（`maxEvidenceBytes`）と全体予算（`maxBytes`）に入る
 * 限りの先頭 prefix だけを載せ、残りは `coverage.omitted` に数える（必須超過とは別）。
 * 入力は変更せず、戻り値は新規構築の deep-frozen。DB は読まない。
 */
export declare function buildMemoryViewV2(input: BuildMemoryViewInputV2): MemoryViewV2;
