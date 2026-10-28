import { type Rec } from "./reader.ts";
import type { ContractVersion, HostClock } from "./common.ts";
import type { ListMemoryChangesInput } from "./external.ts";
/** `contractVersion` を検査する。整数でなければ INVALID_*、期待と違えば UNSUPPORTED_SCHEMA_VERSION。 */
export declare function readContractVersion(record: Rec, path: string, expected: number): ContractVersion;
export declare function readScopeKey(value: unknown, path: string): string;
/** 重複なし・1 件以上の scopeKey 配列。 */
export declare function readScopeKeys(value: unknown, path: string): readonly string[];
export declare function readHostClock(value: unknown, path: string): HostClock;
export declare function parseListMemoryChangesInput(value: unknown): ListMemoryChangesInput;
