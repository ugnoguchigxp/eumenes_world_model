import type { MemoryViewValidationV2, MemoryViewV2, ValidationCurrentV2 } from "../../../contracts/view-v2.ts";
/**
 * View v2 の再検証。ホストが読み直した current に対し、view の schemaVersion 2 の形を検査する
 * （v1 の view / current は `validateMemoryView`）。構造違反は MemoryContractError。DB・ネットワークは読まない。
 */
export declare function validateMemoryViewV2(view: MemoryViewV2, current: ValidationCurrentV2): MemoryViewValidationV2;
