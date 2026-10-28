import type { ClosureEdge, ClosureNodeRef } from "../contracts/index.ts";
export interface Closure {
    /** 起点を除く、閉包内の node（型 → id の UTF-16 コード単位順）。 */
    readonly nodes: readonly ClosureNodeRef[];
    /** node 種別ごとの件数（起点を除く）。 */
    readonly counts: Readonly<Record<string, number>>;
}
export declare function computeClosure(edges: readonly ClosureEdge[], starts: readonly ClosureNodeRef[]): Closure;
