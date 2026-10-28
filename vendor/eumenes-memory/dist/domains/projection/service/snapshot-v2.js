import { sourceKey } from "./source-ref.js";
/** 同じ出典が複数の読み出しに現れたときの優先順位。大きいほど優先する（安全側に倒す）。 */
const STATUS_SEVERITY = {
    available: 0,
    changed: 1,
    missing: 2,
    forgotten: 3,
};
function mergeSources(parts) {
    const merged = new Map();
    for (const part of parts) {
        for (const state of part) {
            const key = sourceKey(state);
            const known = merged.get(key);
            if (known === undefined ||
                STATUS_SEVERITY[state.status] > STATUS_SEVERITY[known.status]) {
                merged.set(key, state);
            }
        }
    }
    return [...merged.values()];
}
/**
 * Continuity 側と Memory 側の部品を View v2 の入力 `SnapshotV2` に合成する純粋関数（DB は読まない）。
 * - `stateRevision` = `"c:" + continuity.revision + "|m:" + memory.memoryRevision`（Continuity なしは `c:` 部が空）。
 *   本体はこの文字列を不透明に比較するだけで、規則の正本は M1 アダプター（設計書 §3.4）。この関数は参照実装。
 * - items は連結（id の重複は parse が `DUPLICATE_ITEM_ID` で拒否する）。
 * - 件数の上限は検査しない。items が `LIMITS.maxItems`、sources が `LIMITS.maxSources` を超える snapshot は
 *   `buildMemoryViewV2` が（例外ではなく）`overflow` / `BUDGET_EXCEEDED` で返す。
 * - sources は出典単位に統合する。同じ出典で状態が食い違うとき（item の依存の版と evidence の版が違う等）は、
 *   より悪い状態（forgotten > missing > changed > available）を残す。入力の並びには依存しない。
 */
export function composeSnapshotV2(input) {
    const continuity = input.continuity;
    const items = [
        ...(continuity?.items ?? []),
        ...input.memory.items,
    ];
    const sources = mergeSources([
        continuity?.sources ?? [],
        input.memory.sources,
        input.evidenceSources ?? [],
    ]);
    return {
        principal: input.principal,
        scopeKey: input.scopeKey,
        stateRevision: `c:${continuity?.revision ?? ""}|m:${input.memory.memoryRevision}`,
        policyRevision: input.policyRevision,
        complete: input.complete,
        sources,
        items,
    };
}
