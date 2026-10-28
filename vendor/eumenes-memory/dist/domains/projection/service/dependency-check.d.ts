import type { SourceReasonCode } from "../../../contracts/reason-codes.ts";
import type { Snapshot, SourceRef, SourceState } from "../../../contracts/types.ts";
export declare function indexSources(sources: readonly SourceState[]): ReadonlyMap<string, SourceState>;
type SnapshotSources = Pick<Snapshot, "principal" | "scopeKey" | "sources">;
/**
 * active item の依存検査（build 3a–3k / validate V7 共通）。
 * items は呼び出し側が id 順で渡す。各 item の dependencies は SourceRef 順に
 * 並べ替えて走査するので入力順に依存しない。最初の失敗の reasonCode を返す。
 */
export declare function checkDependencies(items: readonly {
    readonly dependencies: readonly SourceRef[];
}[], snapshot: SnapshotSources): SourceReasonCode | null;
/**
 * v2 の依存検査。item の依存を先に、続けて evidence の出典を SourceRef 順に検査する。
 * 規則は v1 と同じ（判定順も同じ）。違いは Memory 所有の出典の range に content を要求しない点だけ。
 */
export declare function checkItemsAndEvidence(items: readonly {
    readonly dependencies: readonly SourceRef[];
}[], evidenceRefs: readonly SourceRef[], snapshot: SnapshotSources): SourceReasonCode | null;
export {};
