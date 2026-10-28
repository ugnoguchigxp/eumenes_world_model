/**
 * View v2（schemaVersion 2）の parse。v1 の parse（parse-input.ts / parse-view.ts）は変更せず、
 * 共通部品（出典・access・snapshot の骨格・header）だけを再利用する。
 * 入力は読むだけで、検査済みの新しい deep-frozen オブジェクトを返す。
 */
import { deepFreeze } from "../../../canonical/freeze.js";
import { LIMITS } from "../../../contracts/constants.js";
import { checkDependencies, readAccessContext, readSnapshotWith, readSourceRef, assertUniqueItemIds, } from "../../../contracts/parse-input.js";
import { reasonAllowedFor, readSourceDependency, readViewHeader, } from "../../../contracts/parse-view.js";
import { BUILD_V2_REASON_CODES, ITEM_KINDS_V2, ITEM_ORIGINS_V2, LIMITS_VIEW_V2, } from "../../../contracts/view-v2.js";
import { LIMITS_STATE } from "../../state/contracts/index.js";
import { checkKeys, fail, indexPath, keyPath, readArray, readBoolean, readDigest, readEnum, readIdentifier, readItemId, readRecord, readSafeInteger, readText, requiredField, } from "../../../contracts/reader.js";
import { sourceKey } from "../../../contracts/source-key.js";
import { ownValue } from "../../../contracts/own.js";
/** v2 の schemaVersion 判別。トップレベルのみ、最初に検査する。 */
function checkSchemaVersionV2(record, path) {
    const field = keyPath(path, "schemaVersion");
    const value = requiredField(record, path, "schemaVersion");
    if (typeof value !== "number")
        return fail("INVALID_TYPE", field);
    if (!Number.isSafeInteger(value))
        return fail("INVALID_INTEGER", field);
    if (value !== 2)
        return fail("UNSUPPORTED_SCHEMA_VERSION", field);
}
// ---- item ----
const ITEM_KEYS_V2 = [
    "id",
    "revision",
    "kind",
    "text",
    "status",
    "origin",
    "primarySource",
    "dependencies",
];
function readSubject(value, path) {
    const text = readIdentifier(value, path, LIMITS_STATE.maxSubjectBytes);
    if (text === "self" || text === "unknown")
        return text;
    if (text.startsWith("other:") && text.length > "other:".length) {
        return text;
    }
    return fail("INVALID_VALUE", path);
}
/** snapshot の MemoryItemV2（subject 任意）と view の ViewItemV2（subject なし）で共通。 */
function readItemV2(value, path, statuses, allowSubject) {
    const record = readRecord(value, path);
    checkKeys(record, path, allowSubject ? [...ITEM_KEYS_V2, "subject"] : ITEM_KEYS_V2);
    const id = readItemId(requiredField(record, path, "id"), keyPath(path, "id"), LIMITS.maxItemIdBytes, LIMITS.maxNamespaceBytes);
    const revision = readIdentifier(requiredField(record, path, "revision"), keyPath(path, "revision"), LIMITS.maxRevisionBytes);
    const kind = readEnum(requiredField(record, path, "kind"), keyPath(path, "kind"), ITEM_KINDS_V2);
    const text = readText(requiredField(record, path, "text"), keyPath(path, "text"), LIMITS.maxItemTextBytes, false);
    const status = readEnum(requiredField(record, path, "status"), keyPath(path, "status"), statuses);
    const origin = readEnum(requiredField(record, path, "origin"), keyPath(path, "origin"), ITEM_ORIGINS_V2);
    const primarySource = readSourceRef(requiredField(record, path, "primarySource"), keyPath(path, "primarySource"));
    const dependenciesPath = keyPath(path, "dependencies");
    const dependencies = readArray(requiredField(record, path, "dependencies"), dependenciesPath, LIMITS.maxDependenciesPerItem).map((element, index) => readSourceRef(element, indexPath(dependenciesPath, index)));
    checkDependencies(dependencies, primarySource, dependenciesPath, path);
    const subject = allowSubject && Object.hasOwn(record, "subject")
        ? readSubject(record["subject"], keyPath(path, "subject"))
        : undefined;
    return {
        id,
        revision,
        kind,
        text,
        status,
        origin,
        primarySource,
        dependencies,
        ...(subject === undefined ? {} : { subject }),
    };
}
// ---- evidence ----
function readEvidenceCommon(record, path) {
    const ref = readSourceRef(requiredField(record, path, "ref"), keyPath(path, "ref"));
    const snippet = readText(requiredField(record, path, "snippet"), keyPath(path, "snippet"), LIMITS_VIEW_V2.maxEvidenceSnippetBytes, false);
    readEnum(requiredField(record, path, "authority"), keyPath(path, "authority"), ["evidence_candidate"]);
    return { ref, snippet };
}
function evidenceIdentity(ref) {
    const range = ownValue(ref, "range");
    return JSON.stringify([
        sourceKey(ref),
        ref.revision,
        ref.digest,
        range === undefined ? null : [range.startByte, range.endByte],
    ]);
}
function readEvidenceInput(value, path, scopeKey) {
    const record = readRecord(value, path);
    checkKeys(record, path, ["hits", "maxEvidenceBytes"]);
    const hitsPath = keyPath(path, "hits");
    const hits = readArray(requiredField(record, path, "hits"), hitsPath, LIMITS_VIEW_V2.maxEvidenceHits).map((element, index) => {
        const hitPath = indexPath(hitsPath, index);
        const hit = readRecord(element, hitPath);
        checkKeys(hit, hitPath, ["ref", "scopeKey", "snippet", "authority"]);
        const common = readEvidenceCommon(hit, hitPath);
        const hitScope = readIdentifier(requiredField(hit, hitPath, "scopeKey"), keyPath(hitPath, "scopeKey"), LIMITS.maxScopeKeyBytes);
        if (hitScope !== scopeKey) {
            return fail("INVALID_VALUE", keyPath(hitPath, "scopeKey"));
        }
        return {
            ref: common.ref,
            scopeKey: hitScope,
            snippet: common.snippet,
            authority: "evidence_candidate",
        };
    });
    const maxEvidenceBytes = readSafeInteger(requiredField(record, path, "maxEvidenceBytes"), keyPath(path, "maxEvidenceBytes"), 0, LIMITS_VIEW_V2.maxEvidenceBytes);
    return { hits, maxEvidenceBytes };
}
// ---- snapshot ----
function readSnapshotV2(value, path) {
    return readSnapshotWith(value, path, (element, itemPath) => readItemV2(element, itemPath, ["active", "inactive"], true));
}
// ---- 公開 parse ----
export function parseBuildMemoryViewInputV2(value) {
    const path = "$";
    const record = readRecord(value, path);
    checkSchemaVersionV2(record, path);
    checkKeys(record, path, [
        "schemaVersion",
        "access",
        "snapshot",
        "maxBytes",
        "enabled",
        "evidence",
    ]);
    const access = readAccessContext(requiredField(record, path, "access"), keyPath(path, "access"));
    const snapshot = readSnapshotV2(requiredField(record, path, "snapshot"), keyPath(path, "snapshot"));
    const maxBytes = readSafeInteger(requiredField(record, path, "maxBytes"), keyPath(path, "maxBytes"), 0, Number.MAX_SAFE_INTEGER);
    const enabled = readBoolean(requiredField(record, path, "enabled"), keyPath(path, "enabled"));
    const evidence = Object.hasOwn(record, "evidence")
        ? readEvidenceInput(record["evidence"], keyPath(path, "evidence"), snapshot.scopeKey)
        : undefined;
    return deepFreeze({
        schemaVersion: 2,
        access,
        snapshot,
        maxBytes,
        enabled,
        ...(evidence === undefined ? {} : { evidence }),
    });
}
export function parseValidationCurrentV2(value) {
    const path = "$";
    const record = readRecord(value, path);
    checkSchemaVersionV2(record, path);
    checkKeys(record, path, ["schemaVersion", "access", "snapshot"]);
    const access = readAccessContext(requiredField(record, path, "access"), keyPath(path, "access"));
    const snapshot = readSnapshotV2(requiredField(record, path, "snapshot"), keyPath(path, "snapshot"));
    return deepFreeze({ schemaVersion: 2, access, snapshot });
}
// ---- view ----
const VIEW_STATUSES = ["ready", "blocked", "overflow", "disabled"];
const HEADER_KEYS = [
    "schemaVersion",
    "status",
    "principal",
    "scopeKey",
    "purpose",
    "stateRevision",
    "policyRevision",
    "instructionAuthority",
];
const READY_KEYS = [
    ...HEADER_KEYS,
    "items",
    "evidence",
    "dependencies",
    "coverage",
    "viewDigest",
];
const REASON_KEYS = [...HEADER_KEYS, "reasonCode"];
function readCoverageV2(value, path) {
    const record = readRecord(value, path);
    checkKeys(record, path, ["complete", "omitted"]);
    const complete = readBoolean(requiredField(record, path, "complete"), keyPath(path, "complete"));
    const omittedPath = keyPath(path, "omitted");
    const omitted = readArray(requiredField(record, path, "omitted"), omittedPath, LIMITS_VIEW_V2.maxCoverageOmitted).map((element, index) => {
        const entryPath = indexPath(omittedPath, index);
        const entry = readRecord(element, entryPath);
        checkKeys(entry, entryPath, ["type", "count"]);
        readEnum(requiredField(entry, entryPath, "type"), keyPath(entryPath, "type"), ["evidence"]);
        const count = readSafeInteger(requiredField(entry, entryPath, "count"), keyPath(entryPath, "count"), 1, LIMITS_VIEW_V2.maxEvidenceHits);
        return { type: "evidence", count };
    });
    // complete は omitted が空であることと同値。evidence の omitted は 1 要素まで。
    if (complete !== (omitted.length === 0) || omitted.length > 1) {
        return fail("INVALID_VALUE", path);
    }
    return { complete, omitted };
}
export function parseMemoryViewV2(value) {
    const path = "$";
    const record = readRecord(value, path);
    checkSchemaVersionV2(record, path);
    const status = readEnum(requiredField(record, path, "status"), keyPath(path, "status"), VIEW_STATUSES);
    checkKeys(record, path, status === "ready" ? READY_KEYS : REASON_KEYS);
    const header = { ...readViewHeader(record, path), schemaVersion: 2 };
    if (status !== "ready") {
        const reasonCode = readEnum(requiredField(record, path, "reasonCode"), keyPath(path, "reasonCode"), BUILD_V2_REASON_CODES);
        if (!reasonAllowedFor(status, reasonCode)) {
            return fail("INVALID_VALUE", keyPath(path, "reasonCode"));
        }
        return deepFreeze({ ...header, status, reasonCode });
    }
    const itemsPath = keyPath(path, "items");
    const items = readArray(requiredField(record, path, "items"), itemsPath, LIMITS.maxItems).map((element, index) => {
        const item = readItemV2(element, indexPath(itemsPath, index), ["active"], false);
        const { subject: _subject, ...rest } = item;
        return { ...rest, status: "active" };
    });
    assertUniqueItemIds(items, itemsPath);
    const evidencePath = keyPath(path, "evidence");
    const evidence = readArray(requiredField(record, path, "evidence"), evidencePath, LIMITS_VIEW_V2.maxEvidenceHits).map((element, index) => {
        const entryPath = indexPath(evidencePath, index);
        const entry = readRecord(element, entryPath);
        checkKeys(entry, entryPath, ["ref", "snippet", "authority"]);
        const common = readEvidenceCommon(entry, entryPath);
        return {
            ref: common.ref,
            snippet: common.snippet,
            authority: "evidence_candidate",
        };
    });
    const identities = new Set();
    for (const [index, entry] of evidence.entries()) {
        const identity = evidenceIdentity(entry.ref);
        if (identities.has(identity)) {
            return fail("DUPLICATE_SOURCE", indexPath(evidencePath, index));
        }
        identities.add(identity);
    }
    const dependenciesPath = keyPath(path, "dependencies");
    const dependencies = readArray(requiredField(record, path, "dependencies"), dependenciesPath, LIMITS.maxSources).map((element, index) => readSourceDependency(element, indexPath(dependenciesPath, index)));
    const seen = new Set();
    for (const [index, dependency] of dependencies.entries()) {
        const key = JSON.stringify([
            sourceKey(dependency),
            dependency.revision,
            dependency.digest,
        ]);
        if (seen.has(key)) {
            return fail("DUPLICATE_SOURCE", indexPath(dependenciesPath, index));
        }
        seen.add(key);
    }
    const coverage = readCoverageV2(requiredField(record, path, "coverage"), keyPath(path, "coverage"));
    const viewDigest = readDigest(requiredField(record, path, "viewDigest"), keyPath(path, "viewDigest"));
    return deepFreeze({
        ...header,
        status,
        items,
        evidence,
        dependencies,
        coverage,
        viewDigest,
    });
}
