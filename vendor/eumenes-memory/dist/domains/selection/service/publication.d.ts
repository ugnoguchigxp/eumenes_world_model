import type { Checkpoint, PublicVersion, PublicationDecision, PublicationInput } from "../contracts/index.ts";
/** 公開版を作る。manifest は ID の順に整列し、同じ内容は同じ versionId になる（原文の追記で作り直さない）。 */
export declare function buildPublicVersion(input: {
    readonly manifest: readonly {
        readonly itemId: string;
        readonly revision: string;
    }[];
    readonly policyRevision: string;
    readonly publishedSeq: number;
}): PublicVersion;
/**
 * 公開の安定性より、訂正・否定・忘却・認可変更を優先する。肯定的な追加は閾値か区切りまで待てる。
 * 公開済みの版より新しい変更（seq）だけを見る。
 */
export declare function decidePublication(input: PublicationInput): PublicationDecision;
export type CheckpointProblem = "MODEL_SUMMARY_WITHOUT_RANGES" | "BAD_RANGE" | "LOST_UNRESOLVED" | "LOST_DECISION" | "BOUNDARY_REGRESSED" | "TOPIC_MISMATCH" | "BAD_ORIGIN";
/**
 * 継続情報の検査。モデル要約は原典範囲が必須。更新後は未解決事項・決定を失わず（解決・撤回は `resolved` で明示）、
 * 処理境界を戻さない。
 */
export declare function validateCheckpoint(next: Checkpoint, previous: Checkpoint | null, resolved?: readonly string[]): CheckpointProblem[];
