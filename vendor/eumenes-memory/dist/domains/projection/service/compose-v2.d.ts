import type { AccessContext, SourceRef } from "../../../contracts/types.ts";
import type { MemoryItemV2, ReadyMemoryViewV2, SnapshotV2, ViewCoverageV2, ViewEvidence } from "../../../contracts/view-v2.ts";
export type ReadyBodyV2 = Omit<ReadyMemoryViewV2, "viewDigest">;
/** 全結果共通の header（schemaVersion 2）。値の出所は v1 と同じ。 */
export declare function composeHeaderV2(access: AccessContext, snapshot: SnapshotV2): {
    schemaVersion: 2;
    principal: string;
    scopeKey: string;
    purpose: string;
    stateRevision: string;
    policyRevision: string;
    instructionAuthority: "none";
};
/**
 * view に入る item の集合: status が active で、subject が self（省略は self）のもの。id 昇順。
 * `other:*` / `unknown` は build が除外し、coverage にも数えない。
 */
export declare function eligibleItemsV2(snapshot: SnapshotV2): MemoryItemV2[];
export declare function cloneRef(ref: SourceRef): SourceRef;
export declare function cloneEvidence(entry: ViewEvidence): ViewEvidence;
/** evidence 予算の単位: 1 件の canonical JSON の UTF-8 byte 長。 */
export declare function evidenceEntryBytes(entry: ViewEvidence): number;
/**
 * ready 本体（viewDigest を除く）を新規構築する。items は検査済みの eligible item（id 昇順）、
 * evidence と coverage は呼び出し側が決めたもの。依存検査・予算判定はしない。
 * dependencies は item の依存と evidence の出典を range なしで出典単位に重複排除したもの。
 */
export declare function composeReadyBodyV2(access: AccessContext, snapshot: SnapshotV2, eligible: readonly MemoryItemV2[], evidence: readonly ViewEvidence[], coverage: ViewCoverageV2): ReadyBodyV2;
