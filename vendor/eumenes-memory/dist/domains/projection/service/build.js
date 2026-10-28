import { deepFreeze } from "../../../canonical/freeze.js";
import { compareCodeUnits } from "../../../canonical/compare.js";
import { parseBuildMemoryViewInput } from "../../../contracts/parse-input.js";
import { checkAccess } from "./access-check.js";
import { composeHeader, composeReadyBody } from "./compose.js";
import { checkDependencies } from "./dependency-check.js";
import { finalizeReadyView } from "./digest.js";
/**
 * 判定順（設計書 §2.2）: parse → disabled → access → 依存検査 → 構成 → 予算。
 * 入力は変更せず、戻り値は新規構築の deep-frozen。
 */
export function buildMemoryView(input) {
    const { access, snapshot, maxBytes, enabled } = parseBuildMemoryViewInput(input);
    const header = composeHeader(access, snapshot);
    if (!enabled) {
        const view = {
            ...header,
            status: "disabled",
            reasonCode: "MEMORY_DISABLED",
        };
        return deepFreeze(view);
    }
    const accessReason = checkAccess(access, snapshot);
    if (accessReason !== null) {
        const view = {
            ...header,
            status: "blocked",
            reasonCode: accessReason,
        };
        return deepFreeze(view);
    }
    const activeItems = snapshot.items
        .filter((item) => item.status === "active")
        .sort((a, b) => compareCodeUnits(a.id, b.id));
    const sourceReason = checkDependencies(activeItems, snapshot);
    if (sourceReason !== null) {
        const view = {
            ...header,
            status: "blocked",
            reasonCode: sourceReason,
        };
        return deepFreeze(view);
    }
    const { view, byteLength } = finalizeReadyView(composeReadyBody(access, snapshot));
    if (byteLength > maxBytes) {
        const overflow = {
            ...header,
            status: "overflow",
            reasonCode: "BUDGET_EXCEEDED",
        };
        return deepFreeze(overflow);
    }
    return deepFreeze(view);
}
