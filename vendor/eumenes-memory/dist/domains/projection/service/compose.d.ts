import type { AccessContext, ReadyMemoryView, Snapshot } from "../../../contracts/types.ts";
export type ReadyBody = Omit<ReadyMemoryView, "viewDigest">;
/** 全結果共通の header。値の出所は設計書 §1.3 / D4。 */
export declare function composeHeader(access: AccessContext, snapshot: Snapshot): {
    schemaVersion: 1;
    principal: string;
    scopeKey: string;
    purpose: string;
    stateRevision: string;
    policyRevision: string;
    instructionAuthority: "none";
};
/**
 * active item だけで ready 本体（viewDigest を除く）を新規構築する。
 * 依存検査済みの入力を前提とし、予算判定はしない。入力とは参照を共有しない。
 */
export declare function composeReadyBody(access: AccessContext, snapshot: Snapshot): ReadyBody;
