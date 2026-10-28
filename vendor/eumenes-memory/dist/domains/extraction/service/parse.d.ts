import type { ConfirmCandidateInput, ListCandidatesInput, PrepareExtractionInput, SettleExtractionInput } from "../contracts/index.ts";
export declare function parsePrepareExtractionInput(value: unknown): PrepareExtractionInput;
export declare function parseSettleExtractionInput(value: unknown): SettleExtractionInput;
export declare function parseListCandidatesInput(value: unknown): ListCandidatesInput;
export declare function parseConfirmCandidateInput(value: unknown): ConfirmCandidateInput;
