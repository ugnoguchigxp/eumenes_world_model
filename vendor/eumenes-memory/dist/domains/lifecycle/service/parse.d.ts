import type { ApplyForgetInput, ForgetJournalEntry, GetForgetReceiptInput, PlanForgetInput, ReconcileForgetJournalInput } from "../contracts/index.ts";
export declare function parsePlanForgetInput(value: unknown): PlanForgetInput;
/** entry の形だけを検査する（hash・鎖の整合は journal.ts の `isSelfConsistent`）。 */
export declare function readJournalEntry(value: unknown, path: string): ForgetJournalEntry;
export declare function parseApplyForgetInput(value: unknown): ApplyForgetInput;
/**
 * entries は配列であることと件数だけを検査し、要素は未検査のまま返す（壊れた entry は reconcile が
 * `inconsistent` として報告する。例外にしない）。
 */
export interface ParsedReconcileInput {
    readonly contractVersion: ReconcileForgetJournalInput["contractVersion"];
    readonly entries: readonly unknown[];
    readonly clock: ReconcileForgetJournalInput["clock"];
}
export declare function parseReconcileForgetJournalInput(value: unknown): ParsedReconcileInput;
export declare function parseGetForgetReceiptInput(value: unknown): GetForgetReceiptInput;
