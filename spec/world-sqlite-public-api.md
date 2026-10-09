# World SQLite 公開API（P2完了時点）

P2-10の受入結果。仕様は[sqlite-api-v1.md](sqlite-api-v1.md)、物理表は[schema-v1.md](schema-v1.md)、計測は[performance-baseline.md](performance-baseline.md)。証拠は[進捗表](plan/progress.md)を正本とする。**この文書の範囲は「独立した実SQLite（file/WAL、単一writer、readonly reader）で成立した本体のSQL層」であり、Eumenes結合は含まない。**

## パッケージ入口

純粋API（DB・時計・乱数なし）: `eumenes-world-model`（`src/index.ts`）。

| domain | 公開操作 |
|---|---|
| conditions | evaluateConditions, compareValidity |
| identity | resolveEntity, planMerge, planSplit |
| assertions | validateAssertion, planAssertionTransition, groupEvidenceRoots |
| lifecycle | planInvalidation, planForget |
| projection | buildProjection, buildWorldSlice, toSliceReceipt, validateSliceUsage |
| reasoning | explainRelevance, traceInfluence, checkDependencies, findResearchGaps |
| scenarios | compareScenarios, assessOutcome |
| extraction | prepareExtraction, validateCandidates |

同期永続API: `eumenes-world-model/sqlite`（`src/sqlite.ts`）。借りた接続（`WorldDb`）だけを使い、open/close・transaction・PRAGMA・writer・queueを持たない。生のrepository関数は公開しない。

| export | 役割 |
|---|---|
| `migrations` / 固定順descriptor | ホストが各要素を自分のtransactionで実行。`world_schema_info`に版とhashを記録 |
| `applyWorldOperation(db, input, {hasher})` | 唯一の更新入口。tx外は`WorldTransactionRequiredError` |
| `readWorldSnapshot(db, request)` | tx内の一貫したbounded読取り（単一Scope、予算付き） |
| `readAssertionHistory(db, request)` | 現在の認可・墓標を検査する履歴照会 |
| `validateWorldUsage(db, receipt, current)` | writer上でassertion版・source版・scope epoch・policy・forget/restoreEpochを照合 |
| `WorldTransactionRequiredError` / `WorldIntegrityError` | ホストがrollbackすべき失敗 |

### applyWorldOperationのoperation

入力は`{contractVersion:1, access, scope, operationKey, clock, hostChecks, operation}`、結果は`{status:"applied"|"no_op", receipt}`または`{status:"rejected"|"blocked", reasonCode}`（本文を含めない）。

| kind | 内容 |
|---|---|
| entity.register / merge / split | 対象の登録、可逆な統合・分離 |
| assertion.register / transition | 主張登録、採用・争い・訂正・撤回・失効の遷移 |
| prediction.register / outcome.register | 予測（許容誤差固定）と結果 |
| inbox.receive / candidate.settle | 受領と候補の一括確定（checkpoint・manifest・receiptと同時） |
| invalidate | 旧版の即時停止 |
| forget.chunk | 閉包の最大500対象ずつの消去。pending/completeを別に報告 |
| forget.reopen | 完了済みforgetで閉じたScopeを開く。前提: forget complete・保留対象0・外部削除確認(host)・gateの理由がforget由来(復元中は不可)。通常のforgetの出口はこれで、restoreは古いDB復元専用 |
| restore.begin / register / reconcile / finish | 古いDBの復元手順。完了までScopeを閉じる |
| rebuild | 台帳から投影を再構築 |

## 受入済みの性質（実SQLite）

`test/scenario/world-lifecycle.test.ts`が一つの流れで確認: 対象登録→明示採用→Slice→訂正→旧Slice拒否→forget→復元・再構築→再開。各段階でhost_probeを同じtransactionへ入れ、同じoperationKeyの再送でrevision・epoch・件数が増えないこと、forget後に管理payload列へ本文が残らないこと（不透明IDは墓標・進捗表のみ）。

個別ケース: A21〜A24（制約・原子性・epoch）、A25〜A26（rollbackと再送）、A27（WAL snapshot）、A28〜A29（欠番・保留・OFF）、A30〜A31（chunk忘却・遅着）、A32（復元）、A33（上限と計測。時間は機材依存の参考値）。

## 未受入（P3以降。完了と書かない）

- Eumenes単一Writer・queue・dialogue・WriterBusy/shutdown伝播との結合（A35、A39〜A41）
- 実Memoryへの依存登録・external deletion確認・SourceAdapter（A36、A38）。Memory型は型のみ、ローカル生成の固定配布物（公式リリースではない）
- forget/restore journalの耐久保存（テストのjournalはメモリ/一時ファイルfixture）
- Goal公開口（A37）、Context Broker・回答採用・TTS制御
- 実モデルによる抽出品質、Local/Cloud運用（A42〜A46）
- 正式配布tgzと独立consumer試験（A34）
- 複数Scope・長期運用・本番復元手順（A53、A54）

## P3へ渡す実行済みAPI一覧

上の`src/sqlite.ts`のexportと、operation 15種。ホストが渡すべきもの: 同一writer snapshot由来の`hostChecks`（gate、sourceSnapshot、forgetEpoch、restoreEpoch、policyRevision）、同期hash関数、呼出元発行のID・operationKey・clock、検証済みの`Assertion`（`validateAssertion`相当を通したもの。applicationは中身を再検証しない）。ホストはWorld操作後のMemory登録を同じtransactionで行い、いずれかが拒否・例外ならtransaction全体を戻す。

