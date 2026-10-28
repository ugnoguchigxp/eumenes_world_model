export declare const SCHEMA_VERSION: 1;
/** 入力上限。単位は UTF-8 byte または個数（設計書 §3.1）。 */
export declare const LIMITS: Readonly<{
    maxPrincipalBytes: 256;
    maxScopeKeyBytes: 256;
    maxScopeKeys: 64;
    maxPurposeBytes: 64;
    maxRevisionBytes: 256;
    maxNamespaceBytes: 64;
    maxSourceKindBytes: 64;
    maxSourceIdBytes: 256;
    maxRepresentationBytes: 64;
    maxItemIdBytes: 256;
    maxItemTextBytes: 16384;
    maxSourceContentBytes: 1048576;
    maxTotalSourceContentBytes: 16777216;
    maxSources: 4096;
    maxItems: 1000;
    maxDependenciesPerItem: 32;
    /** coverage.omitted は M0 では常に空。巨大配列を全走査しないための小さな上限。 */
    maxCoverageOmitted: 16;
}>;
export declare const ITEM_KINDS: readonly ["goal", "decision", "open_question"];
export declare const ITEM_STATUSES: readonly ["active", "inactive"];
export declare const ITEM_ORIGINS: readonly ["user_confirmed", "user_edited"];
export declare const SOURCE_STATUSES: readonly ["available", "missing", "changed", "forgotten"];
