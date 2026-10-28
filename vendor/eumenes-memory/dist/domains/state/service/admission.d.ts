import type { ExtractionSource, StateKeyHistory } from "../contracts/index.ts";
import type { AdmissionDecision, AdmissionPolicy, StateItemView, StateKind, StateValue } from "../contracts/index.ts";
import type { EvidenceSpan } from "../../../contracts/common.ts";
import type { SourceState } from "../../../contracts/types.ts";
/** parse 済みの抽出候補（モデルの値）。kind / subject / modality はモデルの文字列のまま受ける。 */
export interface AdmissionCandidate {
    readonly kind: string;
    readonly subject: string;
    readonly semanticKey: string;
    readonly value: {
        readonly text: string;
        readonly polarity: string;
    };
    readonly modality: string;
    readonly temporal: string;
    /** quote 本文つき。 */
    readonly evidence: readonly EvidenceSpan[];
}
export interface AdmissionInput {
    readonly candidate: AdmissionCandidate;
    readonly principal: string;
    readonly scopeKey: string;
    /** run 入力の出典（本文・role・順位つき）。 */
    readonly inputSources: readonly ExtractionSource[];
    /** 判定時点の出典の現在状態（settle ではホストが読み直したもの）。 */
    readonly currentSources: readonly SourceState[];
    /** 同 (subject, effective kind, semanticKey) の現在の active（なければ null）。 */
    readonly activeForKey: StateItemView | null;
    /** 同 key の active 以外の履歴（disputed の最新の根拠順位、ユーザー由来 item の retract / deactivate）。省略は履歴なし。 */
    readonly keyHistory?: StateKeyHistory;
    readonly policy: AdmissionPolicy;
}
/**
 * 台帳に載るときの kind。subject が `other:*` なら `other_person_note` に固定、host 所有・未知の kind と
 * `unknown` subject は台帳に載らないので null。
 */
export declare function effectiveCandidateKind(candidate: Pick<AdmissionCandidate, "kind" | "subject">): StateKind | null;
export declare function evaluateAdmission(input: AdmissionInput): AdmissionDecision;
/** 候補の値を StateValue にする（attributes はモデルから受けない）。parse 済みなので polarity は検査済み。 */
export declare function candidateValue(candidate: AdmissionCandidate): StateValue;
