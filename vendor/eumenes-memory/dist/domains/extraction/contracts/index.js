import { MAX_EVIDENCE_PER_CANDIDATE } from "../../../contracts/admission-policy.js";
export { HOST_OWNED_KINDS } from "../../../contracts/admission-policy.js";
export const LIMITS_EXTRACTION = Object.freeze({
    maxCandidates: 10,
    maxOutputBytes: 16384,
    maxEvidencePerCandidate: MAX_EVIDENCE_PER_CANDIDATE,
    maxSources: 64,
    /** `PrepareExtractionInput.maxInputBytes` に指定できる上限（出典本文の合計 UTF-8 byte）。 */
    maxInputBytesCap: 262144,
    maxShownState: 50,
    maxExtractorIdBytes: 64,
    maxPromptVersionBytes: 64,
    maxProviderRefBytes: 64,
    maxListedCandidates: 100,
});
export const EXTRACTION_RUN_STAGES = Object.freeze([
    "prepared",
    "settled",
    "stale",
    "rejected_output",
]);
export const SOURCE_PROGRESS_STAGES = Object.freeze([
    "extracted",
    "no_change",
    "failed_output",
]);
export const CANDIDATE_DECISIONS = Object.freeze([
    "admitted",
    "pending_user",
    "rejected",
    "invalidated",
    "forgotten",
]);
export const EXTRACTION_SKIP_REASON_CODES = Object.freeze([
    "MEMORY_DISABLED",
    "NO_NEW_INPUT",
    "SOURCE_TOMBSTONED",
    "INPUT_TOO_LARGE",
]);
export const EXTRACTION_STALE_REASON_CODES = Object.freeze([
    "SOURCE_CHANGED",
    "SOURCE_TOMBSTONED",
    "STATE_CHANGED",
    "RUN_UNKNOWN",
    "RUN_ALREADY_SETTLED_DIFFERENT",
]);
export const EXTRACTION_REJECTED_OUTPUT_REASON_CODES = Object.freeze([
    "OUTPUT_SCHEMA",
    "OUTPUT_TOO_LARGE",
    "TOO_MANY_CANDIDATES",
]);
export const CONFIRM_ACTIONS = Object.freeze(["admit", "reject"]);
