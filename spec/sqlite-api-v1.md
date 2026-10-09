# World SQLite API v1

[C8](plan/contracts.md)の同期更新APIと、各domainのrepository規約を固定する。物理表は[schema-v1.md](schema-v1.md)。**この文書は仕様であり、各操作は該当票（P2-03〜08）が実装するまで存在しない。** 実装済みの範囲は[進捗表](plan/progress.md)を正本とする。

## 共通規約

- すべて同期。`db`はホストから借りた`WorldDb`で、保持・close・transaction・PRAGMAをしない。
- 書込み: 先頭で`requireTransaction(db)`（`db.inTransaction !== true`は`WorldTransactionRequiredError`）。値はすべてbind。INSERT/UPDATEは`expectChanges`で件数を確認し、期待外は`WorldIntegrityError`（ホストがrollback）。0件更新を成功にしない。forget用のDELETEは冪等（既に消えた対象を指定しても成功）で件数を強制しない。
- 読取り: 全SELECTのWHEREに`principal`と`scope_key`を含む。認可外を取得して後で絞らない。取得件数は呼出し側のlimit（+1 sentinel）で制限。
- 拒否の二層: 入力・認可・期待版・墓標など予見できる拒否はDML前に`{status:"rejected"|"blocked", reasonCode}`で返す。DML後の不整合は例外。
- canonical payloadは`src/contracts`のcanonicalBytesで固定し、再送判定にはdigestだけを`world_operation`に保存する。
- domain間のFK・JOINなし。他domainの表を書かない。

## domain repository（各sqlite.tsが公開）

| domain | 書込み | 読取り | 削除/失効（forget・失効用） |
|---|---|---|---|
| identity | registerEntity, applyMerge, applySplit（expected revision付き） | getEntity, findAliasCandidates, listEvents | deleteEntities(refs) |
| assertions | insertAssertion（rev1）, applyTransition（head UPDATEがexpectedRevision一致で1件）, insertEvidence, insertInputs | getAssertion, getHead, listBySubject, listAssertionsBySourceKeys | deleteAssertions(refs) |
| projection | replaceProjection（同Scope置換）, advanceEpoch | readEdgesFrom/To（上限+1）, readCurrent, getEpoch | deleteProjectionFor(assertionRefs) |
| scenarios | insertPrediction, insertOutcome | getPrediction, listByComparison, listByBasisAssertion | deletePredictionsAndOutcomes(refs) |
| extraction | recordInbox, saveManifest, advanceCheckpoint | getInbox, getManifest, listManifestsBySourceKeys, getCheckpoint | deleteManifests(refs), deleteInbox(eventIds) |
| lifecycle | openGate/closeGate, recordOperation, insertTombstone, beginForget, saveForgetTargets, markTargetsDone | getGate, getOperation, getTombstone, getForget, listPendingTargets | — |

## applyWorldOperation(db, input)

入力は`{contractVersion:1, access, scope, operationKey, clock, hostChecks, operation}`。`hostChecks`は同じwriter snapshotからホストが渡す`{gate, sourceSnapshot, forgetEpoch, restoreEpoch, policyRevision}`で、検証済みboolだけを信用しない（World台帳と照合する）。結果は`{status:"applied"|"no_op", receipt}`または`{status:"rejected"|"blocked", reasonCode}`。`no_op`は不透明なreceipt参照だけを返し本文を返さない。

共通手順（C8）: (1)tx/版/size/access/Scope検査 → (2)gate・墓標・source状態を検査 → (3)operationKey照会（同digest=no_op、別digest=OPERATION_KEY_CONFLICT、再送でも現在の認可・忘却・source状態を再検査）→ (4)全予見拒否をDML前に判定（期待版不一致=REVISION_CONFLICT、墓標=TOMBSTONED）→ (5)台帳→投影→epoch→checkpoint→operation receiptの順に公開domain操作を呼ぶ → (6)applied/no_op。Worldはcommitしない。

