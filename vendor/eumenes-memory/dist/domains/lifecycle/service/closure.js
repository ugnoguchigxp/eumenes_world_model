/**
 * 依存閉包の計算（純粋）。入力は辺のリスト（store が再帰 CTE で起点から集める）。
 * 辺は「dependent が dependency に依存する」。起点から dependency → dependent 方向に推移的に辿る。
 * 循環があっても停止する（訪問済み集合）。引用されなかった入力も `input` 辺として含まれる。
 */
import { compareCodeUnits } from "../../../canonical/compare.js";
function nodeKey(type, id) {
    return `${type}\u0000${id}`;
}
export function computeClosure(edges, starts) {
    const dependentsOf = new Map();
    for (const edge of edges) {
        const key = nodeKey(edge.dependencyType, edge.dependencyId);
        const list = dependentsOf.get(key) ?? [];
        list.push({ type: edge.dependentType, id: edge.dependentId });
        dependentsOf.set(key, list);
    }
    const visited = new Set();
    const queue = [];
    for (const start of starts) {
        const key = nodeKey(start.type, start.id);
        if (!visited.has(key)) {
            visited.add(key);
            queue.push(start);
        }
    }
    const startKeys = new Set(visited);
    const found = [];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor];
        for (const next of dependentsOf.get(nodeKey(current.type, current.id)) ??
            []) {
            const key = nodeKey(next.type, next.id);
            if (visited.has(key))
                continue;
            visited.add(key);
            queue.push(next);
            found.push(next);
        }
    }
    // 起点が dependent としても現れた場合（循環）、起点は結果に入れない。
    const nodes = found
        .filter((node) => !startKeys.has(nodeKey(node.type, node.id)))
        .sort((a, b) => compareCodeUnits(a.type, b.type) || compareCodeUnits(a.id, b.id));
    const counts = {};
    for (const node of nodes)
        counts[node.type] = (counts[node.type] ?? 0) + 1;
    return { nodes, counts };
}
