import type { BuildMemoryViewInput, MemoryView } from "../../../contracts/types.ts";
/**
 * 判定順（設計書 §2.2）: parse → disabled → access → 依存検査 → 構成 → 予算。
 * 入力は変更せず、戻り値は新規構築の deep-frozen。
 */
export declare function buildMemoryView(input: BuildMemoryViewInput): MemoryView;
