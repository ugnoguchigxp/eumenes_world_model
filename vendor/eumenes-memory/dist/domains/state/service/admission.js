import { MODALITIES, POLARITIES, TEMPORALS, } from "../../../contracts/common.js";
import { HOST_OWNED_KINDS, MAX_EVIDENCE_PER_CANDIDATE, } from "../../../contracts/admission-policy.js";
import { LIMITS_STATE, STATE_KINDS, USER_STATE_ORIGINS, } from "../contracts/index.js";
import { isWellFormedUtf16, utf8ByteLength } from "../../../canonical/utf8.js";
import { hasControlChars } from "../../../contracts/reader.js";
import { ownValue } from "../../../contracts/own.js";
import { checkEvidence, evidenceOrdinalOf, findInputSource, isQuotedSpan, } from "./evidence.js";
import { stateValueEquals } from "./value.js";
function isHostOwnedKind(kind) {
    return HOST_OWNED_KINDS.includes(kind);
}
function isStateKind(kind) {
    return STATE_KINDS.includes(kind);
}
function readSubject(subject) {
    if (subject === "self" || subject === "unknown")
        return subject;
    if (subject.startsWith("other:") &&
        subject.length > "other:".length &&
        utf8ByteLength(subject) <= LIMITS_STATE.maxSubjectBytes &&
        isWellFormedUtf16(subject) &&
        !hasControlChars(subject)) {
        return subject;
    }
    return null;
}
function isSaneText(text, maxBytes) {
    return (text.length > 0 &&
        isWellFormedUtf16(text) &&
        utf8ByteLength(text) <= maxBytes);
}
/** 識別子（semanticKey）: `isSaneText` に加えて制御文字なし。明示操作の入力 parse（`readIdentifier`）と同じ規則。 */
function isSaneIdentifier(text, maxBytes) {
    return isSaneText(text, maxBytes) && !hasControlChars(text);
}
/** 規則 1。 */
function isInvalidCandidate(candidate) {
    const subject = readSubject(candidate.subject);
    if (subject === null ||
        !(isStateKind(candidate.kind) || isHostOwnedKind(candidate.kind)) ||
        !isSaneIdentifier(candidate.semanticKey, LIMITS_STATE.maxSemanticKeyBytes) ||
        !isSaneText(candidate.value.text, LIMITS_STATE.maxValueTextBytes) ||
        !POLARITIES.includes(candidate.value.polarity) ||
        !MODALITIES.includes(candidate.modality) ||
        !TEMPORALS.includes(candidate.temporal) ||
        candidate.evidence.length === 0 ||
        candidate.evidence.length > MAX_EVIDENCE_PER_CANDIDATE) {
        return true;
    }
    for (const span of candidate.evidence) {
        if (!isSaneText(span.quote, LIMITS_STATE.maxQuoteBytes))
            return true;
    }
    // 自分の事柄を other_person_note にはできない（⇔ の片側）。
    return candidate.kind === "other_person_note" && subject === "self";
}
/**
 * 台帳に載るときの kind。subject が `other:*` なら `other_person_note` に固定、host 所有・未知の kind と
 * `unknown` subject は台帳に載らないので null。
 */
