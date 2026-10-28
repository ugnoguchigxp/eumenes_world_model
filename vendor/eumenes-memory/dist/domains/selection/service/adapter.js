import { periodBoundsMs, periodFromStateMs } from "../../temporal/index.js";
const NO_SIGNALS = Object.freeze({
    explicitRef: false,
    termMatches: 0,
    subjectMatch: false,
});
/**
 * State item を選択の候補にする（対象にならない項目は null）。否定の値は view と同じ `NOT: ` を前置する。矛盾の単位は
 * (kind, semanticKey)、値の同一性は (極性, 本文)。精度つきの期間があればそれを、なければ ms の境界を使う。
 */
export function candidateFromStateItem(item, options) {
    // 本人の項目（self）だけ。他者のメモは読み出し側（readMemorySnapshotPart）と同じく選択に入れない。
    if (item.subject !== "self")
        return null;
    const usable = item.status === "active" ||
        (options.historical === true &&
            (item.status === "superseded" || item.status === "inactive"));
    if (!usable)
        return null;
    const ended = item.status !== "active";
    if (ended && options.endedAtMs === undefined)
        return null;
    let period = item.validity ?? periodFromStateMs(item.validFromMs, item.validUntilMs);
    if (ended) {
        // 現在の理解でなくなった時刻で期間を閉じる（既に早く終わる期間ならそのまま）。
        const bounds = period === undefined ? null : periodBoundsMs(period);
        const until = Math.min(bounds?.endMs ?? Number.POSITIVE_INFINITY, options.endedAtMs);
        if (bounds?.startMs != null && until <= bounds.startMs)
            return null;
        period = {
            ...(bounds?.startMs == null ? {} : { fromMs: bounds.startMs }),
            untilMs: until,
            // 元の根拠を保つ（時点不明の期間を、終わりを足したことで「明示された期間」に格上げしない）。
            basis: period?.basis ?? "stated",
        };
    }
    return {
        id: item.itemId,
        revision: String(item.revision),
        scopeKey: item.scopeKey,
        text: `${item.value.polarity === "negated" ? "NOT: " : ""}${item.value.text}`,
        ...(options.requiredReason === undefined
            ? {}
            : { requiredReason: options.requiredReason }),
        duration: options.duration ?? "ongoing",
        ...(options.requestId === undefined
            ? {}
            : { requestId: options.requestId }),
        conflictKey: `${item.subject}:${item.kind}:${item.semanticKey}`,
        valueKey: `${item.value.polarity}:${item.value.text}`,
        ...(options.explicit === undefined ? {} : { explicit: options.explicit }),
        ...(options.exception === undefined
            ? {}
            : { exception: options.exception }),
        recordedAtMs: options.recordedAtMs,
        ...(period === undefined ? {} : { period }),
        signals: options.signals ?? NO_SIGNALS,
        ...(options.stale === undefined ? {} : { stale: options.stale }),
    };
}
/**
 * 認可済み参照を作る。`authorizationRevision` はホストが持つ認可の版（scope の内容の版ではない）。
 * 内容の版（`listStateScopes` の revision）は書き込みのたびに進むので、認可の版として使うと、
 * 同じ scope への無関係な書き込みで回答が失効してしまう。
 */
export function grantFromScope(scope, kind, authorizationRevision) {
    return { scopeKey: scope.scopeKey, kind, revision: authorizationRevision };
}
/** `listStateScopes` の結果のうち、上限で打ち切られた scope があるか（`SelectionInput.retrieval.truncated` に渡す）。 */
export function anyScopeTruncated(scopes) {
    return scopes.some((scope) => scope.truncated);
}
