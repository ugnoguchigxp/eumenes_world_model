import type { SourceRef } from "../../../contracts/types.ts";
export { sourceKey } from "../../../contracts/source-key.ts";
/**
 * namespace → kind → id → representation（不在 < 存在）→ revision → digest →
 * range（不在 < 存在、startByte → endByte）。range を持たない SourceDependency も可。
 */
export declare function compareSourceRef(a: Omit<SourceRef, "range"> & {
    readonly range?: SourceRef["range"];
}, b: Omit<SourceRef, "range"> & {
    readonly range?: SourceRef["range"];
}): number;
