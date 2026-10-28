/**
 * State 台帳の遷移 reducer（純粋。時計・乱数・IO なし。full-system-design §3.5）。
 *
 * 規則の出典（SAAA personal-state-core、HEAD 28616e61ce5fe853383d4af6ec14e5b5d542c076、MIT。
 * コードは写さず、規則を本設計の語彙で独自に再実装した）:
 * - 遷移が status を決める（assert → active、dispute → disputed、supersede → superseded、
 *   retract → retracted、invalidate → invalidated）: crates/personal-state-core/src/reducer.rs:104-114。
 * - assert 以外の遷移は、対象が既存で status が活きている場合だけ許す（それ以外は INVALID_TRANSITION）:
 *   reducer.rs:417-430。本設計は `active / inactive / disputed` を活きているとみなす。
 * - 同 (kind, semanticKey) の active は 1 件（衝突は ACTIVE_EXISTS）: reducer.rs:466-474。
 * - 同 key のより新しい根拠を持つ item がすでにあるとき、古い根拠での置き換えを拒む（OLDER_EVIDENCE）:
 *   reducer.rs:440-455。新旧は出典の順位（本設計では `evidenceOrdinal`）で比べる。
 * - supersede は同 kind・同 key の別 item への置き換えだけ許し、自分自身への置き換えを拒む: reducer.rs:476-495。
 * - 依存の forget / invalidate は閉包で確定書き込みする（reducer を通さない）: reducer.rs:503-571 の意図。
 *
 * 本設計独自（SAAA に無い）: CAS（expectedRevision）、subject（self / other:*）と kind の同値検査、
 * 明示操作（user_confirmed / user_edited）が新旧比較を受けないこと、根拠の新旧が同じで値が違うときの dispute、
 * deactivate / reactivate（可逆）、同値の明示確認による origin の昇格（抽出由来 → user 由来。降格はしない）、
 * 同 key の履歴（`StateKeyHistory`）の扱い: disputed の item より古い根拠は `OLDER_EVIDENCE`、同順位以上でも
 * dispute を黙って解消せず disputed のまま加わる、ユーザー由来 item を retract / deactivate した key へは
 * 抽出由来を書かない（`INVALID_TRANSITION`。Admission は先に `pending_user` にする）。
 *
 * `forget` は reducer を通さない（lifecycle が閉包で value を消し status を `forgotten` にする）。
 * action に `forget` や未知の値が来たら INVALID_TRANSITION。
 */
import type { StateSubject } from "../../../contracts/common.ts";
import type { StateItemView, StateKind, StateTransition, StateTransitionContext, StateTransitionResult } from "../contracts/index.ts";
/**
 * 新しい item（assert / supersede が作る側）の同一性。`StateTransition` は ID・subject・kind・semanticKey を
 * 持たないので、新規 item を作る遷移だけが別に受ける（契約型の拡張。親へ契約への取り込みを要求済み）。
 */
export interface StateItemIdentity {
    readonly itemId: string;
    readonly subject: StateSubject;
    readonly kind: StateKind;
    readonly semanticKey: string;
}
export interface StateTransitionRequest extends StateTransition {
    /** `assert` と `supersede` では必須（`supersede` は current と同じ subject / kind / semanticKey）。 */
    readonly identity?: StateItemIdentity;
}
/** `kind === "other_person_note"` ⇔ subject が `other:*`（それ以外の kind は `self`）。 */
export declare function isSubjectKindConsistent(subject: string, kind: string): boolean;
/**
 * 遷移を 1 つ適用する。戻りの `items` は状態が変わった item の変更後の像（`supersede` / `dispute` は
 * 旧 → 新の順）、`events` は追記する event の下書き。`items` と `events` が空なら冪等（`unchanged`）。
 * 副作用はない。永続化（同 key 一意の維持、依存辺、seq の発行）は呼び出し側（`src/domains/state/repository/index.ts`）。
 *
 * - `assert`: `current` と `expectedRevision` は null、`identity` / `value` / `origin` / `evidenceOrdinal` が必須。
 *   active が無ければ新規 active（抽出由来で同 key に disputed が残るときは `context.keyHistory` の規則）。ある場合、
 *   同値は冪等（ただし抽出由来の active に明示操作が同値を書けば origin を昇格）、明示操作は ACTIVE_EXISTS、
 *   抽出由来は根拠の新旧で supersede / OLDER_EVIDENCE / dispute。
 * - `supersede`: current（active）を CAS で置き換える。同じ新旧規則（抽出由来のみ）。
 * - `edit`: active / inactive / disputed の値を変える。status は変わらない（同値でも抽出由来なら origin を昇格）。
 * - `deactivate`: active → inactive。`reactivate`: inactive → active。`activate`: disputed → active（紛争の解決）。
 *   `retract`: active / inactive / disputed → retracted。`invalidate`: active / inactive / disputed → invalidated。
 *   `dispute`: active → disputed。
 */
export declare function applyStateTransition(current: StateItemView | null, transition: StateTransitionRequest, context: StateTransitionContext): StateTransitionResult;
