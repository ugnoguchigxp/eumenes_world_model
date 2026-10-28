export const LIMITS_EXTERNAL = Object.freeze({
    maxProviderRefBytes: 64,
    maxExternalIdBytes: 256,
    /** 1 つの dependent が持てる依存先の数（M0 の LIMITS.maxDependenciesPerItem と同じ）。 */
    maxDependenciesPerDependent: 32,
    maxDependentsPerCall: 256,
    minChangesPerPage: 1,
    maxChangesPerPage: 500,
});
/** 外部派生物が依存できる本体の対象。`source` の id は SourceKey（Records の出典も会話の出典も同じ形）。 */
export const EXTERNAL_DEPENDENCY_TYPES = Object.freeze([
    "source",
    "state_item",
]);
export const EXTERNAL_REJECTED_REASON_CODES = Object.freeze([
    /** 依存先が忘却済み（墓標あり）。忘却済みのものから新たに派生させない。 */
    "TOMBSTONED",
    /** `state_item` の依存先が存在しない（この principal / scope のものでない場合を含む）。 */
    "DEPENDENCY_MISSING",
    /** 同じ `(providerRef, externalId)` が別の principal / scope で登録済み（置き換えは同じ scope の中だけ）。 */
    "EXTERNAL_ID_IN_USE",
]);
// ---- 変更フィード ----
/** フィードに載る対象。`source` は忘却された host_source（SourceKey）の通知専用。 */
export const MEMORY_CHANGE_TARGET_TYPES = Object.freeze([
    "record",
    "state_item",
    "source",
]);
/**
 * 変更後の状態。record は active / inactive / forgotten、state_item は state の全 status、
 * source は forgotten のみ。
 */
export const MEMORY_CHANGE_STATUSES = Object.freeze([
    "active",
    "inactive",
    "superseded",
    "disputed",
    "retracted",
    "invalidated",
    "forgotten",
]);
