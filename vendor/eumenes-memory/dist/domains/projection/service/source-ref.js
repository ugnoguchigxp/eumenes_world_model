import { compareCodeUnits } from "../../../canonical/compare.js";
import { ownValue } from "../../../contracts/own.js";
export { sourceKey } from "../../../contracts/source-key.js";
function compareOptionalString(a, b) {
    if (a === undefined)
        return b === undefined ? 0 : -1;
    if (b === undefined)
        return 1;
    return compareCodeUnits(a, b);
}
function compareNumber(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
/**
 * namespace → kind → id → representation（不在 < 存在）→ revision → digest →
 * range（不在 < 存在、startByte → endByte）。range を持たない SourceDependency も可。
 */
export function compareSourceRef(a, b) {
    return (compareCodeUnits(a.namespace, b.namespace) ||
        compareCodeUnits(a.kind, b.kind) ||
        compareCodeUnits(a.id, b.id) ||
        compareOptionalString(ownValue(a, "representation"), ownValue(b, "representation")) ||
        compareCodeUnits(a.revision, b.revision) ||
        compareCodeUnits(a.digest, b.digest) ||
        compareRange(ownValue(a, "range"), ownValue(b, "range")));
}
function compareRange(a, b) {
    if (a === undefined)
        return b === undefined ? 0 : -1;
    if (b === undefined)
        return 1;
    return (compareNumber(a.startByte, b.startByte) ||
        compareNumber(a.endByte, b.endByte));
}
