import type { AssertionDraft } from "../../assertions/contracts/index.ts";

/** Why a candidate was not accepted. Codes carry no content, names or counts. */
export const candidateReasonCodes = [
	"MALFORMED_CANDIDATE",
	"FORBIDDEN_MODEL_FIELD",
	"CANDIDATE_OVERFLOW",
	"NEGATED_NOT_FACT",
	"HYPOTHETICAL_NOT_FACT",
	"QUESTION_NOT_CLAIM",
	"UNKNOWN_SUBJECT_ID",
	"SUBJECT_UNRESOLVED",
	"AMBIGUOUS_SUBJECT",
	"OBJECT_UNRESOLVED",
	"QUOTE_SOURCE_NOT_IN_WINDOW",
	"QUOTE_OUT_OF_RANGE",
	"CONDITION_INVALID",
	"CONDITION_NOT_PERMITTED",
	"HOST_ASSIGNMENT_MISSING",
	"SOURCE_NOT_AVAILABLE",
	"SOURCE_VERSION_MISMATCH",
	"SOURCE_DIGEST_MISMATCH",
	"QUOTE_UNVERIFIABLE",
	"QUOTE_DIGEST_MISSING",
	"QUOTE_DIGEST_MISMATCH",
	"ORIGIN_EVIDENCE_MISMATCH",
	"MISSING_OBSERVED_AT",
	"UNCONDITIONAL_WITHOUT_EVIDENCE",
	"SUBJECT_NOT_RESOLVED",
	"OBJECT_NOT_RESOLVED",
	"MANIFEST_LIMIT_EXCEEDED",
	"INVALID_SUPERSEDES",
	"SCOPE_NOT_PERMITTED",
	"SELF_CONTRADICTION",
	"ROOT_LABEL_CONFLICT",
	"CANDIDATE_TOO_LARGE",
] as const;
export type CandidateReasonCode = (typeof candidateReasonCodes)[number];

export const modalities = [
	"asserted",
	"reported",
	"hypothetical",
	"negated",
	"question",
] as const;
export type Modality = (typeof modalities)[number];

/** Fields only the host may assign. A model supplying one is rejected. */
export const forbiddenModelFields = [
	"id",
	"revision",
	"scope",
	"principal",
	"scopeKey",
	"authorization",
	"authorized",
	"lifecycle",
	"status",
	"active",
	"observedAt",
	"recordedAt",
	"confidence",
	"origin",
	"evidence",
	"rootEvidenceId",
] as const;
export const candidateKeys = [
	"subject",
	"predicate",
	"payload",
	"quote",
	"modality",
	"condition",
	"validTime",
] as const;

export type CandidateVerdict =
	| {
			readonly index: number;
			readonly status: "accepted";
			/** asserted keeps the utterance origin; reported becomes a hypothesis. */
			readonly treatment: "asserted" | "reported";
			/** Always a candidate-lifecycle draft that passed validateAssertion. */
			readonly draft: AssertionDraft;
	  }
	| {
			readonly index: number;
			readonly status: "held" | "rejected";
			/** Sorted, unique. */
			readonly reasonCodes: readonly CandidateReasonCode[];
	  };

export interface ValidationResult {
	/** rejected: the whole output is unusable (not parseable, selection invalid). */
	readonly status: "validated" | "rejected";
	readonly reasonCode?: "MALFORMED_OUTPUT" | "SELECTION_INVALID";
	/** One verdict per raw candidate (up to the examined bound), in order. */
	readonly verdicts: readonly CandidateVerdict[];
	readonly acceptedIndexes: readonly number[];
	/** Only explicitly selected, accepted candidates. Empty without a selection. */
	readonly handoff: readonly Extract<
		CandidateVerdict,
		{ status: "accepted" }
	>[];
}
