export { SCHEMA_VERSION, LIMITS } from "./contracts/constants.js";
export { ITEM_KINDS, ITEM_STATUSES, ITEM_ORIGINS, SOURCE_STATUSES, } from "./contracts/constants.js";
export { CONTRACT_ERROR_CODES, MemoryContractError, isMemoryContractError, } from "./contracts/errors.js";
export { parseBuildMemoryViewInput } from "./contracts/parse-input.js";
export { parseValidationCurrent } from "./contracts/parse-input.js";
export { parseMemoryView } from "./contracts/parse-view.js";
export { BUILD_REASON_CODES, VALIDATION_REASON_CODES, } from "./contracts/reason-codes.js";
export { validateMemoryView } from "./domains/projection/index.js";
export { buildMemoryView } from "./domains/projection/index.js";
// ---- View v2（schemaVersion 2。v1 の関数・型・挙動は上のまま変わらない）----
export { parseBuildMemoryViewInputV2, parseMemoryViewV2, parseValidationCurrentV2, } from "./domains/projection/contracts/parse-v2.js";
export { validateMemoryViewV2 } from "./domains/projection/index.js";
export { buildMemoryViewV2 } from "./domains/projection/index.js";
export { composeSnapshotV2 } from "./domains/projection/index.js";
// ---- 全体設計（S0 で確定した family 契約。型・定数のみで実行ロジックは持たない）----
export * from "./contracts/common.js";
export * from "./contracts/versions.js";
export * from "./domains/records/contracts/index.js";
export * from "./domains/recall/contracts/index.js";
export * from "./contracts/view-v2.js";
export * from "./domains/state/contracts/index.js";
export * from "./domains/extraction/contracts/index.js";
export * from "./domains/lifecycle/contracts/index.js";
export * from "./contracts/external.js";
// ---- 純粋部品（S1〜S5）----
export { sliceUtf8Range } from "./domains/records/index.js";
export { verifyForgetJournal } from "./domains/lifecycle/index.js";
export { candidateValue, effectiveCandidateKind, evaluateAdmission, } from "./domains/state/index.js";
export { checkEvidence, evidenceOrdinalOf, isQuotedSpan, quoteMatches, } from "./domains/state/index.js";
export { stateItemId } from "./domains/state/index.js";
export { applyStateTransition, isSubjectKindConsistent, } from "./domains/state/index.js";
export { stateValueEquals } from "./domains/state/index.js";
export { parseExtractionOutput } from "./domains/extraction/index.js";
export { candidateIdOf, runIdOf } from "./domains/extraction/index.js";
export { buildExtractionPromptMaterial } from "./domains/extraction/index.js";
// ---- 時間と選択（evolution-proposal 段階2〜3の純粋部品）----
export * from "./domains/temporal/index.js";
export * from "./domains/selection/index.js";
