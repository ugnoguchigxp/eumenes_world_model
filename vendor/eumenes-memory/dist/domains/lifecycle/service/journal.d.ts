import type { ForgetJournalEntry, ForgetJournalTarget, VerifyForgetJournalResult } from "../contracts/index.ts";
/** (type, scopeKey, id) の順に整列し、重複を除く。 */
export declare function canonicalizeTargets(targets: readonly ForgetJournalTarget[]): readonly ForgetJournalTarget[];
export declare function computeForgetId(principal: string, seq: number, targets: readonly ForgetJournalTarget[]): string;
export declare function computeEntryHash(entry: Omit<ForgetJournalEntry, "hash">): string;
/** DB の head の次に載る entry を作る。targets は整列・重複除去される。 */
export declare function buildJournalEntry(args: {
    readonly seq: number;
    readonly prevHash: string;
    readonly principal: string;
    readonly targets: readonly ForgetJournalTarget[];
}): ForgetJournalEntry;
/**
 * entry 単体の整合: 形、整列済み・重複なしの targets、forgetId と hash の再計算が一致すること。
 * 壊れた入力（欠けたキー、型違い）でも例外を投げず false を返す。
 */
export declare function isSelfConsistent(entry: unknown): entry is ForgetJournalEntry;
/**
 * ジャーナル全体の鎖検証（環境依存なし）。seq は 1 始まりで連続、先頭の prevHash は `GENESIS_JOURNAL_HASH`、
 * 各 entry は自己整合で `prevHash` が直前の `hash` と一致すること。切り詰め・欠落（DB との比較が要る）は
 * `reconcileForgetJournal` だけが検出する。空のジャーナルは `ok`（head は null）。
 */
export declare function verifyForgetJournal(entries: readonly ForgetJournalEntry[]): VerifyForgetJournalResult;
