/**
 * 契約版の一覧（full-system-design §1.3）。
 * - `SCHEMA_VERSION`（= 1）は M0 view 契約の版として凍結。
 * - family 入力の `contractVersion` は family ごとの版。未知版は `UNSUPPORTED_SCHEMA_VERSION`。
 * - DB スキーマ版 `MEMORY_DB_SCHEMA_VERSION`（`./sqlite`）は契約版と独立。
 *
 * world / consolidation はこの repo では作らない（別ドメイン・別 repo）。
 */
export declare const CONTRACT_VERSIONS: Readonly<{
    readonly records: 1;
    readonly recall: 1;
    readonly state: 1;
    readonly extraction: 1;
    readonly lifecycle: 1;
    /** ExternalDependent の登録と変更フィード（`listMemoryChanges`）。 */
    readonly external: 1;
}>;
/** view の schemaVersion。1 は M0 凍結、2 は View v2（evidence 付き、State kind 追加）。 */
export declare const VIEW_SCHEMA_VERSIONS: readonly [1, 2];
export type ViewSchemaVersion = (typeof VIEW_SCHEMA_VERSIONS)[number];
