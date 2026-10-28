import { type BuildReasonCode } from "./reason-codes.ts";
import { type Rec } from "./reader.ts";
import type { MemoryView, SourceDependency } from "./types.ts";
export declare function readSourceDependency(value: unknown, path: string): SourceDependency;
export declare function readViewHeader(record: Rec, path: string): {
    schemaVersion: 1;
    principal: string;
    scopeKey: string;
    purpose: string;
    stateRevision: string;
    policyRevision: string;
    instructionAuthority: "none";
};
export declare function reasonAllowedFor(status: "blocked" | "overflow" | "disabled", reason: BuildReasonCode): boolean;
export declare function parseMemoryView(value: unknown): MemoryView;
