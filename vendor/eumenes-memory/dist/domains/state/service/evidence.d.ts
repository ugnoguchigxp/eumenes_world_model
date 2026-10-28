import type { EvidenceSpan } from "../../../contracts/common.ts";
import type { HostSourceState } from "../contracts/index.ts";
import type { SourceRef, SourceState } from "../../../contracts/types.ts";
export type EvidenceFailure = "QUOTE_MISMATCH" | "EVIDENCE_NOT_IN_INPUT" | "SOURCE_STALE";
/** 本文つきの入力出典（`HostSourceState` / `ExtractionSource` の共通部分）。 */
export type EvidenceInputSource = HostSourceState;
export interface EvidenceCheckInput {
    readonly principal: string;
    readonly scopeKey: string;
    readonly evidence: readonly EvidenceSpan[];
    /** モデル／ホストが実際に見た本文つきの出典。 */
    readonly inputSources: readonly EvidenceInputSource[];
    /** 検査時点の出典の現在状態。明示操作では `inputSources` と同じ。 */
    readonly currentSources: readonly SourceState[];
}
/** evidence の出典に対応する入力出典。SourceKey・revision・digest・principal・scope が全部一致するものだけ。 */
export declare function findInputSource<T extends EvidenceInputSource>(ref: SourceRef, principal: string, scopeKey: string, inputSources: readonly T[]): T | undefined;
/** range の bytes が quote と完全に一致するか（range 必須・文字境界・範囲内）。 */
export declare function quoteMatches(content: string, span: EvidenceSpan): boolean;
/** 失敗しなければ null。最初に当たったものを返す（上記の順）。 */
export declare function checkEvidence(input: EvidenceCheckInput): EvidenceFailure | null;
/**
 * evidence の根拠順位 = 対応する入力出典の `ordinal` の最大。入力に対応する出典がなければ null。
 * 新旧比較（OLDER_EVIDENCE / supersede / dispute）に使う。
 */
export declare function evidenceOrdinalOf(input: Pick<EvidenceCheckInput, "principal" | "scopeKey" | "evidence" | "inputSources">): number | null;
/**
 * quote が括弧（「」『』“” と ASCII の二重引用符）の中にあるか。次のどちらかなら true（保守的に pending_user へ送る側）:
 * (a) quote 自身が開き括弧で始まり対応する閉じ括弧で終わる、(b) 出典本文で range の開始位置が未閉じの開き括弧の内側
 * （ASCII の二重引用符は出現回数の偶奇）。本文の bytes を走査するだけで、文字列にデコードしない。
 */
export declare function isQuotedSpan(content: string, span: EvidenceSpan): boolean;
