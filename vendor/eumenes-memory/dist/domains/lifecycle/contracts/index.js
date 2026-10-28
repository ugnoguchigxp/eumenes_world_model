export const LIMITS_LIFECYCLE = Object.freeze({
    /** ジャーナル entry の targets 件数上限。 */
    maxJournalTargets: 64,
    /** reconcile / verify に渡せる entry 数。 */
    maxJournalEntries: 100000,
    maxProviderRefBytes: 64,
    maxExternalIdBytes: 256,
});
export const JOURNAL_FORMAT = 1;
/** ジャーナルの先頭 entry の `prevHash`、および DB の初期 head hash（SHA-256 hex 長の 0 埋め）。 */
export const GENESIS_JOURNAL_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
export const FORGET_TARGET_TYPES = Object.freeze([
    "record",
    "host_source",
    "state_item",
    "scope",
]);
import { DEPENDENCY_ROLES, DEPENDENT_NODE_TYPES, DEPENDENCY_NODE_TYPES, TOMBSTONE_TARGET_TYPES, } from "../../../contracts/dependency.js";
export { DEPENDENCY_ROLES, DEPENDENT_NODE_TYPES, DEPENDENCY_NODE_TYPES, TOMBSTONE_TARGET_TYPES, };
/**
 * 外部削除の確認状況。外部に送った／外部が派生させたデータの削除は Memory からは確認できない。
 * 確認手段がなければホストが `unverified` を記録する（完了とは言わない）。
 */
export const EXTERNAL_DELETION_STATES = Object.freeze([
    "pending",
    "unverified",
    "confirmed",
    "failed",
]);
/**
 * ForgetReceipt.external の集約値: 外部削除が無ければ `none`。あれば
 * any failed → `failed`、any pending → `pending`、any unverified → `unverified`、全 confirmed → `confirmed`。
 */
export const FORGET_EXTERNAL_STATES = Object.freeze([
    "none",
    ...EXTERNAL_DELETION_STATES,
]);
export const JOURNAL_REASON_CODES = Object.freeze([
    "JOURNAL_TRUNCATED",
    "JOURNAL_CHAIN_BROKEN",
    "JOURNAL_MISSING",
]);
