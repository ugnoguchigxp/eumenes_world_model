import type { MemoryView, MemoryViewValidation, ValidationCurrent } from "../../../contracts/types.ts";
/**
 * ホストが読み直した current に対する view の再検証（設計書 §2.3）。
 * 構造違反は MemoryContractError。DB・ネットワークは読まない。
 */
export declare function validateMemoryView(view: MemoryView, current: ValidationCurrent): MemoryViewValidation;