| operation | 入力要点 | 読み書きする表 | 主な拒否理由 | 更新順 |
|---|---|---|---|---|
| entity.register / merge / split | pure計画（identity）＋expected revision | world_entity, world_alias, world_identity_event, world_operation | REVISION_CONFLICT, TOMBSTONED, MERGE_CYCLE | 台帳→operation（投影は不変） |
| assertion.register | AssertionDraft検査結果, evidence, inputs | world_assertion(+head), world_evidence, world_assertion_input, world_current, world_edge, world_scope_epoch, world_operation | SOURCE_NOT_AVAILABLE, TOMBSTONED, REVISION_CONFLICT | 台帳→投影→epoch→operation |
| assertion.transition（採用/争い/訂正/撤回/失効） | planAssertionTransition結果 | world_assertion, head, world_transition, projection, epoch, operation | 遷移表違反, REVISION_CONFLICT | 同上。supersedeは旧版停止と新版を同時 |
| candidate.settle | validateCandidates＋明示選択 | assertion表群, world_inbox, world_input_manifest, world_checkpoint, projection, epoch, operation | 選択不正, 遅着(TOMBSTONED) | 台帳→投影→epoch→checkpoint→operation |
| prediction.register / outcome.register | scenariosの検査済み入力 | world_prediction, world_outcome, world_operation | PREDICTION_NOT_FOUND, REVISION_CONFLICT | 台帳→operation |
| invalidate | 版付き対象＋理由code | assertion表群, projection, epoch, operation | — | 旧版停止→投影→epoch→operation |
| forget.reopen | forgetId, externalDeletionConfirmed | world_checkpoint（確認待ちmarkの削除）, world_scope_gate | FORGET_NOT_FOUND, FORGET_NOT_COMPLETE, FORGET_PENDING, EXTERNAL_DELETION_UNCONFIRMED, FORGET_NOT_AWAITING, GATE_NOT_CLOSED | 確認を記録→全forgetが確認済みでforget由来のgateならgate開 |
| forget.chunk | forgetId, 最大500対象 | 全payload表の削除, world_tombstone, world_forget_*, world_scope_gate, world_checkpoint（確認待ちmark）, projection, epoch | INVALID_INPUT, FORGET_REASON_CONFLICT, FORGET_ALREADY_COMPLETE | gate閉→次対象保存→台帳削除→投影の差分除去→墓標→進捗。完了時に確認待ちmarkを記録 |
| inbox.receive | feed, event, receivedCursor | world_inbox, world_checkpoint | EVENT_CONFLICT, TOMBSTONED, STALE_RESTORE_EPOCH | inbox→cursor→operation |
| restore.begin / register / reconcile / finish, rebuild | restoreEpoch（hostChecks）, 登録結果, journal page | gate, world_checkpoint, 派生forget, projection | RESTORE_NOT_IN_PROGRESS, DEPENDENCY_NOT_IN_LEDGER, JOURNAL_ROLLED_BACK, JOURNAL_NOT_RECONCILED, FORGET_PENDING, FORGET_AWAITING_CONFIRMATION, DEPENDENCIES_UNACCOUNTED, LEDGER_TOO_LARGE | 詳細は[公開API](world-sqlite-public-api.md) |

## readWorldSnapshot(db, request) と validateWorldUsage

`readWorldSnapshot`はホストのtransaction内（`inTransaction===true`）で複数SELECTを行い、単一Scopeのbounded snapshotと現在のscope epoch・forgetEpoch・restoreEpochを返す。transaction外は`WorldTransactionRequiredError`。履歴照会も現在の認可と墓標を検査する。`validateWorldUsage(db, receipt, current)`はwriter上でassertion版・source版・scope epoch・policy・forgetEpoch・restoreEpochをすべて照合する。

## 削除方針

forgetは payload表の行をDELETEし、残すのは[schema-v1.md](schema-v1.md)の「on forget」列がretainedの表だけ（不透明ID・forget ID・enum理由・cursor・digest）。自由文の理由は保存しない。
