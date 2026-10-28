import { type Rec } from "./reader.ts";
import type { AccessContext, BuildMemoryViewInput, ItemStatus, MemoryItem, SourceRef, SourceState, ValidationCurrent } from "./types.ts";
/** 出典の同一性 + 版（SourceRef / SourceState / SourceDependency で共通）。 */
export interface SourceCore {
    readonly namespace: string;
    readonly kind: string;
    readonly id: string;
    readonly representation?: string;
    readonly revision: string;
    readonly digest: string;
}
export declare function readSourceCore(record: Rec, path: string): SourceCore;
export declare function readSourceRef(value: unknown, path: string): SourceRef;
/** snapshot の MemoryItem と view の ViewItem で共通（status の許可集合だけ違う）。 */
export declare function readMemoryItem(value: unknown, path: string, statuses: readonly ItemStatus[]): MemoryItem;
export declare function checkDependencies(dependencies: readonly SourceRef[], primarySource: SourceRef, dependenciesPath: string, itemPath: string): void;
export declare function readAccessContext(value: unknown, path: string): AccessContext;
export declare function readSourceState(value: unknown, path: string): SourceState;
/** snapshot の共通部分。items の読み方（v1 / v2 で kind・origin・subject が違う）だけを差し替える。 */
export declare function readSnapshotWith<TItem extends {
    readonly id: string;
}>(value: unknown, path: string, readItem: (element: unknown, itemPath: string) => TItem): {
    readonly principal: string;
    readonly scopeKey: string;
    readonly stateRevision: string;
    readonly policyRevision: string;
    readonly complete: boolean;
    readonly sources: readonly SourceState[];
    readonly items: readonly TItem[];
};
export declare function assertUniqueItemIds(items: readonly {
    readonly id: string;
}[], itemsPath: string): void;
export declare function parseBuildMemoryViewInput(value: unknown): BuildMemoryViewInput;
export declare function parseValidationCurrent(value: unknown): ValidationCurrent;