export function effectiveCandidateKind(candidate) {
    const subject = readSubject(candidate.subject);
    if (subject === null || subject === "unknown")
        return null;
    if (subject !== "self")
        return "other_person_note";
    return isStateKind(candidate.kind) && candidate.kind !== "other_person_note"
        ? candidate.kind
        : null;
}
const REJECTED = (reasonCode) => ({ decision: "rejected", reasonCode });
const PENDING = (reasonCode) => ({ decision: "pending_user", reasonCode });
export function evaluateAdmission(input) {
    const { candidate } = input;
    if (isInvalidCandidate(candidate))
        return REJECTED("INVALID_CANDIDATE");
    const failure = checkEvidence({
        principal: input.principal,
        scopeKey: input.scopeKey,
        evidence: candidate.evidence,
        inputSources: input.inputSources,
        currentSources: input.currentSources,
    });
    if (failure !== null)
        return REJECTED(failure);
    if (isHostOwnedKind(candidate.kind))
        return REJECTED("HOST_OWNED_KIND");
    // 方針が never の kind では、pending_user になる規則は候補を作らず rejected にする。
    // 台帳に載らない（kind を決められない）候補は方針を持たないので、そのまま pending のまま返す。
    const kind = effectiveCandidateKind(candidate);
    const pending = (reasonCode) => kind !== null && input.policy[kind] === "never"
        ? REJECTED("POLICY_NEVER")
        : PENDING(reasonCode);
    const quotedSpan = candidate.evidence.some((span) => {
        const source = findInputSource(span.source, input.principal, input.scopeKey, input.inputSources);
        return source !== undefined && isQuotedSpan(source.content, span);
    });
    if (candidate.modality === "quoted" ||
        candidate.modality === "reported" ||
        quotedSpan) {
        return pending("MODALITY_QUOTED");
    }
    if (candidate.modality === "hypothetical" ||
        candidate.modality === "question") {
        return REJECTED("MODALITY_NOT_ASSERTED");
    }
    const subject = readSubject(candidate.subject);
    if (subject !== "self" && subject !== "unknown" && subject !== null) {
        return pending("SUBJECT_OTHER");
    }
    if (subject === "unknown")
        return REJECTED("SUBJECT_UNKNOWN");
    if (candidate.temporal === "past" || candidate.temporal === "future") {
        return pending("TEMPORAL_NOT_CURRENT");
    }
    const notUser = candidate.evidence.some((span) => findInputSource(span.source, input.principal, input.scopeKey, input.inputSources)?.role !== "user");
    if (notUser)
        return pending("NOT_USER_SOURCE");
    const ordinal = evidenceOrdinalOf({
        principal: input.principal,
        scopeKey: input.scopeKey,
        evidence: candidate.evidence,
        inputSources: input.inputSources,
    });
    const active = input.activeForKey;
    const history = ownValue(input, "keyHistory");
    const differsFromActive = active !== null &&
        !stateValueEquals(active.value, candidateValue(candidate));
    // 書き込みが新しい値を持ち込む（active がない、または active と値が違う）。
    const changesKey = active === null || differsFromActive;
    const disputedMax = history?.disputedMaxOrdinal ?? null;
    if (active !== null &&
        differsFromActive &&
        ordinal !== null &&
        ordinal < active.evidenceOrdinal) {
        return REJECTED("OLDER_EVIDENCE");
    }
    if (changesKey &&
        disputedMax !== null &&
        ordinal !== null &&
        ordinal < disputedMax) {
        return REJECTED("OLDER_EVIDENCE");
    }
    // 抽出由来は、ユーザーが確認／編集した active を黙って上書きしない（auto_admit でも確認に回す）。
    if (active !== null &&
        differsFromActive &&
        USER_STATE_ORIGINS.includes(active.origin)) {
        return pending("POLICY_REQUIRES_USER");
    }
    // dispute を自動で解消しない／ユーザーが明示的に消したものを自動で復活させない。
    if (changesKey && (disputedMax !== null || history?.userRemoved === true)) {
        return pending("POLICY_REQUIRES_USER");
    }
    const mode = kind === null ? "never" : input.policy[kind];
    if (mode === "never")
        return REJECTED("POLICY_NEVER");
    if (mode === "user_confirm")
        return PENDING("POLICY_REQUIRES_USER");
    return { decision: "admitted" };
}
/** 候補の値を StateValue にする（attributes はモデルから受けない）。parse 済みなので polarity は検査済み。 */
export function candidateValue(candidate) {
    return {
        text: candidate.value.text,
        polarity: candidate.value.polarity,
    };
}