## 独立レビュー後の動作と既知の制約

- **Scopeの束縛**: `assertion.register`/`assertion.transition`のpayloadが持つScopeは封筒のScopeと一致しなければ`SCOPE_MISMATCH`（DML前、他Scopeの存在を示さない）。遷移planは唯一の遷移表と現行headに照合してからDMLへ進む。
- **forget**: 完了済みforgetIdへの追加chunkは`FORGET_ALREADY_COMPLETE`。新規forgetIdの空rootsは`INVALID_INPUT`。entityのforgetは統合された配下を同時に対象へ加え、統合先の名称・aliasから忘却対象の文字を除く（統合先のrevisionが進み、関与するidentity履歴は削除。残る履歴からも該当文字を除くため、その分割は厳密には復元できない）。予測はbasisのassertion idで全revisionを消す。候補(inbox event)の墓標はreceive/settleを拒否する。
- **投影**: forgetは差分除去（行・digest・反証一覧・epoch）で、台帳全体の再構築をしない。再構築は`restore.finish`と`rebuild`のみで、台帳が上限（200,000件）を超えると`blocked LEDGER_TOO_LARGE`（書込み前）。
- **復元中のforget**: gateの理由`RESTORE_IN_PROGRESS`は上書きされず、restore.*は継続できる。
- **入口の検査**: `applyWorldOperation`/`readWorldSnapshot`/`readAssertionHistory`/`validateWorldUsage`（`src/sqlite.ts`）は最初にworld_schema_infoをピン留めmanifestと照合し、不一致・未来版・未完了のupgradeは`blocked SCHEMA_INCOMPATIBLE`（World表に触れない）。migrationの適用自体はホストの責務。
- **sourceの検査**: stateがavailable以外は`SOURCE_NOT_AVAILABLE`（changedは`SOURCE_VERSION_MISMATCH`）。墓標はkind `source`と`state`の両方を見る。
- **既知の制約（未解決）**: `received`/`held`/`rejected`のうちmanifestを持たないinbox event（生の受信payloadを含む）は、payload_jsonに索引がなく、schema変更なしではsource/state forgetの閉包から辿れない。migrationは変更しない方針のため、ホストが該当eventを`candidate` root（`{kind:"candidate", id:<eventId>}`）として明示する運用とする。settle後のeventはmanifest経由で辿られる。
- **entity forgetの到達範囲**: subjectとして持つ主張に加え、関係先(`objectId`)・entity参照値として名指す主張も消す（`payload_json`をScope内で走査するため、entity forget時のみ線形のコスト。索引なし）。統合された配下は代表より先に消え、多段の統合も到達する。
- **復元検証の上限**: `restore.finish`は台帳の依存キーを最大1,000,000件まで1回で検証する。超えると`VERIFICATION_TOO_LARGE`。

## Review round 2: behaviour fixed after the second persistence review

- **Merge chains**: forgetting a merged entity scrubs its text from every ancestor, not just the direct representative. What an ancestor keeps is rebuilt from the ORIGINAL (pre-absorption) text of its surviving subtree, taken from the merge history; intermediate snapshots are never used because they already contain absorbed members.
- **Entity forget** reaches every revision of every assertion that ever had the entity as subject (a supersede may move the subject), assertions that mention it as relation object or entity-ref value, and predictions that name it (`conditions.subjectId`, qualitative `subjectId`/`objectId`). The last two lookups read `payload_json` (no index): they scan one Scope's rows and run only when an entity is forgotten. `prediction.register` is refused (`TOMBSTONED`) for a forgotten subject/object entity.
- **Long source keys**: a source/state forget root or tombstone may carry the full source identity key (up to 8192 bytes); every other kind keeps the 256-byte ID limit. No hashing, so tombstones stay exact.
- **Restore and the inbox**: `restore.begin` deletes inbox events still `received`/`held` (payload included): their feed key embeds the pre-restore epoch and they could never be settled. The host re-delivers them from the reset cursor. A final (`applied`/`rejected`) event re-delivered under any feed key or sequence with the same content is a duplicate (`unchanged`).
- **Replay digest**: set-valued fields (forget roots, invalidate targets/sourceKeys, restore registrations, journal tombstones, manifest dependencies) are put in canonical order before hashing, so a reordered resend is a `no_op`. `restore.*` and `rebuild` also include the host's `restoreEpoch`, so reusing a key under a new epoch is `OPERATION_KEY_CONFLICT`. forget/restore/invalidate/settle/receive operations may be up to 4 MiB canonical; every other operation stays at 64 KiB.
- **Causal eligibility** (`world_current.causal_eligible` and the edge payload) is derived from the ledger the same way in incremental updates and in a rebuild: an active claim is eligible only while none of its refutations (own contradicts + recorded disputers) is a live (non-terminal) head. The result no longer depends on page boundaries.
- **Invalidate by source** stops only HEAD revisions that still depend on the source.
- **`forget.reopen`** must name the forget that owns the current gate reason (`FORGET_COMPLETE_AWAITING_REOPEN:<digest of forgetId>`); another forget's id is `GATE_OWNED_BY_OTHER_FORGET`.
