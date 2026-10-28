import type { SourceKey } from "../../../contracts/common.ts";
import type { RecordOrigin } from "../contracts/index.ts";
import type { ByteRange, SourceRef } from "../../../contracts/types.ts";
/** `"rec:" + sha256Hex(canonicalJson([principal, scopeKey, namespace, kind, id]))`。 */
export declare function recordIdOf(principal: string, scopeKey: string, origin: RecordOrigin): string;
/** revision = `"sha256:" + hex`、digest = 同じ hex（本文の UTF-8 bytes の SHA-256）。 */
export declare function contentRevision(content: string): {
    readonly revision: string;
    readonly digest: string;
};
/** recordId の書式（`rec:` + 64 桁 hex）。 */
export declare function isRecordId(value: string): boolean;
/** Records の SourceRef（namespace `memory`, kind `record`, representation `text`）。 */
export declare function recordSourceRef(recordId: string, revision: string, digest: string, range?: ByteRange): SourceRef;
/** 依存辺・墓標が使う、record の出典キー。 */
export declare function recordSourceKey(recordId: string): SourceKey;
