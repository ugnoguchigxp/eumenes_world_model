/**
 * Extraction 永続 API の入力 parse（純粋）。違反は MemoryContractError（code と path のみ）。
 * 検査済みのコピーを deep-freeze して返す。`settle` の `output` は parse しない（`candidate.ts` が
 * 候補単位／run 単位で扱う）。意味の検査（出典の版、墓標、revision）は store が結果の状態で返す。
 */
import { deepFreeze } from "../../../canonical/freeze.js";
import { utf8ByteLength } from "../../../canonical/utf8.js";
import { LIMITS } from "../../../contracts/constants.js";
import { SOURCE_ROLES } from "../../../contracts/common.js";
import { CANDIDATE_DECISIONS, CONFIRM_ACTIONS, LIMITS_EXTRACTION, } from "../contracts/index.js";
import { readAccessContext, readSourceCore, readSourceState, } from "../../../contracts/parse-input.js";
import { readContractVersion, readHostClock, readScopeKey, } from "../../../contracts/parse-store.js";
import { checkKeys, fail, indexPath, keyPath, readArray, readEnum, readIdentifier, readRecord, readSafeInteger, readText, requiredField, } from "../../../contracts/reader.js";
import { ownValue } from "../../../contracts/own.js";
import { sourceKey } from "../../../contracts/source-key.js";
import { ADMISSION_MODES, STATE_KINDS } from "../../state/contracts/index.js";
import { CONTRACT_VERSIONS } from "../../../contracts/versions.js";
import { assertPredicateDictionary, readStateValue, } from "../../state/index.js";
const SCOPED_WRITE_KEYS = ["contractVersion", "access", "scopeKey", "clock"];
const SCOPED_READ_KEYS = ["contractVersion", "access", "scopeKey"];
function readHeader(record, path) {
    return {
        contractVersion: readContractVersion(record, path, CONTRACT_VERSIONS.extraction),
        access: readAccessContext(requiredField(record, path, "access"), keyPath(path, "access")),
        scopeKey: readScopeKey(requiredField(record, path, "scopeKey"), keyPath(path, "scopeKey")),
    };
}
function readWriteHeader(record, path) {
    return {
        ...readHeader(record, path),
        clock: readHostClock(requiredField(record, path, "clock"), keyPath(path, "clock")),
    };
}
function readRun(value, path) {
    const record = readRecord(value, path);
    checkKeys(record, path, ["jobId", "attempt"]);
    return {
        jobId: readIdentifier(requiredField(record, path, "jobId"), keyPath(path, "jobId"), LIMITS.maxItemIdBytes),
        attempt: readSafeInteger(requiredField(record, path, "attempt"), keyPath(path, "attempt"), 0, Number.MAX_SAFE_INTEGER),
    };
}
function readProfile(value, path) {
    const record = readRecord(value, path);
    checkKeys(record, path, ["extractorId", "promptVersion", "providerRef"]);
    return {
        extractorId: readIdentifier(requiredField(record, path, "extractorId"), keyPath(path, "extractorId"), LIMITS_EXTRACTION.maxExtractorIdBytes),
        promptVersion: readIdentifier(requiredField(record, path, "promptVersion"), keyPath(path, "promptVersion"), LIMITS_EXTRACTION.maxPromptVersionBytes),
        providerRef: readIdentifier(requiredField(record, path, "providerRef"), keyPath(path, "providerRef"), LIMITS_EXTRACTION.maxProviderRefBytes),
    };
}
function readExtractionSources(value, path) {
    const items = readArray(value, path, LIMITS_EXTRACTION.maxSources);
    const sources = [];
    const seen = new Set();
    let total = 0;
    for (const [index, element] of items.entries()) {
        const elementPath = indexPath(path, index);
        const record = readRecord(element, elementPath);
        checkKeys(record, elementPath, [
            "namespace",
            "kind",
            "id",
            "representation",
            "revision",
            "digest",
            "principal",
            "scopeKey",
            "status",
            "content",
            "ordinal",
            "role",
        ]);
        const core = readSourceCore(record, elementPath);
        const principal = readIdentifier(requiredField(record, elementPath, "principal"), keyPath(elementPath, "principal"), LIMITS.maxPrincipalBytes);
        const scopeKey = readScopeKey(requiredField(record, elementPath, "scopeKey"), keyPath(elementPath, "scopeKey"));
        const status = readEnum(requiredField(record, elementPath, "status"), keyPath(elementPath, "status"), ["available", "missing", "changed", "forgotten"]);
        const content = readText(requiredField(record, elementPath, "content"), keyPath(elementPath, "content"), LIMITS.maxSourceContentBytes, true);
        total += utf8ByteLength(content);
        if (total > LIMITS.maxTotalSourceContentBytes) {
            return fail("TOTAL_CONTENT_TOO_LARGE", path);
        }
        const ordinal = readSafeInteger(requiredField(record, elementPath, "ordinal"), keyPath(elementPath, "ordinal"), 0, Number.MAX_SAFE_INTEGER);
        const role = readEnum(requiredField(record, elementPath, "role"), keyPath(elementPath, "role"), SOURCE_ROLES);
        const key = sourceKey(core);
        if (seen.has(key))
            return fail("DUPLICATE_SOURCE", elementPath);
        seen.add(key);
        sources.push({
            ...core,
            principal,
            scopeKey,
            status,
            content,
            ordinal,
            role,
        });
    }
    return sources;
}
export function parsePrepareExtractionInput(value) {
    const path = "$";
    const record = readRecord(value, path);
    checkKeys(record, path, [
        ...SCOPED_WRITE_KEYS,
        "run",
        "enabled",
        "sources",
        "profile",
        "maxInputBytes",
    ]);
    const header = readWriteHeader(record, path);
    const enabled = requiredField(record, path, "enabled");
    if (typeof enabled !== "boolean") {
        return fail("INVALID_TYPE", keyPath(path, "enabled"));
    }
    return deepFreeze({
        ...header,
        run: readRun(requiredField(record, path, "run"), keyPath(path, "run")),
        enabled,
        sources: readExtractionSources(requiredField(record, path, "sources"), keyPath(path, "sources")),
        profile: readProfile(requiredField(record, path, "profile"), keyPath(path, "profile")),
        maxInputBytes: readSafeInteger(requiredField(record, path, "maxInputBytes"), keyPath(path, "maxInputBytes"), 1, LIMITS_EXTRACTION.maxInputBytesCap),
    });
}
function readPolicy(value, path) {
    const record = readRecord(value, path);
    checkKeys(record, path, STATE_KINDS);
    const policy = {};
    for (const kind of STATE_KINDS) {
        const kindPath = keyPath(path, kind);
        const mode = readEnum(requiredField(record, path, kind), kindPath, ADMISSION_MODES);
        // 別人の情報（other_person_note）を自動採用させない。
        if (kind === "other_person_note" && mode === "auto_admit") {
            return fail("INVALID_ENUM", kindPath);
        }
        policy[kind] = mode;
    }
    return policy;
}
export function parseSettleExtractionInput(value) {
    const path = "$";
    const record = readRecord(value, path);
    checkKeys(record, path, [
        ...SCOPED_WRITE_KEYS,
        "run",
        "output",
        "currentSources",
        "policy",
        "keyDictionary",
    ]);
    const header = readWriteHeader(record, path);
    const sourcesPath = keyPath(path, "currentSources");
    const currentSources = readArray(requiredField(record, path, "currentSources"), sourcesPath, LIMITS_EXTRACTION.maxSources).map((element, index) => readSourceState(element, indexPath(sourcesPath, index)));
    const seen = new Set();
    let total = 0;
    for (const [index, source] of currentSources.entries()) {
        const key = sourceKey(source);
        if (seen.has(key)) {
            return fail("DUPLICATE_SOURCE", indexPath(sourcesPath, index));
        }
        seen.add(key);
        total += utf8ByteLength(ownValue(source, "content") ?? "");
        if (total > LIMITS.maxTotalSourceContentBytes) {
            return fail("TOTAL_CONTENT_TOO_LARGE", sourcesPath);
        }
    }
    // output は検査せずそのまま渡す（候補単位の検査は parseExtractionOutput）。
    const output = requiredField(record, path, "output");
    return deepFreezeInput({
        ...header,
        run: readRun(requiredField(record, path, "run"), keyPath(path, "run")),
        output,
        currentSources,
        policy: readPolicy(requiredField(record, path, "policy"), keyPath(path, "policy")),
        ...(Object.hasOwn(record, "keyDictionary")
            ? {
                keyDictionary: readKeyDictionary(record["keyDictionary"], keyPath(path, "keyDictionary")),
            }
            : {}),
    });
}
function readKeyDictionary(value, path) {
    const record = readRecord(value, path);
    checkKeys(record, path, ["version", "predicates"]);
    const predicatesPath = keyPath(path, "predicates");
    const dictionary = {
        version: readIdentifier(requiredField(record, path, "version"), keyPath(path, "version"), 64),
        predicates: readArray(requiredField(record, path, "predicates"), predicatesPath, 256).map((element, index) => {
            const entryPath = indexPath(predicatesPath, index);
            const entry = readRecord(element, entryPath);
            checkKeys(entry, entryPath, ["id", "aliases"]);
            const aliasesPath = keyPath(entryPath, "aliases");
            return {
                id: readIdentifier(requiredField(entry, entryPath, "id"), keyPath(entryPath, "id"), 128),
                aliases: readArray(requiredField(entry, entryPath, "aliases"), aliasesPath, 64).map((alias, aliasIndex) => readIdentifier(alias, indexPath(aliasesPath, aliasIndex), 128)),
            };
        }),
    };
    try {
        assertPredicateDictionary(dictionary);
    }
    catch {
        return fail("INVALID_VALUE", path);
    }
    return dictionary;
}
/** output はホストの値そのもの（freeze しない）。それ以外を freeze する。 */
function deepFreezeInput(input) {
    const { output, ...rest } = input;
    return { ...deepFreeze(rest), output };
}
export function parseListCandidatesInput(value) {
    const path = "$";
    const record = readRecord(value, path);
    checkKeys(record, path, [...SCOPED_READ_KEYS, "decision", "limit"]);
    const header = readHeader(record, path);
    const decision = Object.hasOwn(record, "decision")
        ? readEnum(record["decision"], keyPath(path, "decision"), CANDIDATE_DECISIONS.filter((candidate) => candidate !== "forgotten"))
        : undefined;
    const limit = Object.hasOwn(record, "limit")
        ? readSafeInteger(record["limit"], keyPath(path, "limit"), 1, LIMITS_EXTRACTION.maxListedCandidates)
        : undefined;
    return deepFreeze({
        ...header,
        ...(decision === undefined ? {} : { decision }),
        ...(limit === undefined ? {} : { limit }),
    });
}
export function parseConfirmCandidateInput(value) {
    const path = "$";
    const record = readRecord(value, path);
    checkKeys(record, path, [
        ...SCOPED_WRITE_KEYS,
        "candidateId",
        "action",
        "editedValue",
        "currentSources",
    ]);
    const header = readWriteHeader(record, path);
    const sourcesPath = keyPath(path, "currentSources");
    const currentSources = readArray(requiredField(record, path, "currentSources"), sourcesPath, LIMITS_EXTRACTION.maxSources).map((element, index) => readSourceState(element, indexPath(sourcesPath, index)));
    const editedValue = Object.hasOwn(record, "editedValue")
        ? readStateValue(record["editedValue"], keyPath(path, "editedValue"))
        : undefined;
    const action = readEnum(requiredField(record, path, "action"), keyPath(path, "action"), CONFIRM_ACTIONS);
    if (editedValue !== undefined && action !== "admit") {
        return fail("INVALID_VALUE", keyPath(path, "editedValue"));
    }
    return deepFreeze({
        ...header,
        candidateId: readIdentifier(requiredField(record, path, "candidateId"), keyPath(path, "candidateId"), LIMITS.maxItemIdBytes),
        action,
        ...(editedValue === undefined ? {} : { editedValue }),
        currentSources,
    });
}
