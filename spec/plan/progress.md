# WorldModel 実装進捗

2026年10月31日追補: M0に続き、M1の本体再生経路、M2の保持/履歴目的の指示、M3の主張単位の必須指定、M4の登録provider接続基盤を実装・検証した。実装と意味品質・実モデル・hostの正式受入は分ける。改善の実装順は[次段階計画のM0〜M5](next-stage.md#0-計測しながら改善する実装順2026年10月31日追補)、最終実績は本台帳末尾を参照。

2026年10月28日更新。P0〜P2とP3-01は実装・検証済み。P3のhost結合およびP4/P5の一部は下表の条件で実施済み。実モデルの正式評価・実運用は未受入。以下は実装作業票の台帳であり、計画書の完成を機能の完成として記録しない。P0の22試験は[準備状況](../preparation-status.md)を参照。

状態は未着手、進行中、待機、完了。待機には不足する契約/配布物/許可範囲を具体的に記す。完了には実行結果へのリンクが必要。

| 票 | 作業 | 状態 | 証拠または待機理由 |
|---|---|---|---|
| P1-01 | 共通値と検査の基盤 | 完了 | test/contracts/common.test.ts 17件(A01,A02) |
| P1-02 | Memory共有型の配布境界 | 完了 | vendor/eumenes-memory(ローカル生成・非公式、manifest記録)、test/contracts/source.test.ts、test/tooling A17、一時consumer型検査 |
| P1-03 | 条件と時間の三値評価 | 完了 | domains/conditions 23件(A04-A06)、変異3件で失敗確認 |
| P1-04 | 対象の識別と可逆な統合 | 完了 | domains/identity 11件(A07) |
| P1-05 | 主張の検査と状態遷移 | 完了 | domains/assertions 70件(A08-A10) |
| P1-06 | 失効と忘却の純粋計画 | 完了 | domains/lifecycle 12件(A11) |
| P1-07 | 投影とWorldSlice | 完了 | domains/projection 38件(A12,A13,A24純粋部) |
| P1-08 | 関連と因果と依存の探索 | 完了 | domains/reasoning 22件(A14-A16)、相関伝播変異で失敗確認 |
| P1-09 | 仮定比較と予測照合 | 完了 | domains/scenarios 31件(A18) |
| P1-10 | 抽出の入出力検査 | 完了 | domains/extraction 17件(A19,A20) |
| P1-11 | 純粋規則の固定fixtureと公開面 | 完了 | fixtures/world-v1、test/contracts/public-api.test.ts、同root重複変異で失敗確認。全体verify 274件 |
| P2-01 | 物理schemaとAPIの仕様固定 | 完了 | spec/schema-v1.md(DDLは scripts/gen-migrations.ts で生成)、spec/sqlite-api-v1.md、test/sqlite/schema-design.test.ts |
| P2-02 | migrationとschema互換検査 | 完了 | 各domain repository/migrations/001.ts + infrastructure manifest/verify、test/sqlite/migrations.test.ts(A22) |
| P2-03 | 所有domainごとの同期repository | 完了 | 4子票(.a identity 16件/.b assertions/.c projection/.d scenarios)完了。file/WAL+memory |
| P2-04 | 複数domainの更新調整と再送 | 完了 | src/application/sqlite、test/scenario/{atomicity,replay}.test.ts(A21,A23-A26) |
| P2-05 | 一貫したsnapshotと限定照会 | 完了 | test/scenario/{snapshot,scope}.test.ts(A24,A27) |
| P2-06 | inboxとmanifestとcheckpoint | 完了 | extraction repository、inbox.receive/candidate.settle、test/scenario/settle.test.ts(A20,A28,A29) |
| P2-07 | 訂正と忘却の永続適用 | 完了 | forget.chunk/invalidate、test/scenario/{forget,correction}.test.ts(A11,A29-A31)。変異で失敗確認 |
| P2-08 | 復元と再構築の本体手順 | 完了 | restore.begin/register/reconcile/finish/rebuild、test/scenario/restore.test.ts(A32、journalはfixture) |
| P2-09 | 取得上限と性能の計測 | 完了 | 増分投影、scripts/bench-world.ts、spec/performance-baseline.md(A33)。10k Slice p95 約10ms、writer p95 1ms未満(M4機材のみ) |
| P2-10 | 永続化段階の受入 | 完了 | test/scenario/world-lifecycle.test.ts、spec/world-sqlite-public-api.md |
| P3-01 | 正式配布物と独立consumer | 完了 | scripts/pack.ts、test/consumer/package.test.ts 5件(A34)、spec/distribution.md。全体verify 639件 |
| P3-02 | 現行ホストとの境界固定 | 完了 | spec/host-contract-v1.md、Eumenes api/infrastructure/sqlite readSnapshot+snapshot.test.ts 3件(A35)、Eumenes verify:all成功。残: Memory版差(0.3.6)の照合はP3-05/06 |
| P3-03 | SourceAdapterと通常変更のoutbox | 完了(host fixture/実SQLite) | Eumenes api/domains/{conversation,world}: outbox migration、correct/retract、ConversationSourceAdapter。conversation 10+20、world 10件(A36)。retractは本文空化+retracted_atのtombstone(dialogue_runsのFKを保つ)、旧eventのrevision/digest消去、cursorは不透明化。2026-11-06: 初期同期backfillと有効化前のメタデータ受領を追加し、中断・再送・忘却を実SQLiteで検証。[追補](#host-sync-fixes-2026-11-06)。製品DBへの適用は未実施。retract後のdialogue/memory派生コピーはP3-05 |
| P3-04 | GoalSnapshotの公開口 | 完了(host実SQLite) | Eumenes api/domains/goals 12件(A37)。goal epoch/revisionで利用receipt失効判定。残: 操作冪等キー・World向け読取専用口の分離は未実装 |
| P3-05 | Memory依存登録と忘却復元の結合 | 完了(host temp file SQLite、crashはfixture) | Eumenes api/domains/world: memory-adapter、world-journal(別JSONL)、lifecycle-adapter、host-gate、feed consumer。world 63件、memory 2件(A25,A30-A32,A38)。2026-11-06: 一時hostで実Memory/World journalを使う10境界のSIGKILLと旧DB復元を検証。[追補](#host-sync-fixes-2026-11-06)。電源断・媒体破損・実運用は未受入。>500 rootsは複数forget(~n)に分割 |
| P3-06 | migration登録と手動入力の縦断 | 完了(host実Writer/temp file) | World migration7本+world_host_state/lifecycleを末尾に追加、manual-world.test.ts、migrations.test.ts 12件(A22,A25,A39)。World既定OFF。server.tsへの配線は未実施、製品DBへの実migrationも未実施 |
| P3-07 | Context Brokerと回答採用 | 完了(host実Writer/queue、fixture provider) | Eumenes api/domains/world/service/context-broker.ts、dialogue worldContext port、world_host_usage。context-broker 11件+dialogue/world-context 36件(A24,A40: 4注入点×7原因)。送信直前検査はWriter往復でありsend直前の窓は閉じられない。app.ts配線・実provider未実施。他セッション作業(timers)の途中変更によりEumenes全体testは一時的に失敗中のため最終確認は未了 |
| P3-08 | World回答の本文とTTS公開制御 | 完了(fixture、実ブラウザ/実TTS未実施) | Eumenes dialogue worldUsed/worldBlocked、progress()を採用済み回答のみ、attitude dataset先行保存の漏れ修正、voice canSpeak。voice-dialogue/test/world-release.test.ts 8件(A41: SSE本文とTTS spy)。ゲートを外すと6件失敗を確認。残: LARM delivery judgeへ未採用本文が送られる、Memory/agent-projection runの同種dataset保存、app.ts未配線のため実ブラウザ検査不可 |
| P3-09 | 最初の製品接続の受入 | 完了(host fixture)、実Local Provider未受入 | Eumenes api/application/world.ts(EUMENES_WORLD=off|protect|on、既定off)、world-acceptance-p3.test.ts 4件+world.test.ts 9件(A34host側,A35-A41)、real-local-providerは明示skip(未実施)。2026-11-06: 既存メッセージ初期同期を追加。[追補](#host-sync-fixes-2026-11-06)。残: 製品のmessage forget入口無し、既定Scopeのみ、実migrationは一時DBのみ。実モデル未受入はP4-05へ |
| P4-01 | 継続入力の受領と進捗 | 完了(host fixture/実SQLite) | Eumenes world/service/extraction-intake.ts、feedStages(owner→scanned→received→applied)、change-feed.test.ts 14件(A28,A29,A42)。2026-11-06: 初期履歴backfillと確定済みcursorからの再開を追加。[追補](#host-sync-fixes-2026-11-06)。packageにinbox/checkpoint読取APIが無くhost recordで代用 |
| P4-02 | Local抽出のqueue handler | 完了(fixture provider) | extraction-handler.ts(world.extract、larm-only/cloudAllowed=false、30s budget、slot再利用防止)、extraction-handler.test.ts 16件+application/world-extraction.test.ts 6件(A19,A20,A43、Cloud fetch 0)。実Local Provider未実施、entity listing無しでsubject名はSUBJECT_UNRESOLVED |
| P4-03 | 前景優先と取消と再開 | 完了(host fixture/stub provider) | Eumenes world/service/foreground.ts、extraction-handler(hold/unconfirmed slot/stale attempt)、application/world-foreground.ts、inferenceにforegroundBusy hook。scheduling.test.ts 11件+application/world-scheduling.test.ts 5件(A44)。実Local Provider未実施。前景=interactive laneの全job(長時間jobで抽出が止まる) |
| P4-04 | Runtime結果の観測化 | 待機(fixtureのみ。公開実行台帳が無く未受入) | runtime-adapter.ts+RuntimeLedgerPort fixture、outcomes.test.ts 14件(A18,A45のWorld部分)。待機理由: tool-runtime/agent-runtime/capabilitiesにcomparisonId/metric/unit/config/baseline/検証状態を持つ公開snapshotが無い。package側にoutcome source入力・prediction読取APIが無い |
| P4-05 | 日本語抽出の実モデル評価 | 待機 | W側基盤(dataset200件・runner・scoring・fixture)完了: eval/extraction、test/eval/extraction.test.ts 64件、spec/evaluation-baseline.md。2026-10-28にSQLite登録Localで実資料1件＋対攻撃2件の候補保存まで成功。正式holdout・日本語品質・host queueの実モデル受入は未実施（spec/evaluation-baseline.md）。小規模結果でP4-05全体を完了にしない |
| P5-01 | 判断APIを製品で使う入口 | 一部完了(Task連携は未受入) | Eumenes world-query(6 mode、上限、権限外、executionPermission none)、model tool定義、POST /api/world/query(未mount)、world-query.test.ts 14件(A14-A16,A47)。Task連携: 実Tasks domainにGap用kind/権限が無く未受入。tool登録・query mount・実resource stateは未配線 |
| P5-02 | 根拠付き一覧と訂正画面 | 完了(fixture backend、実機未実施) | Eumenes /api/world/{status,claims,forgets,...}、web設定画面World、world-claims.test 13件+http 4件+vitest 16件+Playwright 1件(A48)。訂正理由は本人の確認済みメッセージ。source本文表示・entity表示名・曖昧対象のbrowser caseは未実装/mock |
| P5-03 | 一つの改善仕事を閉じる | 待機 | W側の純粋規則評価完了: eval/scenarios/cache-latency、test/eval/cache-latency.test.ts 47件(A45,A49のWorld部分)。待機理由: host実行台帳・Tool権限・P5-01/02/P4-04(host) |
| P5-04 | Worldを使う意味品質の比較 | 待機 | W側harness完了: eval/decision、test/eval/decision.test.ts 74件、spec/decision-evaluation.md。待機理由: .aはP4-05.cのLocal正式受入とG5、.bはP5-03.i。fixtureのp5Acceptedは常に偽（2026-10-28の優先計画で分割） |
| P6-02 | CapabilityとToolchainと自己改善への証拠 | 未着手 | — |
| P6-03 | 複数Scopeと長期運用 | 待機 | 条件のみ固定: spec/operational-acceptance.md。24時間実測は未実施(H runnerが必要) |
| P6-04 | 運用手順と最終受入 | 待機 | 手順骨子: spec/operations-runbook.md。全手順が未実施 |
| M0 | 計測の入口・保全・再生・比較 | 完了（fixtureと合成実SQLite） | eval/measurement、専用6件、verify 1040件、build、既存3CLIと実性能2runの保全・比較。詳細は末尾 |
| M1 | 情報量/本体経路・dev原出力再生 | 完了（決定的fixture/実SQLite診断） | eval/pipeline、dev-trace、同一評価器の旧/新Slice比較、M06。最終verify 1058件。実LLMの有効性は未受入 |
| M2 | 条件/時点の保持 | 進行中（保持・表示・履歴目的の指示は実装/検証済み） | 既存validTime/condition/evaluateConditionsを再利用。既定指示v2は本文同一。履歴指示の実モデル意味品質・完全な過去時点監査は未受入 |
| M3 | 必須根拠の選択 | 進行中（本体契約と固定診断は実装/検証済み） | focusAssertionRefs、出典catalogの可逆表示、全表示4096bytesで3連鎖群の必要根拠6/6。実LLMの選択・未見品質はM4待ち |
| M4 | 実モデルによる採否 | 待機（登録provider adapterは実装/検証済み） | catalogのprofile=lfm2.5だがmodel=ornith1.5-strix、版情報なし。計画対象の固定モデル/版を同定できず正式生成未実施。モデルID照合・終了処理はstubで検証 |
| M5 | 運営者知識/実物一巡 | 待機 | M4の品質ゲートと既存のH/A公開契約が先行。兄弟repoは参照専用。M0/M1成功で親P4/P5を完了にしない |

P2-03は.a identity、.b assertions、.c projection、.d scenariosを個別記録し、4件とも完了してから親票を完了へ変える。

## 完了記録の書式

各票を実装したら以下を追記する。空欄のまま完了へ変更しない。

```text
票ID:
変更ファイル:
公開契約・migrationの変更:
受入ケースIDと試験ファイル:
実行したコマンド / 環境 / 結果 / 試験数:
実装: 未着手/一部/完了
fixture: 未実施/一部/成功
実SQLite: 対象外/未実施/一部/成功
host結合: 対象外/未実施/一部/成功
実モデル: 対象外/未実施/一部/成功
実運用: 対象外/未実施/一部/成功
残る制約と次に進める票:
```

対象外はその票の責務に含まれない検証にだけ使用する。実施できなかった検証は未実施とし、対象外へ置き換えない。

## P1 完了記録(2026年10月9日)

```text
票ID: P1-01〜P1-11
変更ファイル: src/contracts/*、src/domains/{conditions,identity,lifecycle,assertions,projection,reasoning,scenarios,extraction}/**、src/index.ts、scripts/{boundaries,domains,vendor-memory}.ts、vendor/eumenes-memory/**、package.json、bun.lock、tsconfig.build.json、fixtures/{conditions,identity,world-v1}/、test/contracts/*、test/tooling/boundaries.test.ts
公開契約・migrationの変更: 純粋APIのみ。migrationなし。scenariosのmaxObservationsはconditionsとの名前衝突のためmaxOutcomeObservationsへ改名。tsconfig.build.jsonはtypes:["node"](TextEncoder用)。devDependenciesにeumenes-memory(file:./vendor/eumenes-memory、型のみ)を追加。
受入ケースIDと試験ファイル: A01〜A20(fixtures/world-v1/cases.json に対応表)
実行したコマンド / 環境 / 結果 / 試験数: bun run verify:all(274件合格・失敗0)、bun run build 成功、verify -- --domain <8domain>各成功、macOS/bun 1.4.2
実装: 完了(純粋層)
fixture: 成功(合成fixtureのみ)
実SQLite: 対象外
host結合: 対象外
実モデル: 対象外
実運用: 対象外
残る制約と次に進める票: Memory配布物はローカル生成で、生成時点のMemory src(未コミット変更100件を含む)に固定。公式リリースではない。SAAA互換は共通fixtureで未確認(cases.jsonにunverifiedと記録)。次はP2-01。
```

## P2 完了記録(2026年10月9日)

```text
票ID: P2-01〜P2-10(P2-03は.a〜.d)
変更ファイル: src/application/sqlite/**、src/sqlite.ts、src/infrastructure/sqlite/**(db.tsのガード、migrations)、各domainのrepository/**とsqlite.ts、scripts/{boundaries,gen-migrations,bench-world}.ts、fixtures/performance/**、test/{sqlite,scenario,support}/**、spec/{schema-v1,sqlite-api-v1,world-sqlite-public-api,performance-baseline}.md
公開契約・migrationの変更: migration 7本(infrastructure + 6domain)を固定順で追加、hashはmanifestに固定。P0のmigrations配列を製品schemaに置換(probe試験はmigrations: []で維持)。scenarios.world_predictionにbasis列を追加(リリース前)。
受入ケースIDと試験ファイル: A21〜A33(test/sqlite、test/scenario、各domain test/*-sqlite.test.ts)
実行したコマンド / 環境 / 結果 / 試験数: bun run verify:all 473件合格・失敗0、bun run build 成功、bun run test:sqlite 20件、bun run bench:world 実行(macOS/Apple M4/bun 1.4.2)
実装: 完了(P2範囲)
fixture: 成功
実SQLite: 成功(一時file/WAL単一writer+readonly reader、memory)
host結合: 未実施(Eumenes Writer queue・実Memory登録は未受入)
実モデル: 対象外
実運用: 対象外
残る制約と次に進める票:
- 独立レビュー1回実施、指摘12件のうち11件修正、1件(manifestのない保留inbox eventのsource忘却到達)は制約として文書化。
- journalはfixtureで耐久性未受入(P3-05)。
- 台帳が200,000 head assertionを超えるScopeの全再構築はblocked LEDGER_TOO_LARGE(実測はせず単体試験のみ)。
- 性能値は1機材・合成fixtureのみ。他機材で再測定が必要。
- Memory配布物はローカル生成・生成時点のMemory src(未コミット変更含む)に固定。Memory更新時は固定commitを明示し、契約差分を確認してから再生成する（現在の手順はREADME）。
- P3以降(Eumenes結合、実モデル、実運用)は未着手。
```

## P3-01 完了記録(2026年10月9日)

```text
票ID: P3-01
変更ファイル: scripts/pack.ts、package.json(pack:local)、test/consumer/package.test.ts、spec/distribution.md
公開契約・migrationの変更: なし(配布用package.jsonは生成物のみ)
受入ケースIDと試験ファイル: A34(test/consumer/package.test.ts)
実行したコマンド / 環境 / 結果 / 試験数: bun run pack:local 成功、bun run verify:all 639件合格・失敗0(consumer 5件を含む)、macOS/bun 1.4.2
実装: 完了
fixture: 成功
実SQLite: 成功(consumerのbun:sqlite memory DBでmigration適用+1操作)
host結合: 対象外(P3-02以降)
実モデル: 対象外
実運用: 対象外
残る制約と次に進める票: Memory配布物はローカル生成(非公式)。tgzバイト列の環境間同一性は未検証。P3-02以降はEumenes変更を含む依頼が必要。
```

## P3-02〜P6 の扱い(2026年10月9日)

**以下は2026年10月9日の依頼範囲の履歴。現在の状態は冒頭の表と後続記録を参照。**

当時の依頼は「World本体のみ」(../eumenes は参照専用、変更なし)。当時の完了はP3-01まで。P3-02〜09、P4-01〜04、P5-01/02、P6-02はEumenes変更を含む依頼が必要で未着手。P4-05/P5-03/P5-04/P6-03/P6-04はW側の基盤・条件のみ実施し、実モデル・host結合・実運用は未受入。全体verify:all 772件合格、build成功。全体完成ではない。

レビュー反映(2026年10月9日): 独立レビュー1回、指摘9件+軽微1件を一括修正。抽出評価はdataset v2/ext-threshold-v2、判断評価は対照条件plain-factsと否定対応の禁止語判定、配布はd.ts export一致検査を追加。verify:all 824件合格、build成功。

P3-05/07 独立レビュー反映(2026年10月10日): 確認coverage検査(依存キー1つ以上が根でカバー=強い版の「全て」ではない)、root検証/abandoned part、release失敗の分離、post-escape予算、cursorSecret必須、setEnabled(true)はinitial sync完了までrefuse(guard migration)等。Eumenes world/dialogue/memory/goals/conversation/migrations 221件合格。

## 実資料seedのプロジェクト内試験(2026年10月16日)

目的は、収集を区切った登録984件を固定し、WorldModel内で取り込みを試すこと。
本依頼はEumenes結合や既存の未受入票の完了を意味しない。

- 対象: `data/worldmodel-corpus/seed/v1.json` の `grok-984-v1`。
  11コレクション・984件、過去の保留17件は除外。既存資料は変更せず、
  accepted/manifest/reviewsのバイト数・SHA-256を固定した。
- 実装: `eval/seed/` の読取り・試験ホストと `bun run seed:world`。
  既存のprepareExtraction、同期のinbox.receive、ページ読取り、チェックポイント、
  一時file/WALのtest/supportを再利用。公開契約・migration・srcの変更なし。
- 部分検証: `bun test test/eval/seed.test.ts` 7件成功。
  改変・欠損・重複・件数違いの拒否、資料・条件・レビュー保持、長文保留、
  再投入、全ページの照合、トランザクション巻戻し、一時DB回収を確認。
- 実資料の通し検証: `bun run seed:world` 成功。984件保存、5ページ照合、
  再投入984件すべてno_op、receivedCursor=984/appliedCursor=null。
  抽出準備983件、b5-ai-002の1件はUTTERANCE_TOO_LARGEとして全文を保持。
  収集者のverifiedから採用済み主張を自動生成しないことを公開読取りで確認。
- 全体検証: `bun run verify` 840件合格・0失敗、整形・lint・型・境界検査成功。
  `bun run build` 成功。着手前の同じverifyは833件合格。macOS / Bun 1.4.3。
- 結果: `artifacts/seed/grok-984-v1-report.json`。資料本文と結果はGit対象外。
  固定manifestと使い方・試験コードのみ共有可能。再現にはローカルの資料一式が必要。
- 差分点検: コードはIO・整合性検査・試験実行のみ。語句による意味分類・条件変換・
  仮の候補生成・activeへの自動昇格なし。兄弟プロジェクト・製品DBへの変更なし。
- 未実施: 実モデルの意味抽出、候補採用、判断への効果比較。任意の接続先確認への
  回答は未着。ローカルOllamaの既定ポートは接続不可だったため、モデル試験を
  成功扱いせずnot_run/not_measuredとして残した。P4-05/P5-04等の未受入状態は維持。

## Codex SDK / Lunaの独立Example(2026年10月16日)

ユーザー指定により、Ollama等の接続待ちから、Codex SDKのLunaを使う
プロジェクト内のExample試験へ進めた。Eumenes結合や984件全体の採用は対象外。

- 変更範囲: `examples/seed-luna/`、`test/eval/seed-luna.test.ts`、開発用コマンド・
  SDK依存・examplesの型検査と文書。公開契約、migration、src、兄弟プロジェクトは変更なし。
- 接続: `@openai/codex-sdk@0.163.0`、`gpt-6-luna` / medium、既存のChatGPTログインを利用。
  推論はCodexのリモート接続先。登録済みLocalモデルの受入条件G5を満たしたとは扱わない。
- 手順: 固定seedから手で選んだAI/R/M/L/F各1件と合成攻撃文書1件を提示。
  既存prepareExtraction/validateCandidatesの明示選択handoffを経て、同期公開APIで
  candidate保存・履歴照合・再投入・active不在を、一時file/WALの実SQLiteで確認。
- LLMの担当: 主張の意味、対象の選択、帰属、条件、引用元フィールドの選択。
  コードの担当: 既存資料の入出力、JSON Pointerから引用バイト位置への変換、契約検証、
  ホストID・Scope・採用境界、状態保存。語句・主張ごとの意味補正は追加していない。
- 試行1(seed-luna-v1): 最初の引用がJSONエスケープ不一致で拒否、次の呼出しが120秒で中止。
  失敗記録は `artifacts/seed-luna/2026-10-16T01-26-16.569Z-dfd70d55/report.json`。
- 試行2(seed-luna-v2): JSON Pointerと転記した引用文を照合。実資料4件+合成1件は保存、
  研究資料1件はCRLF等の転記違いで拒否。年金条件で年齢が式から漏れ、60歳/12年でも
  satisfiedになることを追加確認。期待値は変更せず、引用受渡しとLLM指示を見直した。
- 試行3(seed-luna-v3): モデルが選んだフィールド全体を正確に引用する方式に簡素化。
  すべての明示的な適用条件を式へ含める指示に変更。最終runは
  `artifacts/seed-luna/2026-10-16T01-34-47.651Z-5bef7a03/report.json`。
  6入力→各1候補、全6件の引用・検証・保存・履歴照合・no_op再投入成功、active 0件。
  年金例は65歳/8年=violated、65歳/12年=satisfied、60歳/12年=violated。
  合成攻撃文書は架空サービスの記載として処理し、ツール実行・active昇格は観測されなかった。
- 俯瞰評価: 3試行で引用の転記と条件欠落を切り分け、証拠に対応するIOと指示だけを変更。
  最終試行で予定の6例を完走したため、同じ試験の追加反復は行わず結果を記録する。
- 検証: 着手前verify 840件。追加のfixture 6件、全体 `bun run verify` 846件合格・失敗0、
  整形・lint・型・境界検査成功、`bun run build` 成功。macOS / Bun 1.4.3。
- 残る制約: 小標本の動作確認であり、精度スコアや984件全体への外挿はしない。
  entity/predicate/観測キーはExampleのホストfixtureで与えた。関係抽出・validTime型化・
  正式採用・inbox settle・回答の効果比較は未実施。RFC例の「現在」の基準時点明示は
  引き続き確認が必要。過去の未受入票の状態は変更しない。

## seedの有無によるLuna回答比較(2026年10月16日)

目的: このプロジェクト内の実験場で、seedなし／資料のみ／同じ資料＋WorldModelの
回答差を測る。`examples/` は以後も多様な検証の実験場として扱うユーザー指示。

- 範囲: `examples/seed-answer-comparison/`、`examples/README.md`、fixture試験、
  コマンドと文書。既存のSDK接続に任意の実験用指示を渡す引数だけを追加し、既定の抽出指示は維持。
  src・公開契約・migration・Eumenes等の兄弟プロジェクトには変更なし。
- 実験設計: 5実資料、事前に定めた12問、2反復、3条件、計72回答。
  RawとWorldは同じ資料全文・同じシナリオの事実を使用。Worldは既存のSQLite公開読取りから
  buildWorldSlice、evaluateConditionsを通した整理結果を追加。候補はcandidate、activeは0件。
  採点の期待内容を回答モデルへ渡さず、順序を均等化、A/B/Cの条件名を伏せてLunaが24組を採点。
- 実行環境: @openai/codex-sdk 0.163.0、gpt-6-luna / medium。sampling seed/temperatureは
  SDKで設定しておらずnullと記録。推論はCodexのリモート接続先、正式Local受入とは別。
- 初回の採点呼出しだけ120秒で中止。3回答のキャッシュを保ち、コード・指示・rubric等の
  ハッシュを一致確認して未完了部分から再開。その後72回答・24組完走。
  証拠は `artifacts/seed-answer-comparison/2026-10-16T02-05-02.865Z-158c5f3a/`。
- 結果を確認して採点器の誤適用を発見: 正しい保留まで誤答扱いし、seedなし6.58/8。
  回答・質問・期待内容・元の採点を変えず、回答者の出典可視性と同じ採点基準の適用を
  明示した事後監査を全24組実行。監査後seedなし7.29/8、Raw/Worldはいずれも8/8。
  元の採点は上書きせず、audit-2026-10-16T02-21-55.828Z-58d5630bへ別保存。
- 監査後にも、不要な数値の欠落や妥当な補足への過大減点が一部残るため、総合点を
  確定的な品質差とは扱わない。追加の採点調整を重ねて希望する数値を作ることはせず、
  Codexが全72回答を読み、具体値・対象・条件を定性的に照合した記録を別に残す。
- 強い観測: 論文固有の具体値2問×2回はseedなし0/4（数値誤り1・適切な保留3）、
  Raw/Worldはいずれも4/4回答。一般原則や年齢条件はseedなしでも概ね回答できた。
  World対Rawの採点は24組同点で追加効果未確認。両者満点の天井もあり他課題へ一般化しない。
  Worldの平均入力tokenはRawより約4.0%増、平均回答時間はno-seed 6.70秒/Raw 6.61秒/World 6.37秒。
  採点器依存の改善数は監査後8/24組、悪化0。生回答の差と区別して報告。
- 検証: 着手前verify 846件。追加fixture 5件（順序・ラベル、採点値の検査、悪化の扱い、
  引用数を意味点へ混ぜないこと、実SQLite/同一原文/候補/条件評価/正解非開示）。
  全体verify 851件合格・失敗0、型・整形・lint・境界成功、build成功。
  採点器の既知の誤判定3件を凍結回答の回帰ケースとして保存し、実監査出力で3件合格。
  全24組の監査キャッシュ再利用も確認（モデル再呼出しなし）。
- 完了範囲: `comparison.md` に集計・解釈・全回答を保存。`codex-review.json` に
  残る採点問題を記録。差分点検で意味判断を置換する専用分岐なし。固定の質問・観測は試験fixtureのみ。
- 制約: 手で関連資料を選んだ5原典、12問は同一原典を共有し2反復も独立標本ではない。
  抽出調整と年齢設問の重複あり、holdoutでない。検索、984件全体、正式採用、回答公開、
  長期更新・訂正・忘却・複数資料競合の効果、外部原典の真実性・最新性は未検証。
  同一Lunaによる採点・事後監査・Codexの定性確認であり、独立した人手評価も未実施。
  G5/P5等の未受入状態を変更しない。

## 複数資料・更新・条件のLuna比較(2026年10月16日)

- 目的・範囲: ユーザー依頼に基づき、資料全文と同じ全文＋WorldModelを比較。
  `examples/multi-source-comparison/`、実験用試験、コマンド・文書のみを追加。
  src・契約・migration・seed984件・隣接リポジトリは変更しない。
- 設計: 架空15資料・4資料群・16問・2反復・2条件で64回答。
  訂正と撤回、将来の施行時刻、同格の未解決矛盾、対象範囲、AND/OR/否定、
  観測値欠落・同順位衝突・鮮度の境界を固定。正解・採点計算を実行前に固定。
  gpt-6-luna / medium、SDK 0.163.0、毎回新しい会話、ツールなし。
- 再利用: 既存SDK隔離・候補validator・引用Pointer検証・公開SQLite API・Slice・
  三値条件計算とtest/supportの接続生成を使用。意味、条件、撤回・矛盾の選択はLuna。
  コードは外部表現・参照・契約の検証、時計比較、保存・再投入、既存の条件計算を担う。
  すべてcandidateのまま。明示的な撤回＋置換はretractと独立した新候補で表現。
  各問で、その時点までの撤回を別の一時DBに再生する。連続運用・巻戻しは未検証。
- 部分検証で、追加fixtureの期待と既存契約の不一致を切り分けた。
  未施行のvalidTimeはviolated、撤回は旧行も停止、履歴は新版からという既存仕様を確認。
  3ラウンド時に俯瞰評価を通知し、製品を変更せずテストの誤った前提を修正して解消。
- v1は64回答完了。ただし事前抽出だけに観測キー定義を与え、Rawには未提示という
  情報量の偏りを発見。時刻のISO/epoch混在、共通方針への架空の引用IDもあった。
  結果・コードは`2026-10-16T03-14-32.958Z-c1bda943`に保管し、正本にしない。
  健全な実行を途中編集で無効化せず、完了後に別版を固定。
- v2は両条件に同じキー定義・明確な時計表示を渡し、提示資料IDだけを出力schemaの
  列挙で許可。意味的な資料選択はLunaが行う。質問・正解・採点計算はv1と同一。
  質問非開示で生成した4件の実抽出をdigest照合して再利用し、回答64件を新規生成。
  先行結果を見て提示を修正した開発評価であり、holdoutと呼ばない。
- 正本: `artifacts/multi-source-comparison/2026-10-16T03-24-55.222Z-6d3f8ec2/`。
  判定一致Raw 25/32、World 30/32、根拠集合は両方32/32。
  対応比較は改善5・悪化0・両方正解25・両方不正解2。改善は4設問に分布。
  複数資料の矛盾・訂正そのものはRawでも良好で、OR・欠落・観測で差を観測。
  Worldでも誤許可1件。両方不正解の問いでRawはdeny、Worldはallowのため、
  「悪化0」はリスクの改善を保証しない。説明と判定欄の不一致も保存し、採点は変更しない。
- 本体の条件判定はO02=unknown/STALE_OBSERVATION、O03=satisfiedだったが、
  それぞれLunaの判定欄allow/denyという不整合があった。正答でも観測値を説明で
  読み違える例、O2の抽出で未明示の有効開始日を公表日から付与する例も記録。
  `findings.md`、全回答の`comparison.md`、Codexによる`codex-review.json`を保存。
- 回答入力tokenはWorldで約8.7%増、平均時間Raw 5.97秒/World 5.76秒。
  初回抽出4呼出しは約64.67秒・入力55,914/出力5,409tokens。v2では固定出力を再利用。
  全キャッシュ再開で追加モデル呼出し0、reportとevents不変を確認。実行失敗0件。
- 検証: 着手前verify 851件。追加fixture 5件、全体verify 856件合格・失敗0、
  11,932 expect呼出し、整形・lint・型・境界成功、build成功。報告生成も実行。
  差分点検で意味判断を代替する個別語句・シナリオ分岐なし。質問と正解は実験fixtureのみ。
- 制約: 合成の明示的な業務規程、4資料群、2反復。実seed984件の検索品質や実論文群へ
  外挿しない。事前整理だけの第三条件がなく、整理とWorld単体の効果を分離していない。
  4資料群の抽出は各1回だけ。独立した人手評価、正式採用、連続更新運用は未検証。
  G5/P5等の正式受入状態を変更しない。

## 計算とLuna最終判定の整合改善(2026年10月16日)

- ユーザー依頼: 前回確認したWorldの計算とLunaの最終判定の食い違いを改善し、
  同じケースで再検証する。範囲は既存Exampleの回答経路・回帰試験・記録のみ。
  先に既存の回答指示・SDK・入出力schema・共通の計算を確認し、指示と提示の再利用から着手。
  src・公開契約・本体の計算・抽出・984件seed・隣接プロジェクトは変更しない。
- 目的の固定: 同じ15資料、16問、観測・正解、固定済みの4抽出を維持。
  主判定と資料ID集合の採点も維持。計算と最終判定の対応を改善し、最初の生応答を採点。
  モデルはgpt-6-luna / medium。正解や失敗例そのものを回答プロンプトに加えない。
- 指示・提示: 主張とconditionEvaluationを同じ要素に結合し、根拠資料・規程別評価・
  説明を先に、最終decisionを最後に出力する。適用規程・権限・範囲の意味判断はLuna。
  unknownは計算の失敗ではないこと、理由コードは全観測の欠落を意味しないことを明示。
  元のSlice・計算・SQLite履歴はcontexts.jsonへ保存し、回答向けの結合表示と区別。
- 最小の追加検査: 型が正しいJSONでも以前の不整合2件を受け入れてしまっていた測定結果を根拠に、
  grounding.tsで参照先、計算結果の転記、Lunaが選んだ規程の自己申告と最終判定の対応を検査。
  規程を選択したり、原文を分類・解釈したり、回答の書換え・自動再試行をしたりしない。
  原文との不一致をモデルが主張するoverrideは、通常の成功とは別に要確認へ記録する。
- 部分検証: 不明→誤許可、satisfiedの誤転記→自己整合した誤deny、上書きの可視化、
  出力順とschemaの全選択肢維持、参照と計算の結合を回帰試験で確認。
  JSON schema helperの型情報消失を型checkで検出し、汎用型を保持して修正。
  自己整合したRawの意味的誤答も再現し、整合検査が主採点を置換しないことを試験化。
- v3: 64回答完了。Raw 29/32、World 32/32。計算と最終判定の不一致0。
  ただし計算参照元の分類をモデルに自己申告させたため、Worldの4回答で参照形式が不整合。
  `2026-10-16T03-40-43.427Z-cc48b159`に元の回答・指示・コード・検査結果を保存。
- 俯瞰評価: 正しい最終判定と参照形式の不備を分離し、参照元の有無はホストが既に知る情報だと判断。
  利用者へ見直し理由と次の一手を通知し、v4で不要なbasis分類を削除する方針へ変更。
  WorldのassertionIdは渡したIDの列挙、Rawはnullという既存schema機構へ移す。
  resultとdecisionは全3値を許容し、モデルの最終判断や意味解釈をコードへ移していない。
- 最終v4: `artifacts/multi-source-comparison/2026-10-16T03-50-30.270Z-7aaf0b74/`。
  新規回答64件、抽出再利用4件、失敗0。World判定32/32、根拠集合32/32、
  38計算の転記不一致0、根拠票と最終判定の不一致0。以前のO02/O03は両反復で正解。
  Raw判定29/32。改善前v2のRaw 25/32・World 30/32・誤許可1件と別版で記録。
  v4のWorld誤許可0、対応比較は改善3・悪化0・両方正解29。
- 残件の可視化: WorldのD04・2回目は、未観測のfreeze=falseを説明とoverride理由へ補う誤認。
  計算・根拠票・判定はunknown/holdで正しいが、全項目の整合成功とは数えず31/32と報告。
  Rawの温度上限の誤記やOR/鮮度の誤解も別保存。Codexが全64回答を点検し、主採点は変更しない。
  この既知ケースへさらに指示を追加し続けず、判定の改善と説明の残件を分けて結果を確定。
- 完了証拠: findings.md、全回答comparison.md、版比較revision-comparison.json、
  codex-review.json、再生replay-check.json。全16問の元の計算結果・質問・正解・資料の
  改善前後の一致、全64生応答でdecisionが最後、全要求で正解非開示、153コードdigest不変を確認。
  全キャッシュ再開で追加モデル呼出し0、report/eventsのdigest不変。
- 検証: 着手前verify 856件。追加・拡張後は859件合格・失敗0、11,959 expect呼出し。
  型・整形・lint・境界・build成功。差分点検で本体変更・個別語句や質問への専用分岐なし。
- 限界: 同じ合成16問の回帰評価で、holdoutではない。v3/v4は複合変更の効果であり、
  順序や指示だけの効果は分離していない。反復や資料群も独立ではない。説明全体の正確性、
  未見ケース、長期運用・正式採用・G5/P5等の正式受入は保証しない。

### 説明文の事実誤認への追加対応（v5、2026年10月16日）

- ユーザー依頼: 残っている説明文の事実誤認を改善し、同じケースで再検証する。
  目的は判定だけでなく説明の根拠との対応を改善すること。範囲はExampleの提示・指示・試験・記録。
  既存のSDK、出力schema、指示、観測、条件計算を確認してから変更した。
- 原因: v4のD04・2回目は未観測のfreezeをfalseとして説明し、他の既知入力も未提示とした。
  原文の要求値と実際の観測の混同。元の回答・質問・report digestを固定fixtureとして保存。
- 方針: 両条件へ観測キー→提供済みIDの存在表を追加。Worldの比較ASTの各項目には、
  位置・要求値・実在の入力IDと、既存evaluateConditionsの結果を表示時に追加する。
  判定ロジックの複製はせず、各比較は親の論理演算・主張の有効期間と区別して表示する。
  LLMの指示に要求値／観測値／成立判定の区別、必要事実のみの説明、値・日時・閾値の照合を追加。
- 不変条件: 15資料・16問・観測・正解・主採点・4抽出はv4と同一。
  抽出キャッシュの全byte、全16問の入力と主張全体のnative計算が同一であることを照合済み。
  原文の意味・適用資料・説明はLunaが判断する。コードによる語句訂正・回答書換え・再試行はしない。
- 部分・結合検証: 名前を変えたキー、未観測とfalse、否定前の比較、古さ・相反観測、
  元のSlice不変と両条件への同一観測の提示を確認。元の誤説明が正しい主判定を持つことも試験化。
  JSON fixtureの型拡張によるテストの型エラーは比較対象の型をunknownとして正し、期待値は維持。
  verify 861件合格・失敗0、11,989 expect、型・lint・整形・境界・build成功。
- 実モデルの通し検証は固定v5プロトコルで実施中。完了後、全64回答の説明点検と比較を追記する。
- 通し検証完了: `2026-10-16T04-16-52.048Z-8ae3d380`。成功64回答・抽出再利用4件。
  Worldの判定32/32、資料集合32/32、計算転記不一致0、根拠票と最終判定の不一致0、上書き0。
  全64回答を原文・観測・計算に照らして点検し、Worldの説明の事実・条件解釈の誤りは未検出。
  D04の両反復で凍結状態が未観測であると説明。資料全文は30/32、説明の誤り2件、誤許可1件。
- 別の残件: World O04・2回目は、補助的な測定方針O2を許可規則の根拠票に余分に追加。
  説明では正しく独立した許可規則ではないと述べ、holdも正しい。意味的な契約の残件として保存し、
  自動の参照・転記・自己整合検査の32/32を、全出力の完全な意味的正しさとは報告しない。
  R01の非決定的な暗号化falseへの言及も、値の誤りとは区別して明瞭さの指摘を残す。
- 通信中断: 38呼出し目に接続403で失敗し、既存のresumeを使い手動再開。
  前37成功応答のbyte不変を照合し、未取得1件と未実行分のみ実行。内容による再生成・差替えなし。
  成功64件・接続失敗1件をevents/transport-interruption.jsonに保存した。
- 再現性: 資料・質問・正解・抽出・主張全体計算はv4と同一。全32組の共通入力の一致、
  全64生応答の保存とdecision最終フィールド、正解非開示、154コードdigestとsnapshot一致を確認。
  全キャッシュ再開で追加モデル呼出し0、report/eventsのdigest不変。
- 完了記録: findings.md、comparison.md、codex-review.json、revision-comparison.json、
  input-invariance.json、transport-interruption.json、replay-check.json。
  意味的点検は実装したCodex自身であり、独立した盲検評価ではない。既知合成ケースの回帰確認。
  指示と入力表示の複合変更で効果は分離せず、未見・実資料・長期運用や正式受入は保証しない。
  Worldの入力tokens増約18.3%も併記。差分に本体変更・観測語句や質問への専用分岐なし。
- 最終確認時点の全体verifyは865件合格・失敗0、12,221 expect、52ファイル。build・diff check成功。
  途中で担当外のlinked-answer-holdout Exampleと試験4件が同じ作業フォルダへ追加されていたため、
  変更直後の861件と区別する。担当外は依存の読取り確認のみで編集せず、今回のモデル入力に使う
  154コードのdigest不変を再確認した。今回の実験結果を追加のholdoutの受入結果とは扱わない。

### 適用規程と計算結果の対応付け・未見比較（2026年10月16日）

- ユーザー依頼: 優先度1の回答方式比較を進め、進行中の変更を再利用し、未見設問で効果を検証する。
  範囲は新規Example `examples/linked-answer-holdout`、fixture試験、実験記録。
  既存v4の指示・出力schema・結合表示、抽出、SDK、SQLite公開API、根拠監査を再利用。
  並行して進むv5の原子条件検査は混ぜず、旧v4全16問の要求文・schemaの完全一致を保存した。
- 実行前に8新規資料群・32問・期待判定・適用規程別期待値を固定。2反復・2方式・順序反転・2並行。
  抽出へ質問や正解、回答へ期待値は渡さない。指示・schema・提示の組全体の比較で、単一要因効果ではない。
  固定コード167ファイルを別保存し、共有コードの進行中の変更から実行を隔離した。
- 部分検証: 新旧資料の分離、入力の情報一致、正解非提示、適用規程の期待値による独立採点、
  自己整合した不正な根拠票の検出、失敗を含む分母を4試験で確認。
  検証途中に共有v5との差を検出し、v4入力の固定へ修正。型・構文の修正後に俯瞰評価し、
  指示調整ではなく入力一致を確認する方針で続行。verify 865件成功・失敗0、build成功。
- 初回 `2026-10-16T04-25-30.682Z-bfdced73`: 抽出3件が403で失敗、後続5抽出と80回答は成功。
  判定は従来34/40、対応付け40/40。予定分母では34/64、40/64。88新規SDK呼出し。
  初回の失敗・生応答・採点を保持し、品質が悪い応答の再生成は行わない。
- 接続復旧の証拠を得て、別の`-transport-supplement`へ補足条件を事前保存。
  未回答の抽出3件を各1回だけ再実施、成功済み5抽出・80回答は全byte再利用。
  3応答とも取得できたが、DS3がhypotheticalとしてHYPOTHETICAL_NOT_FACTで拒否され、
  drone-schoolの4問は未回答のまま。DS1/DS2の受理・DS3の引用束縛成功と拒否理由を保存。
  既存の「全資料1候補必須」が資料群全体を停止する問題を記録し、本体検査を緩めない。
- 補足込みの28問・各2回: 判定48/56対56/56、改善8・悪化0、誤許可0/34対0/34。
  全予定では48/64対56/64（各8件未回答）。根拠集合55/56対56/56、判定との同時一致47/56対56/56。
  正しい許可18/22対22/22、正しい保留16/20対20/20。改善は3資料群に集中、両反復で24/28対28/28。
- 残件: 対応付けAC04・1回目は観測取扱規程を許可規程の根拠票に含め、unknownをsatisfiedに変更。
  最終holdは正しいが、既存監査と期待規程集合による検査が不整合を検出し、監査合格55/56。
  CP02・2回目は観測済みpersonal=falseを未観測と説明。構造監査だけでは検出できない。
  全112説明をCodexが点検し、事実誤認・説明の曖昧さ・主判定を別記録。独立の人手評価ではない。
- 完了証拠: findings.md、comparison.md、explanation-review.json、extraction-diagnosis.json、
  evidence-check.json、supplement-protocol.json、replay-check.json。7資料群の期待計算32件一致、
  全56ペアの情報一致、正解キー非提示、167コードdigest不変、85成功キャッシュ不変。
  初回・補足とも追加モデル呼出し0で再生し、report/eventsのdigest不変。
  新規呼出しは合計123（初回88＋補足35）。通常verifyはモデルを呼ばない。
- 判断: coreの記録・投影・三値計算とLLMの適用判断の役割分担を維持し、対応付け回答を次の比較の基準候補にする。
  未見の合成問題で改善したが4問は未比較、説明と抽出の課題が残る。実モデル結果は失敗を保持した完了で、正式受入ではない。
  次は進行中v5を別の新規設問で比較し、抽出の文書単位の失敗扱いは別実験で検討する。
  本体src・公開契約・既存実験のコード/結果・隣接プロジェクトは変更なし。個別設問への製品分岐なし。

### commit後の資料役割比較・新形式不採用（2026年10月16日）

- ユーザー依頼: まずcommit・pushし、次の課題を計測した上で再度commitして良いものを残す。
  未見比較の完了記録を `1703351` としてcommit・origin/mainへpushした後に着手。
- 次の課題は許可規程と補助資料の役割混同。既存v5の指示・schema・入力を基準とし、
  roleとassessmentを資料ごとに一つの記録へまとめる候補を、新しいExampleだけで実装。
  役割はLLMが選ぶ。コードは自己申告した契約・参照を検査し、資料の意味を分類しない。
  許可規程・補助資料の兼用も表現する。元の判定・転記監査・SDK・抽出・SQLiteを再利用。
- 既知4問、新規4資料群12問、各2反復・2条件・順序反転・2並行。最大4抽出＋64回答。
  主指標は判定・適用資料集合・許可規程評価集合/結果・既存監査のすべての一致。
  役割ラベルの一致は候補だけの副指標で、共通の主指標には混ぜない。
  採用条件と期待値をモデル実行前に固定し、出力を見て変更しない。
- 部分試験6件成功。v5の実際のO04誤答を再現し、自己整合成功だけでは意味的に正しいとしない。
  正解非提示・兼用文書・不正な役割自己申告・意味的誤分類・未回答分母・順序反転を確認。
  試験コードの型注釈の最終整理が全体検証中に重なったため俯瞰評価し、編集停止後に再検証。
  最終verify 871件・失敗0・12,325 expect・53ファイル、build成功。
- 実モデルrun: `artifacts/source-role-comparison/2026-10-16T05-03-31.643Z-4a3ad05c/`。
  4抽出・64回答完了、失敗0、新規呼出し68。判定は双方32/32、誤許可双方0/22。
  主指標はv5 32/32・候補30/32。既知8/8対6/8、新規24/24対24/24、改善0・悪化2。
  候補の役割ラベルは27/32。O04で観測方針を許可規程に混入、CP02で権限のない資料を根拠へ追加。
  別の3件では許可規程を余分に兼用と分類したが、判定と評価集合は正しいため副指標だけの誤りとした。
- 全64説明を点検し本文の明確な事実誤認は未検出。ただし独立した盲検評価ではない。
  参照・転記・自己整合の監査は双方32/32であり、意味的な主指標の悪化を検出できるとは扱わない。
  候補の回答出力tokenは6,812でv5の6,314から約7.9%増。平均時間は8.74秒対8.60秒。
- 結論: 事前採用条件に不合格のため新形式を採用せず、既存v5を維持する。
  既存Example・本体・公開契約・抽出拒否の扱いを変更しない。個別資料名による修正なし。
  比較実装と失敗例は不採用表示を付けて検証資産として保存。改善を得るまで同じ問題を調整し続けない。
- 完了証拠: 全32ペアの入力一致、正解非提示、175コードdigest不変、期待計算19件一致、
  既知context不変、全生応答のdecision最終項目を確認。追加モデル呼出し0で再生し、report/events不変。
  Gitに持ち運べる結果は `fixtures/experiments/source-role-comparison/2026-10-16.md` と同名JSON。
  JSONは4抽出・64回答の生出力と採点・説明点検・照合・再生証拠を含み、秘密や接続認証は含まない。

### 抽出拒否からの回復比較・既定採用保留（2026年10月16日）

- ユーザー依頼: 一部資料の抽出拒否による全体停止を改善し、既存v5を維持して比較・計測、commit/pushする。
  開始時mainは`62cb06d`・originと一致、未コミット変更なし。新Exampleと試験・記録だけを変更。
- 実失敗DS3の`HYPOTHETICAL_NOT_FACT`と全体停止を保存済み生応答で再現。
  最初に既存v5の原文回答を再利用し、仮定の拒否・候補0件だけ全原文へ切り替える案を比較。
  文書の意味による分岐はコードに置かず、文書全体の形式・引用・参照等を検査する。
- 第1回20問×2反復×2方式、モデル回答48件。既存v5は32停止、回答8/40、主指標7/40。
  原文切替は40/40回答、判定38/40、主指標36/40、誤許可0/26。
  FC03のOR誤解、FC04の説明/評価不一致が各2回起き、不採用。
  新規作成16問の3問が過去と観測条件重複と判明し、実行を変えず分類を訂正。
  未見条件13問は判定24/26・主指標22/26。既知4問・重複3問は別集計。
- 新しい根拠（計算を原文回答へ戻すと誤りが再発）を受け、次は資料群を1回だけ再抽出。
  LLMに出典へ帰属したreported候補を作らせ、未承認提案を事実や有効規程に変えない。
  コードによるmodality書換えなし。既存の候補検証・登録・撤回・条件計算をそのまま利用。
  正常時は再抽出せず、2回目の拒否や通信失敗は停止。原文回答への降格や再抽選なし。
- 第2回は元20問を開発用として扱い、新しい観測条件8問を追加・事前固定。
  計28問×2反復×2方式。再抽出4件＋回答68件=新規72呼出し。
  既存v5は44停止、回答12/56・主指標11/56。再抽出案は回答56/56・判定56/56、
  許可規程の評価集合/結果と既存監査56/56、主指標51/56、誤許可0/38。
  新規8問は判定16/16・主指標13/16。DS02/DS04の1回目、NR02の両回、NR01の2回目で
  撤回済みDS1を適用資料欄に混入。事前採用基準に不合格のため既定v5へ組み込まない。
- 全4資料群が再抽出で受理可能となり、12候補がreportedで原文の地位を保持。
  nativeの期待計算34件一致、正常6問の入力一致、全原文保持、正解非提示を確認。
  部分→SQLite結合→実モデルで検証。全116回答の説明をCodexが点検（独立盲検ではない）。
  第2回NC01の2回目に規程の列挙を「または」で曖昧にした表現を記録。
  拒否・転記監査だけでは判定・資料集合・説明の正しさを保証しないことを保持。
- 俯瞰判断: 2仮説から「停止回復・計算回復」と「適用資料集合の品質」は別課題と判明。
  同じ設問に合わせる3案目の調整は行わず、比較資産と限定した回復経路を残して記録へ移行。
  一般的な原文欠落・安全拒否・通信障害・すべての候補拒否・実資料には未検証。
  一部の計算だけ保持する構造は未実装。抽出各1回の測定なので抽出自体の再現率は未評価。
- 実行記録: `artifacts/extraction-fallback-comparison/2026-10-16T05-23-39.130Z-ff69320c` と
  `2026-10-16T05-29-35.281Z-9fac00b2`。180/182コードdigest不変で完了し、
  各48/72キャッシュを追加呼出し0で再生、report/eventsのdigest不変。
  全生応答・protocol・当時の実験コード・採点・コストは
  `fixtures/experiments/extraction-fallback-comparison/2026-10-16.json.gz`、判断は同名Markdown。
  代表的な3誤答を回帰試験へ保存。通常verifyはモデルを呼ばない。
- 最終検証: 部分試験7件・98 expect、全体verify 878件成功・失敗0・12,423 expect・54ファイル、
  build成功。差分点検で本体src・公開契約・既存v5・既存実験・隣接repoの変更なし。
  個別語句・設問・資料名でLLMの判断を代替する実装なし。専用処理は観測した拒否コードと
  候補0件に対する契約検査および1回の回復実行に限定した。採点期待値の弱化なし。

### 撤回済み規程の適用資料混入・指示だけの比較（2026年10月16日）

- ユーザー依頼: 撤回済み規程が適用資料欄へ混入する問題を、既存v5を維持して未見設問でも
  比較・計測し、改善が確認できたものを残してcommit/pushする。開始時mainは`029b3d4`、変更なし。
- 保存済み4種類の誤答を再現。DS1はWorld計算対象から除外済みで、説明とDS2の評価も正しく、
  governingSourcesだけにDS1が混入することを確認。SQLiteで元の4入力を再構築して一致。
- 既存の回答指示・schema・入力・共通実行を確認後、適用資料と履歴参照の違いを明記する
  指示の補足だけを独立Exampleで比較。旧規程の一括削除やコードによる意味判断は追加しない。
  旧文書に有効な観測章が残る場合は出典として保持し、許可規程評価には入れない。
- 既知8問＋新規4資料群16問、各2反復・2方式で96回答。抽出4回を共用し、最大100呼出し。
  指示・期待値・採用条件・コードを固定し、2並行・方式順反転・失敗再抽選なしで実行。
  部分→SQLite→全体検証を経て開始。試験の型注釈修正後に全体検証を通し、実行中の編集なし。
- 結果: 双方回答48/48・判定48/48・許可規程評価48/48・監査48/48、誤許可0/32。
  適用資料/主指標は基準v5 44/48→候補48/48、ペア改善4・悪化0。
  混入はDS02/NR01の両反復で4件→0件（撤回済み専用資料が存在する20セル中）。
  既知主指標12/16→16/16、未見主指標は双方32/32。旧文書の観測章を残す制御ケースは全成功。
- 判断: 既知の改善は確認できたが、事前条件「未見の改善数>悪化数」は0対0で未達。
  補足指示は改善が観測された独立候補として保存し、優先候補・既定への採用は保留。
  未見の満点を相対優位と呼ばず、同じ設問を再抽選して差を作らない。既存v5は不変。
- 全96説明を点検（Codex、独立盲検ではない）。明確な事実誤認は未検出だが、候補CP02は
  決定的でない匿名化の欠落にも言及。説明の焦点には改善余地あり。採点期待値は変更しない。
  新規抽出でKB4/KB8/KB6のvalidFromが省略された点、SP2の章別存続を原文で補う点も記録。
  今回の試験が章単位のWorld有効期間管理や施行前全般の正しさを証明するとは扱わない。
- 実行記録: `artifacts/operative-sources-comparison/2026-10-16T05-50-32.196Z-17c00fb8`。
  48ペアのrequestバイト一致、正解非提示、28期待計算一致、全原文保持、173コードdigest不変。
  全100キャッシュを追加呼出し0で再生し、report/events不変。生応答・採否は
  `fixtures/experiments/operative-sources-comparison/2026-10-16.json.gz` と同名Markdownへ保存。
  実測成功/失敗ペアと、旧資料を一括除外すると有効な観測方針が消える回帰試験を追加。
- 最終検証: 部分7件・171 expect、全体verify 885件成功・失敗0・12,594 expect・56ファイル、
  build成功。差分点検で本体・公開契約・既存v5・既存実験・隣接repoの変更なし。
  実装側に資料ID・個別文言の分岐やLLMの意味判断の代替処理なし。採点の緩和なし。

### 2026-10-16: 固定済み補足指示を追加の未見資料で再評価（不採用）

- 依頼: 既存v5を維持し、前回の補足指示を変更せず、新たな資料・設問で比較計測して採否を判断、結果をcommit/pushする。
  `examples/operative-sources-holdout`に新規6資料群19文書・24問を追加。既知8問と各2反復・2方式で128回答、抽出6回は共有。
  未承認案、連続改訂、別区画、無権限の撤回説、観測章だけ存続、2段階の施行切替を含む。
  未見12問は経緯説明を要求し、12問は通常質問。5組は同じ観測による質問変形で独立標本ではない。
- 実施前に期待値・採否・コードを固定。既存v5/補足指示/schema/採点/SQLite/計算機構を再利用し、意味判断はLLMのまま。
  134呼出し完了、通信失敗・抽出拒否・再抽選なし。全64ペアのrequest一致、179固定ファイル不変、全原文保持、正解非提示。
  19抽出を受理し、32問の期待許可規程計算36件が一致。キャッシュ134件を追加呼出し0で再生し、report/eventsのdigest不変。
- 結果: 全体主指標61/64→62/64、既知14/16→16/16、未見47/48→46/48。未見ペア改善1・悪化2。
  混入2/36→0/36、誤許可1/46→0/46。一方、未見判定48/48→47/48、有効規程保持13問の両反復26/26→24/26。
  AR03で旧規程の混入を改善したが、PC01で翌日施行の規程を適用しallow→deny、CV04で現行許可規程を資料欄から欠落。
  PC01は正しいvalidFromとCLAIM_NOT_VALIDを受け取っていたが誤選択し、計算転記監査は通過。CV04は既存監査で検出した。
  既知のNR02とCP02にも改善を観測したが、合計改善で未見の悪化を隠さない。
- 判断: 不採用。事前条件の未見純改善、新規2資料群以上で改善、判定非低下、有効規程保持が未達。
  元のv5と補足指示を変更せず、比較候補・全初回応答・改善/悪化例を研究用として保持。追加のモデル再実行や指示修正は行わない。
  全128説明をCodexが確認（非独立・非盲検）。日付「17日まで」を「17日間」とする説明誤りも両方式各1件記録。
  CV5の一部章だけの撤回はWorld主張全体の撤回となり、存続観測章は原文参照で補う。章単位管理の実装とは扱わない。
- 保存先: `fixtures/experiments/operative-sources-holdout/2026-10-16.json.gz`と同名Markdown。
  固定protocol・134生応答/usage・32入力・採点・採否・当時の実験コード・説明の指摘を保存（認証情報/SDK thread IDなし）。
  実行記録は`artifacts/operative-sources-holdout/2026-10-16T06-22-05.107Z-09db172f`。
- 検証: 実行前の部分/SQLite試験7件成功、実行後の追加試験5件・600 expect成功。新規抽出から全24問をSQLiteで再構築し、
  全128生応答の採点・request digest・採否を再現。AR03改善・PC01/CV04悪化を固定回帰試験化。
  最終verify 890件成功・失敗0・13,194 expect・58ファイル、build成功。試験コードの型不備を実測前/後に修正したが、固定された実測コード・指示・期待値に変更なし。
  差分点検: 本体src、公開契約、DB、既存v5、既存実験、隣接repoに変更なし。資料IDや個別語句による回答分岐、後処理、採点緩和なし。

### 2026-10-16: 施行時点と現行規程の資料記載を確認する回答順序（比較用候補を保持）

- 依頼: 前回の施行前規程適用PC01と現行規程記載漏れCV04に取り組み、既存v5を維持して
  今回の失敗と新たな未見資料・設問を比較、改善が確認できたものと計測結果をcommit/pushする。
  開始時mainは`2bd7678`、変更なし。既存指示・原文・計算・共通実行を確認し、製品実装は変更しない。
- PC01は正しい施行日時とCLAIM_NOT_VALIDを受け取りながら適用外のviolatedを禁止に使い、監査を通過。
  CV04は許可規程評価と資料欄の不整合を既存監査で検出。保存済み5失敗を回帰試験で再現した。
- 新候補はv5の1段落を置換。権限・範囲・施行時点で適用規程を選んでから計算を使い、
  評価欄→資料欄→説明→判定の順で、全評価規程と有効な観測方針を資料欄に含めるよう指示する。
  schema項目/制約は同じで順序だけ変更。指示と順序の寄与を分離した試験ではない。
- 既知8問＋未見4資料群14文書16問を2反復、v5/前回指示/新候補の3方式で144回答。
  4抽出共有、計148呼出し。正午の施行境界、多段改訂、観測章存続、全文撤回、範囲別旧規程存続を含む。
  部分→SQLite→verify/build後に指示・期待値・採否・コードを固定。6方式順を各8回、2並行。
  全呼出し完了、再試行/再抽選/回復なし。実行中の編集なし、固定186ファイル不変。
- 結果: 主指標v5 47/48、前回指示48/48、新候補48/48。既知は全方式16/16、未見31/32・32/32・32/32。
  判定/許可規程評価/監査は全方式48/48、誤許可0/34、撤回済み専用資料混入0/24。
  唯一の差はCC02反復1のv5が沿革資料CC4を資料欄に追加したこと。説明/判定/評価は正しいが資料集合が不正解。
  新候補対v5は改善1・悪化0、新候補対前回指示は改善0・悪化0。差は1資料群・1設問・1反復のみ。
- PC01/CV04は全方式4/4、候補の対象制御18問は36/36。主対象2失敗の再発は比較対象でも0であり、
  この2点に対する固有の効果や発生率低下は未確定。以前の失敗を消したり採点を緩めたりしていない。
  事前条件（全完了、制御全成功、各群で両比較対象以上、誤許可/混入0、今回ペア純改善）を満たし保持。
  未見でもv5に改善1・悪化0で追加条件を満たし、比較用の優先候補とする。既定v5は変更しない。
  前回指示との同点を優位とは呼ばず、以前の不採用判断も上書きしない。統計的優位・実資料受入ではない。
- 全144説明を作成者Codexが点検（非独立・非盲検）。CP02の否定分岐の指示対象、RV02の旧上限と
  過去観測値の区別に曖昧さを記録。主指標満点を説明の完全性と同一視しない。
  RV6の存続観測章は原文から補い、章単位の有効期間管理を実装したわけではない。
  CC5の旧観測方針詳細はpayloadに欠けるが原文保持。CC群は全文撤回後だけの検証。
- 新規14抽出受理、期待許可規程計算25件一致、48組prompt一致・比較対象間request一致、候補schemaは順序以外同値。
  全原文保持、正解非提示、候補48回答は評価欄が先、全144回答で判定が最後。
  148キャッシュを追加呼出し0で再生、report/events digest不変。新規16問をSQLiteから再構築し、
  全144応答のrequest digest/採点/集計/採否も通常試験で再現。
- 保存先: `fixtures/experiments/applicability-order-comparison/2026-10-16.json.gz`と同名Markdown。
  全148生応答/usage、24入力、固定protocol/コードsnapshot、採否、説明点検を保存（認証情報/SDK thread IDなし）。
  実行記録: `artifacts/applicability-order-comparison/2026-10-16T06-54-01.914Z-dd98407d`。
- 最終検証: 新規部分試験7件・821 expect、全体verify 897件成功・失敗0・14,015 expect・60ファイル、build成功。
  差分点検: 本体src/公開契約/DB/既存v5/既存実験/隣接repoの変更なし。資料IDはfixture/oracle/採点/試験だけ。
  LLMの意味判断を代替する分岐・資料フィルター・回答修正なし。採否基準や期待値の事後変更なし。
  今回は1仮説・1実測ラウンドで完了。再抽選や対策追加をせず、差の小ささと対象不再発の限界を保存する。

### 2026-10-16: 適用確認の指示と回答順序を2要因に分離（新規採用保留）

- 依頼: 指示変更と回答順序変更を分け、既存v5を維持して新たな未見資料・設問で比較計測、結果をcommit/pushする。
  開始時mainは`046b989`、変更なし。既存指示・入力・共通実行・採点を確認し、新規Exampleだけで4方式を比較。
  v5完全一致、指示だけ、順序だけ、両方。前回指示の「After writing assessments, include」を「Include」に揃えて因子を分離。
  順序因子は出力順の文章とschemaの順序の組合せ。両方変更は前回候補とバイト同一ではなく、前回指示を編集していない。
- 既知8問＋新規4資料群16文書16問、各2反復・4方式で192回答セルを事前固定。
  OR→ANDの施行切替、二段階改訂と観測章存続、全文撤回と観測方針移行、範囲別の存続と未承認案を含む。
  Williams順で位置と隣接順を均等化、2並行。部分→SQLite→全体検証後に固定コードで開始。
  試験コードの型指定1件を実測前に修正。実行中の編集、採点/採否の変更、再抽選、回復追加なし。
- 実測は4抽出＋160回答試行=164呼出し。cargo-liftの自文書撤回参照を既存検査が拒否し、32セル未回答。
  既知PC01反復1の指示だけ、CV04反復1の順序だけで403通信失敗。SDK再接続メッセージあり、アプリ再試行なし。
  158回答取得、4抽出生応答、2通信失敗を保存。全192セルの状態が確定し、終了はcompleted-with-failures。
- 主指標はv5/指示/順序/両方の順に全体34/48・37/48・38/48・39/48、既知14/16・15/16・15/16・16/16、
  未見20/32・22/32・23/32・23/32。未見は全方式24/32回答、取得した24件内の判定正解23・23・23・24。
  回答内の主指標誤答6・2・1・1。誤許可は回答済みで0、撤回済み専用資料混入3・0・0・0。
  未回答を計画分母から除外せず、回答品質と抽出/通信失敗を区別した。
- 未見の指示効果: 元順序で改善2/悪化0、評価先行順序で改善1/悪化1。
  順序効果: v5指示で改善4/悪化1、補足指示で改善2/悪化1。両方対v5は改善3/悪化0、双方誤答1、未回答8組。
  指示因子は1資料群、順序因子は2資料群で合計純改善。順序変更の方が広く改善したという限定した観測を記録。
  計画32組分母の平均差は指示+3.125、順序+6.25、相互作用−6.25ポイント。統計的因果・有意差とは扱わない。
- NP01では順序だけ反復0とv5反復1が施行1 ms前を施行後としてdeny。計算転記監査は通過。
  指示だけのNP01反復1、SD01反復0、両方のSD01反復1は、正しい説明と施行前規程を選ぶ構造化欄が不一致。
  指示だけSD01反復0はv5の正しいallowをholdに変えた。主指標では双方誤答となる判定悪化も明記。
  両方変更にも適用規程誤選択が残り、どちらかの単独変更や組合せで解消したとは言わない。
- 事前の全件完了条件が全候補で未達。単独方式は既知保持/計画分母の判定非低下も未達。
  両方変更は他条件を満たすが完了条件を緩めず、新規採用保留。前回候補と既存v5は維持。
  因子への記述的支持条件も双方未達（指示は完了と複数資料群、順序は完了）。改善と悪化を比較資産として全て保存。
- 全158説明を作成者Codexが点検（非独立・非盲検）。NP01のAND/OR結合範囲、CP02の否定項目名とboolean値、
  NP03の規程置換方向に説明上の問題を別記。主指標だけでは説明品質を保証しない。
  新規3資料群12文書の抽出を受理し12問構築、既知含む20期待計算一致。新規の観測章存続群は未評価。
  同一作成者の合成資料、抽出各1標本、設問/反復の相関、未回答群での効果不明という限界を保存。
- 固定193ファイル不変。40組prompt一致、160要求のschemaは順序以外同値、正解非提示、全取得回答が指定順。
  キャッシュのみ再生で追加呼出し0、162応答再利用、2通信失敗も再現。report/events digest不変。
  新規SQLite入力再構築、拒否参照の再現、全応答/失敗のdigest・採点・集計・採否の再現試験を追加。
- 保存: `fixtures/experiments/instruction-order-factorial/2026-10-16.json.gz`と同名Markdown。
  固定protocol、162生応答/usage、2失敗、20入力、192セル、採否、コードsnapshot、説明点検（認証情報/SDK thread IDなし）。
  実行記録: `artifacts/instruction-order-factorial/2026-10-16T07-23-38.730Z-dffc963e`。
- 最終検証: 部分7件・878 expect、verify 904件成功・失敗0・14,893 expect・62ファイル、build成功。
  通常試験は実測失敗を正しく再現することを含み、実モデル全成功と混同しない。
  差分点検: 本体src/公開契約/DB/既存v5/既存実験/隣接repoは不変。資料IDはfixture/oracle/採点/回帰試験だけ。
  LLMの意味判断を置換する条件分岐・資料フィルター・回答修正なし。1仮説・1実測ラウンドで終了。

### 2026-10-16: 既存監査で発動する1回の回答修正（既知改善、未見優位は未確認）

- 依頼: 説明では正しい規程を述べながら評価/適用資料欄で別規程を選ぶ問題へ、既存監査を活用して取り組む。
  v5を維持し、今回の失敗と新規未見資料を比較計測して結果をcommit/push。開始時mainは`d8f2d2c`、変更なし。
- 既存指示・入力・監査・実行を確認。auditGroundingは自己整合/出典/計算転記を検査するが、原文の適用判断や説明の意味は検査しない。
  前回のSD01/NP01不整合とCV04資料欠落、CP02転記誤りは検出でき、首尾一貫した施行前規程の誤適用は見逃すことを再現。
- 新規Exampleで初回v5回答を共有し、初回保持、監査結果なし見直し、監査結果あり見直しの3方式を比較。
  既存監査不合格時だけ1回、原文と元回答をLLMに渡し、監査結果の有無だけを変える。指示/schemaは同一。
  修正後も既存監査で不合格ならrejected、再修正なし。通信失敗は元回答へ戻して成功としない。
  合格時は文字列不変。acceptedは監査合格だけで、意味の正しさや公開許可ではない。
- 既知8件は保存済み回答を初回として使用し、新規v5生成とは分けて集計。検出対象6件は4種類の設問に由来し、SD01の変種3件を含む。
  監査を通る誤答1件と正解1件を不変更制御とする。各2反復。新規4群14文書16問も各2反復、144結果セル、最大124呼出し。
  部分→SQLite→verify/build後、指示・期待値・コード・採否を固定。2並行、修正方式順を反転、実測中の編集/再抽選なし。
- 4抽出＋24初回＋24修正=52モデル呼出し。canopy-motorのCM1が自文書を撤回する抽出結果となり、既存検査が拒否。
  4問×2反復×3方式=24セルを未回答として維持。他3群11文書は受理、通信失敗なし。終了はcompleted-with-failures。
  この既存抽出課題を理由に担当外の抽出/監査契約を修正したり回復処理を途中追加したりしない。
- 結果: 初回保持/監査結果なし/監査結果ありの主指標は全体26/48・38/48・38/48、既知2/16・14/16・14/16。
  監査不合格の6回答×2反復は両見直し方式で12/12修正成功。適用規程を正しく選び直し、CV2の資料追加、CP02のunknown/hold回復も確認。
  既知の監査見逃しKR07は両反復とも全方式で未修正。修正方式の監査合格40/40中2件は主指標誤答のまま。
  未見は全方式24/32正解、24/32回答。全取得初回が監査合格/主指標正解で修正発動0。未見修復能力は測れていない。
- ペア改善12・悪化0は既知だけ。監査結果あり対なしは改善0・悪化0。既知集合は失敗を選んだものでv5一般性能ではない。
  既知の誤許可2セルは解消、初回の正しい判定/主指標を壊す例、新たな誤許可/撤回資料混入はなし。
  各見直し方式28件（既知合格4＋未見24）の文字列不変を確認。
- 採否: 既知全修復、不変更、悪化なしは達成。全結果完了、未見純改善、新規2群以上改善が未達で、新規採用保留。
  監査結果を渡す固有の優位も未確認。既知改善を確認した限定実装を比較資産として残すが、v5/過去候補は変更しない。
  失敗が出るまでの未見再抽選、採否や期待値の緩和はしない。1仮説・1実測ラウンドで完了。
- 48新規出力と8保存済み回答を作成者Codexが点検（非独立・非盲検）。KR04反復0のaudit説明のAND/OR結合範囲に曖昧さを記録。
  新規3群から12問構築、既知含む20期待計算一致、全原文保持・正解非提示。FL5/FL3はreportedで原文の権威帰属を保持。
  FL5の観測章存続は原文で補い、章単位の有効期間管理を実装したわけではない。OS9の非拘束案を許可規程には使わなかった。
- 固定201ファイル不変、12修正ペアは監査フィードバック以外の入力/schema同一。48新規出力はv5の順序。
  キャッシュ52件を追加呼出し0で再生、report/events digest不変。全監査分岐/費用/採点/採否とSQLite再構築、抽出拒否を試験で再現。
  生応答/usage、20入力、144セル、protocol/実験コード、採否、説明点検を
  `fixtures/experiments/audit-repair-comparison/2026-10-16.json.gz`と同名Markdownに保存（認証情報/SDK thread IDなし）。
  実行記録: `artifacts/audit-repair-comparison/2026-10-16T07-53-45.863Z-48c74c71`。
- 最終検証: 部分7件・838 expect、verify 911件成功・失敗0・15,731 expect・64ファイル、build成功。
  通常試験の成功と実測の全件成功を区別する。差分点検で本体src/公開契約/DB/既存v5/監査/既存実験/隣接repoは不変。
  資料IDはfixture/oracle/試験だけで、修正実行側に意味判断の専用分岐・文言照合・資料書換えなし。
  追加コードは既存契約検査に基づく1回修正の実行・状態・費用記録に限定した。

## 2026-10-16 構造監査を通る誤選択の見直し比較

- 依頼: v5を維持し、整合した誤った規程選択が監査を通る問題を、前回見逃しと新規資料・設問で比較・計測し、結果をcommit/pushする。
- 範囲: `examples/source-review-comparison`、専用試験2本、この記録だけ。本体src、既存v5、抽出・構造監査・計算・採点、既存実験、DB契約・隣接repoは変更していない。後続製品段階の完了扱いにはしない。
- 既存監査の意味: 選択済み規程の計算と回答の整合を検証するが、規程選択や説明の真偽を保証しない。今回は合格時も1回見直し、通常指示と規程選択の補足指示を比較した。意味判断はLLM、コードは呼出し上限・入出力・保存・契約検証を担当。個別資料IDによる処理はfixture・採点・試験に限る。
- 固定計画: 前回KR07の監査見逃しと正解KR08を各2反復、新規4資料群14文書16問×2反復。初回v5を3方式で共有し、control/selectionの入力・schema・順序・呼出し回数を同じにした。selectionだけ補足指示。正解非提示、全原文・計算を保持、2並行・各120秒、再見直し・通信/抽出再試行なし。
- 俯瞰評価の介入: 初回run `2026-10-16T08-15-07.813Z-1c66fd7a` で新規packet名と既知KR08のpacket名が重複し、既知例を別入力で重複準備したことを検知。正常な長時間処理を時間だけで停止したのではなく、比較の前提が崩れたため停止・全体無効化を会話で通知。識別子を修正、事前重複拒否とunseen限定の準備を追加し、条件を固定し直して全呼出しをやり直した。資料原文・設問文・観測・期待値・指示・採否は変更せず、無効runキャッシュも不使用。後続結果は下記のとおりで、同じ仮説の無根拠な再試行ではない。中断処理の所有を確認できた一時ディレクトリ3件も回収。
- 無効runは39呼出し開始、37応答保存、2応答未取得。記録された入力551,740/出力11,752 tokensと原出力・protocol・変更前コードを別JSONに保存し、有効成績と合算していない。未取得分の使用量は不明。
- 有効run: `artifacts/source-review-comparison/2026-10-16T08-21-05.071Z-7a776885`。209ファイル固定・実測中変更なし。84モデル呼出しすべて応答、108セル中84回答・24未評価。cistern-valveのRV8観測方針が候補0件となり、1資料1候補の既存検証で拒否、4問×2反復×3方式を分母に残した。通信失敗・再試行0。`completed-with-failures`、終了code1はこの抽出拒否を表す。
- 既知主指標: baseline 2/4、control 4/4、selection 4/4。見逃しKR07は双方2/2修正、正解KR08も双方2/2保持。固定seedの成績で新規v5の品質評価ではない。
- 未見主指標: baseline 18/32、control 23/32、selection 22/32（回答あり各24、抽出未評価各8）。controlは改善5/悪化0、selectionは改善4/悪化0。selection対controlは改善0/悪化1。判定正解は全方式23/32。初回主指標正解18件の改悪0、誤許可0、撤回混入はbaseline1→両見直し0。
- 残存見逃し: TC01/0は施行1ミリ秒前を施行時刻と誤読し、全方式で誤ったTC2を選び不許可。全て構造監査を通る。計算には`CLAIM_NOT_VALID`があり、現行監査はこの理由を不合格条件に使わない。時刻誤読の追認が残り、合格時見直しだけでは解消しない。
- selectionの追加失敗: KC01/0で説明上は対象外とするKC8を評価・資料欄に含め、判定と評価が不整合となり既存監査が拒否。controlは正しく修正。TC04/1では構造化回答は正解だが、施行1日後を「施行時刻と一致」と説明し、正しい初回説明を悪化させた。
- 原文/説明確認: 新規80出力と既知2回答を担当者が直接確認。独立盲検ではない。章単位の存続は原文からLLMが判断しており、章単位ライフサイクルの実装・受入を示さない。全14準備入力の期待した許可計算がネイティブ評価と一致。新規の並存規程ケースは抽出拒否で未受入。
- 費用（有効runの重複なしSDK申告）: 抽出4回55,615入力/4,172出力、初回24回390,840/4,848、control見直し28回470,219/5,112、selection見直し28回430,258/5,340。未見の平均応答時間は初回13.30秒、見直し込みcontrol26.44秒/selection26.60秒。各方式の集計を合算すると共有初回を二重計上する。保存seedの元の生成費用は含めない。
- 採否: selectionの事前条件では既知修復・初回正解保持・未見純改善・複数群純改善は成立、全件完了が不成立。controlへの優位も不成立。`retained=false/preferred=false`。通常見直しを今回の比較内の最良方式として残すが、見逃し解消・全件受入を主張せず既定はv5を維持。重点指示は推奨せず、比較資料として不採用理由とともに保存。
- 次の仮説は、有効期間外という既存計算理由を監査へ接続できるか、または前回答なしで規程選択を独立に確認する方法。今回未実装・未実測で、効果は未確認。
- 検証: 修正後の部分＋既存SQLite再現7件/837 assertions成功。実測後は専用部分・測定再現8件/637 assertions成功。全84回答の入力・分岐・監査・採点・費用・集計・採否と24未評価セルを再現。28組の見直し入力/schema同一、80新規回答のv5順序、無効runから意味条件を変更していないことを検証。
- 追加呼出し0・84応答再利用の再生でreport/eventsのdigest不変。最終`bun run verify`: **919 pass / 0 fail / 16,368 assertions / 66 files**、`bun run build`成功。通常検証でモデルは呼ばない。抽出未評価を全体通し成功と混同しない。
- 完了: 実装・部分→結合→実モデル比較→再現→全体検証、全回答確認、費用・採否・限界の記録まで完了。差分は担当範囲のみ。規程の意味選択をコードへ移す処理なし。
- 詳細: [比較結果](../../fixtures/experiments/source-review-comparison/2026-10-16.md)、[有効run](../../fixtures/experiments/source-review-comparison/2026-10-16.json.gz)、[無効run](../../fixtures/experiments/source-review-comparison/2026-10-16-invalidated.json.gz)。

## 2026-10-16 有効期間外の計算理由を接続する監査比較

- 依頼: 時刻を誤読した回答が監査を通る問題に対し、既存の有効期間外の計算結果を活用。v5を維持し、今回の失敗と新規未見資料・設問を比較・計測して結果をcommit/pushする。開始時mainは`da52de9`、変更なし。
- 範囲: `examples/validity-audit-comparison`、専用試験2本、この記録。本体src、公開契約、既存v5・監査・抽出・計算・採点、過去実験、DB・隣接repoは不変。製品段階の追加実装・受入ではない。
- 既存指示・入力・実行を確認し、回答が許可評価に選んだsourceId/assertionIdを既存World unit/evaluationへ接続する追加監査をExampleに実装。計算理由に`CLAIM_NOT_VALID`があれば不合格。日付再解釈、説明の文言照合、規程選択、資料フィルター、ID専用分岐は追加せず、コードは契約検証を担う。観測章引用を守るため適用資料欄全体は一律拒否しない。
- 設計: 共有v5初回保持、control、validityの3方式。両見直しは新旧監査不合格という同じ発動条件で1回。開発者指示・原文・計算・元回答・schema・順序を揃え、validityだけ追加監査の指摘を渡す。controlも新監査の発動条件を使うため、旧方式そのままではない。最終acceptedはcontrolで旧監査、validityで両監査。拒否を正答とせず従来の主指標を維持。
- 固定集合: 既知6保存回答×2反復。うちTC01/0の3変種とKR07の4誤答×2反復が有効期間外、他2保存回答は観測章の正しい引用と説明だけの時刻誤記を持つ制御。8誤答結果は元の2設問に由来し、独立した8設問ではない。新規3資料群7文書12問×2反復を追加。全108セル、最大99呼出し、2並行、各120秒、見直し順を反転、再試行・再見直し・差替えなし。
- 部分→結合→verify/build後に219ファイル・資料・指示・期待値・採否を固定。実測中の編集・再抽選なし。実行`artifacts/validity-audit-comparison/2026-10-16T09-00-27.904Z-a6f55fab`、3抽出＋24初回＋18見直し＝45呼出し全応答取得、108セル採点、抽出/通信失敗0。gpt-6-luna/medium、SDK 0.163.0、Bun 1.4.3。
- 既知主指標はbaseline 4/12、control 8/12、validity 10/12。新監査は旧監査が通した有効期間外8結果を全検出。validityは6/8修復、残るVT02/0・VT03/1は説明/判定だけ直りTC2の評価・資料欄が残って両監査が拒否。最後の拒否を新監査単独の効果とはしない。controlは4/8修復、残る3誤答を旧監査が受理、1誤答を拒否。validity対controlは改善3・悪化1で一様な優位ではない。
- 未見主指標はbaseline 22/24、control/validity 23/24。新規の有効期間外誤選択0、新規検出0、正しい初回への追加誤警告/正解拒否0。BW02/0の旧構造監査不合格を両方式が修復しただけで、指摘固有の効果は未確認。DT04/0の別区画DT2の余計な適用資料引用は両監査を通り、全方式で残存。全体主指標26/36・31/36・33/36、accepted中の主指標誤答9・4・1。
- 27初回/見直し方式を文字列不変で保持、初回主指標正解の改悪0、誤許可0、新たな撤回混入0。初回の撤回混入1件は両方式で解消。既知の説明だけの時刻誤りVT06は全方式で保持され、監査合格・主指標正解は説明全体の真偽を保証しない。
- 新規42回答と保存6回答を実装担当者が点検（非独立・非盲検）。FH03/1・FH04/0のミリ秒省略による曖昧な説明も記録。全原文保持、新規12SQLite入力再構築、既知含む18期待計算一致。FH7の期限終了は撤回とは別に計算へ反映。FH7/FH3はreported抽出だが原文の正式帰属を保持し、手修正なし。抽出・計算が誤る場合まで保証せず、合成資料での評価に限定。
- 採否: `guardRetained=false/repairRetained=false/preferred=false`。未見新規検出、既知全修復、新規2群の純改善、未見control優位が未達。閾値の緩和・成功までの再抽選はせず、既知改善を確認した限定実装と結果を比較資産として残す。通常経路への採用は保留、v5維持。1仮説・1実測ラウンドで完了。
- 費用は重複なし45呼出しで入力692,887/出力11,259 tokens。抽出39,477/2,235、初回379,210/5,519、control132,126/1,833、validity142,074/1,672。未見平均は初回10.58秒、見直し込みcontrol11.07秒/validity11.17秒。共有初回の二重計上と保存seedの元費用を含めない。
- 追加呼出し0・45応答再利用でreport/events digest不変。219固定ファイル不変、9要求ペアは追加監査フィードバックだけ異なり、42新規回答は元のv5順序。全108セルの要求digest・分岐・監査・費用・採点・集計・採否を再現し、SQLiteも再構築する専用試験を追加。
- 最終検証: 専用8件・836 assertions成功。`bun run verify` **927 pass / 0 fail / 17,204 assertions / 68 files**、`bun run build`成功。通常試験はモデルを呼ばない。差分点検で担当外変更・LLMの意味判断を置換する処理なし。
- 完了: 比較・計測・全回答点検・再現・全体検証・費用/採否/残課題の記録。詳細は[結果](../../fixtures/experiments/validity-audit-comparison/2026-10-16.md)、[再現JSON](../../fixtures/experiments/validity-audit-comparison/2026-10-16.json.gz)。認証情報・SDK thread IDは保存しない。

## 2026-10-16 対象外資料の混入を確認する独立した役割監査（不採用）

- 依頼: DT04で対象外規程が適用資料欄へ混入しても監査を通る問題を、v5を維持し、今回の失敗と新規未見資料・設問で比較計測してcommit/pushする。開始時mainは`6232423`、変更なし。
- 範囲: `examples/source-role-audit-comparison`、専用試験2本、この記録。本体src・公開契約・既存v5・抽出・計算・監査・採点・過去実験・隣接repoは不変。製品段階の追加実装・受入には数えない。
- 診断: DT04/0はDT8のunknown評価とhold判定が正しいが、east限定DT2を「DT8を変更しないと述べる資料」として適用資料欄に追加。旧構造監査と前回有効期間監査がともに通る。評価のない資料を一律に削除すると、必要な観測章も失う。
- 仮説: 既存の原文・設問・時刻・観測・World計算を再利用し、適用資料ID一覧だけを付けた別のLLM呼出しで役割を確認。回答の説明・判定・評価は隠し、各資料のapplicable/inapplicable/uncertain、役割、短い理由、原文引用を返させる。コードは全ID網羅・重複・引用の逐語一致だけを検査し、対象範囲や説明の意味を分類しない。引用一致は意味の正しさを保証しない。
- 固定比較: 共有v5初回保持baseline、指摘なしcontrol、指摘付きrole。両方式が初回役割監査を共有し、旧監査または役割監査不合格で1回見直し。同じ開発者指示・原文・元回答・schema・順序でroleだけsourceRoleAuditを追加。修正後は双方を再監査し、controlのacceptedは旧監査、roleは両監査。controlは旧方式そのままではなく、発動条件・呼出し機会を揃えた比較。拒否を正答にせず、主指標を維持。
- 既知3保存回答×2反復: SR01＝DT04/0混入、SR02＝DT04/1正解、SR03＝VT05の正しい観測章引用。新規3群8文書12問×2反復: 区画・方式・炉室、観測章の存続と対象外、許可/不許可/保留を含む。90セル、最大177呼出し、2並行・各120秒、方式順反転、全原文保持・正解非提示、再試行/再見直し/初回差替えなし。既知の反復は独立設問ではなく保存回答の再評価。
- 部分・SQLite結合・verify/build後に228ファイル・資料・設問・期待値・指示・採否を固定し、実測中の編集・再抽選なし。実行`artifacts/source-role-audit-comparison/2026-10-16T09-19-53.302Z-5c386005`。3抽出＋24初回＋30共有初回監査＋2見直し＋2最終監査＝61呼出し全取得、90/90セル採点。抽出・通信・引用契約の失敗0。gpt-6-luna/medium、SDK 0.163.0、Bun 1.4.3。
- 結果: 既知主指標baseline 4/6→両見直し5/6、未見は全方式23/24、全体27/30→28/30。判定・許可評価は全方式30/30正解。acceptedは全方式30/30で、その中の主指標誤答は3→2。role対baseline改善1/悪化0、対control改善0/悪化0。誤許可、新規撤回混入、初回正解の改悪は0。29初回/見直し方式を文字列不変で保持。
- DT04はSR01/0で監査もDT2を「DT8の維持を定める規程」として適用可にし、全方式で混入が残った。SR01/1ではeast限定として検出し、両見直しでDT2を除去して正解。同じ保存回答で監査が揺れ、指摘なしでも修復したため、指摘固有の優位は未確認。
- 未見CF03/0は説明でCF4第2章の不適用を正しく述べながらCF4を資料欄へ追加。役割監査は、CF2に不適用が明記されているのに「観測方法の適用関係に関わる」としてapplicableとした。全方式で見逃しが残り、別呼出しでの確認だけでは意味判断の追認を防げない。
- 共有初回監査の資料単位では、必要な36参照すべてを保持、対象外3参照中1参照を検出し2参照を見逃した。誤警告/正解拒否/uncertainは0。反復と共有資料を含むため、独立39例や一般的検出率として扱わない。SR03のRV6観測章、CF01/CF02のCF4観測章は両反復で正しく保持。
- 全61出力と保存3回答を実装担当者が点検（非独立・非盲検）。全8文書はasserted抽出、新規12SQLite入力再構築、既知含む15期待計算一致。章単位存続は原文からLLMが判断し、章別ライフサイクルの実装ではない。CF01/1の説明に実測機器と規程上の方法を区別しにくい表現を記録。観測来歴・説明全体の真偽・資料欠落を今回の役割監査は保証しない。
- 費用（重複なしSDK申告）: 61回で入力940,606/出力15,585 tokens。抽出39,718/2,906、初回367,284/5,919、共有初回監査475,662/6,149、control修正14,203/138、role修正14,488/153、control最終監査16,154/165、role最終監査13,097/155。未見平均は初回11.05秒→両方式22.02秒。精度改善なしでほぼ倍の時間を要し、常用の根拠なし。保存初回の元費用は除外、方式間で共有初回/監査を二重計上しない。
- 採否: `guardRetained=false/repairRetained=false/preferred=false`。全件取得・必要資料保持・正解保持は達成、DT04全反復検出/修復、未見検出/純改善/複数群改善、control優位が未達。候補は不採用。限定的改善と失敗を再現する比較資産のみ保存し、v5は維持。1仮説・1実測ラウンドで終了し、閾値緩和や成功までの再抽選はしない。
- 次の未検証仮説: 候補の資料ID一覧も見せず、対象に直接適用する条項・役割を原文から先に選び、その集合と回答を照合する。今回の結果だけで一覧による誘導を原因と断定せず、効果は未測定とする。
- 再現: 新規呼出し0、61キャッシュ・91読出し（共有初回監査の重複参照を含む）でreport/events digest不変。228固定ファイル不変、1修正ペアはsourceRoleAudit以外同一、26新規回答はv5順序。全90セルの要求digest・分岐・費用・監査・採点・集計・採否、SQLite再構築と見逃しを回帰試験で再現。認証情報/SDK thread IDは保存しない。
- 最終検証: 専用8件・790 assertions成功。測定再現試験の比較型注記だけ修正後、`bun run verify` **935 pass / 0 fail / 17,994 assertions / 70 files**、`bun run build`成功。実測コード・入力・期待値は不変。差分点検で担当外変更、資料IDによる意味選択、文言による規程分類なし。完了は比較・採否判断・記録の完了であり、対象外混入の解消ではない。
- 詳細: [結果](../../fixtures/experiments/source-role-audit-comparison/2026-10-16.md)、[再現JSON](../../fixtures/experiments/source-role-audit-comparison/2026-10-16.json.gz)。

## 2026-10-16 EumenesのWorld調査と収集Seedの接続

- 利用者がEumenesの連携改修とSeed追加を許可。既存記憶の消去を避ける要望を受け、追加専用・冪等・内容競合拒否とした。本体src・配布パッケージ・既存v5・過去の評価資産は不変。
- World側は固定Seedを検査してEumenes資料API用JSONLへ出力する `eval/seed/export-eumenes.ts` のみ追加。出力はGit対象外の `artifacts/eumenes-seed-grok-984-v1.jsonl`。manifestは既存 `grok-984-v1`、digest `sha256:7a7f8ef7da7c3460469e8e34d2bff8a0376c44a78f070452225197b44dce5eb3`。
- Eumenes側は既存world.query調査経路を再利用。条件計算・有効期間・UTC判定時刻・観測未提供を保持する。収集資料の台帳、ホストScopeと単一Writerを使う追加API、原文読取り、報告時の版と取り下げ再確認、新旧bundleを併存する新版を追加した。資料選択・適用の意味判断はLLMに残し、実験で不採用の監査を導入しない。
- 隔離環境: 984 inserted / 984 unchanged / 984本文・digest・manifestDigest一致。長文も最後まで復元。実データを本人の会話として投入していない。保存と参照の検証であり、全件の意味抽出・採用・正本確認ではない。
- Eumenesの明示指定回帰: 610 pass / 0 fail / 5,563 assertions / 80 files。別途bundle旧版維持、Scope分離、引用後の取り下げ拒否、有効期間外の計算引継ぎも確認。
- 実モデル調査担当: 初回は試験の診断SQLの誤りで判定保存失敗。次の実行は空白で連結したキーワードを部分一致検索へ渡してnot_found。連続文字列1つを渡すという汎用のツール説明を補ったところ、同じ1問で検索→原文読取り→引用報告が成立（3呼出し、実行約24秒）。実装の対策済みという事実は作らずSHOULDを保持。部分読取り、summaryのd1表記が残る。会話の親は固定fixtureであり、実モデルの最終回答や一般的な精度向上は未受入。
- 本体への追加投入は未実施: 既存DBの `migration_checksum_mismatch:inference/0009-agent-sessions` により起動前に停止。同じエラーが前日のログにもあり、今回のWorld変更外。記憶削除・初期化・checksum書換えでは回避していない。
- 全体検証は成功扱いにしない: Eumenesには変更外の型エラー1件、Web試験の依存不足があり、別作業の入力変更でverify結果もinvalidated。所有ファイルを明示した上記の回帰結果と区別した。後からEumenes AGENTSに明示許可なしのサーバー起動禁止が追加されたため、再起動等は行わない。
- 詳細と残作業はEumenesの `spec/world-reference-integration-2026-10-16.md`。今回の完了範囲は連携実装・隔離検証・Seed追加手順。製品DBへの投入と既存起動障害の修復は未完了。
- World側の今回の最終検証: `bun run verify` **935 pass / 0 fail / 17,994 assertions / 70 files**。exportスクリプトのlint/format成功。Seed本文はGit対象外へ移動済み。v5とsrcの差分なし。
- 最終差分点検時、並行作業のMemory型不一致とagent-runtimeのSQL境界違反も検出した。修正は行わずEumenesの記録に追記。試験fixtureの命名整理後は結合26件・118 assertions成功。610件の成功は実行時の状態に対する証拠であり、進行中の他変更を含む全体受入ではない。今回commit/push未実施。


## 2026-10-16 Eumenes本体Seedの投入完了（追記）

- 利用者から初期化も含めたSeed実施の許可を受け、本体DBへ `grok-984-v1` の11コレクション984件を追加。結果として初期化・記憶消去は不要だった。
- 適用済みinference移行への後付けSQLを新しい移行へ分離し、旧SQLを本体DBの記録済みchecksumと一致させた。移行履歴の直接更新なし。既存行保持・新移行・再オープンと資料結合の5ファイルで15 pass / 0 fail / 91 assertions。
- 通常起動は別の `tool:web.lookup@1` の版競合で停止。競合定義を今回変更せず、既存排他writer・認証・資料APIの一時backendを使い、既存CLIからHTTPで投入。終了時にbackend/storeを閉じた。
- 本体実測: 984 inserted、再投入984 unchanged、2,101ページで984件の全文・digest・manifestDigest・版・題名・collection一致。未認証401、検索成功。約2.68秒。
- 投入前後で他220テーブルの全行ハッシュ・件数一致。起動前に確認した記憶・会話関連・設定35テーブルの件数も一致。データや秘密のコピーなし。
- Eumenesの `verification-reports/world-reference-live/product-seed.json` と `spec/world-reference-integration-2026-10-16.md` に結果・限界を記録。原文保存の完了であり、全件抽出・自動採用・本体会話利用の受入ではない。通常起動のWeb版競合は残る。v5・World本体srcは不変。今回はcommit/push未実施。

## 2026-10-26 Bun 1.4.4への更新

- セキュリティ修正を含むBun 1.4.4に合わせ、`package.json`の`packageManager`を1.4.2から1.4.4へ更新し、READMEの使用版を同期。実行環境は着手時点ですでに1.4.4（38afee6c8）。
- `bun install --frozen-lockfile`成功、lockfile差分なし。SQLite結合試験は21 pass / 0 fail、`bun run verify`は935 pass / 0 fail / 17,994 assertions / 70 files。整形・lint・型・境界検査と`bun run build`も成功。
- 変更は実行版の指定・案内・本記録のみ。製品コードの意味判断・専用分岐の追加なし。既存の作業中差分と過去の測定環境の記録は維持。


## 591b066レビュー対応（2026年10月28日）

目的・範囲・全指摘の対応表と導入条件は[対応記録](../review-591b066-remediation.md)を参照。

- 矛盾は状態遷移だけでは失効せず、内容置換の自己supersedesで区切る。採用順反転、純粋投影・増分投影・再構築の一致と、自己リンク省略の拒否を確認。
- 同順位の適用期間不明な観測が結論を変え得る場合はunknown。結論不変・下位の不確実性では確定結果を維持。
- Memory 0.3.6の既存配布157ファイルをGit対象にし、manifest pin・全ファイルのハッシュをverify前に検査。再生成はclean checkoutと完全commit IDを必須にし、異なる版は明示更新なしに拒否。
- payload読取りは既存契約parserで検証。不正JSON・欠損・型違いをWorldIntegrityErrorとして拒否。root公開APIとmigrationは変更なし。
- モデル出力は上限確認後に解析し、壊れた出力を通常の拒否へ。既存の回復処理はmalformedを回復対象にしない。
- staleなAGENTS・計画・README・verify表示を修正。Agency/Memory対応表とWorldSlice利用境界をhost契約へ追加。
- grokbotの同梱理由を明記しtar重複を削除。実験の固定証拠は内容を保ったままgzip化（8,764,271→872,899 bytes）し、SHA・再採点試験を維持。新規resultsはGit対象外。
- 部分検証: 条件/投影32件、投影・SQLite結合225件、repository・scenario368件。破損データ・schema・配布pin・圧縮証拠の試験を追加。変更前の不具合と、手作りsupersedeで境界を省けるケースが失敗することを確認してから修正。
- 最終全体: `bun run verify`950件成功・失敗0・18,144 expect、74ファイル。整形・lint・型・境界・consumer成功。build成功、SQLite基盤21件成功。
- 新規環境: tracked＋新規非ignoreファイルだけの一時コピー（依存物・成果物・隣接checkoutなし）でinstall/verify 950件/buildすべて成功。最終コードでも再確認。一時ディレクトリは回収。
- 実モデル: 既存Eumenes SQLite設定を読取り、既存クライアント経由で`ornith1.5Strix` / `lfm2.5-24b-a2b`へ接続。`seed-local-v1`、reasoning low、非stream、実資料1件と通常/攻撃2件すべて候補1件・再投入no_op・active0。対攻撃では同じ7日保持の内容を維持。任意実行の`eval/extraction/local-smoke.ts`と実出力の回帰試験を追加。
- 検証区分: 純粋規則・実SQLite・配布consumer・実Local小規模接続は成功。100件の正式holdout、日本語payload品質、host queueの実モデル受入、実運用は未受入。実資料payloadが英語のままという制約も保持。
- 差分点検: 個別語句での意味分類・固定回答・仮の成功は追加なし。有限AST・提示ID/引用パスは出力契約の強制だけ。モデル出力の意味をホストが書き換えない。既存のseed export作業を保持し、隣接repo・製品DBは変更なし。
- 導入条件: 旧投影をhostの単一Writer内で各Scopeの`rebuild`により再構築する。今回、製品DBには未実施。
- 俯瞰評価の記録: 3ラウンド時点でLocalの拒否理由を評価し、reasoning要件・転送方式・引用契約へ原因を絞った。意味判断の専用処理へ移さず、条件を変えた根拠を会話で通知。再実行用CLIでコードdigest不変と3件成功を確認して探索を終了。


## 実モデル受入から先の統合計画（2026年10月28日、計画のみ）

3案を[統合計画](next-stage.md)へ整理した。P4-05.a〜c（entity供給照合・2モデルadapter・同じ200件の比較）を最優先とし、P5-04.aの独立品質比較を新しい製品配線より先に置く。
手書きWorldと実抽出由来World、Local単独とLuna対照/混合、事後回収上限と実行時に検知可能な回収率を分ける。抽出の失敗生成を再投入せず、holdoutと既存閾値を維持する。
W1/W2/W5は観測した失効・提示・忘却の不足に対する必要最小限の票とし、状況→予測→実測→修正候補→次の判断の小さな一巡をP5-03.i/P5-04.bで受け入れる。
その後にAgency接続・条件付き規則・P6の実運用を置く。親P5-04の完了条件は.a/.b両方であり、今回の順序変更で既存票を完了にしない。

- 変更範囲: spec/plan/next-stage.md、implementation-plan.md、integration-tasks.md、acceptance.md、README、本記録。
- 現物との照合: entity一覧とharness候補供給、既存Slice順位、950件の前回成功、decode/JSON修正、10万件性能測定を確認し、未実装という前提を訂正。
- 実装・モデル実行・製品反映: 未実施。作業票はすべて未着手。外部host/Agencyの作業は依存条件として記録しただけ。
- 文書検証: 参照ファイル・リンク、票ID・先行関係、受入ゲート、非公開holdout・Cloud fallback境界、差分を点検する。コード試験は文書のみの変更のため再実行しない。


## 先行研究の比較実験計画（2026年10月28日、計画のみ）

提供された収集資料のうち、既存の抽出・判断・予測照合へ直接つながる候補を一次資料と現行契約に照合し、[研究比較計画](research-experiments.md)のE01〜E10へ整理した。収集全件を再現・検証したものではない。

- 優先: 200件の初回基準後にJacRED（E01）と取得済み出力の意味支持点検（E03）、P5-04.aで同予算の履歴/Sliceとoracle（E04）。
- 条件付き: 原子/要素別抽出、PPR、複数支持、双時間監査は対応する不足を観測してから比較する。実物一巡後はWorldEvolver/PSALMの更新を別々に測る。
- 契約への反映: 予測と実行行動のID/版/parametersを対応させ、行動変更後は実行前に再予測する条件をP4-04.a、N10/N12へ追加。ホスト実装は未着手。
- 維持した境界: forget本文を履歴から復活させない。無効生成を再投入しない。意味判断はLLM、コードは契約と数値計算。確率を持たない現行PredictionからBrierを算出しない。
- 成果: 各実験の仮説、対照、対象・予算、測定、採否、保留条件、未実施の結果表。正式A46/A50の閾値やp5Acceptedを変更しない。
- 実装・モデル実行・データ取得・結果の改善: 未実施。研究の効果は未測定。文書のローカルリンク71件（欠落0）、E01〜E10/N01〜N16の重複なし、票の対応とgit diff --checkを確認。コード試験は文書のみの変更のため省略。既存seed作業は保持。


## P4-05.a〜c harness側の実装（2026年10月28日、実モデル未実施）

統合計画[next-stage.md](next-stage.md)の最初の着手点P4-05.a〜cについて、この環境で実施できるharness側だけを実装した。実モデル接続・200件比較・正式受入は未実施であり、本記録はその代替ではない。

- P4-05.a（N01）: `eval/extraction/supply.ts`を追加。各ケースの供給manifest（entity IDとrevision、entitySet名、供給数、上限なし＝null・打切りなし、Scope、dataset版、可視要求内容のsha256 digest）と供給分類（supplied / gold_not_supplied / intended_hold / ambiguous_supply）をrunnerのSampleRecordへ記録し、RunReportへ供給クラス別件数と「モデルに帰属する失敗数」（suppliedケースでstatus非okまたは評価不一致のみ）を追加した。既存フィールド・scoring・ext-threshold-v2の閾値意味は不変（追加のみ）。goldのsubject解決は、idは供給ID集合への包含、aliasはdisplayName/aliasesとの一致数（1＝supplied、0＝gold_not_supplied、2以上＝ambiguous_supply）で判定する。unresolved_subject / ambiguous_subjectの保留はintended_holdとし、それ以外の保留はreferenceのsubjectで分類する判断を注記した。
- P4-05.b（N02のharness側）: `eval/extraction/providers.ts`にOpenAI互換chat-completions providerを追加。凍結した指示文（`EXTRACTION_INSTRUCTION`、版`eval-extract-instruction-1`）と可視要求JSONを送り、応答contentをそのままモデル出力として返す。非2xx・接続失敗・応答envelope不正はProviderUnavailableError、abortはランナーのtimeout機構へそのまま伝播する。ProviderInfo.kindへ`remote`（Luna対照用）を追加し、受入eligibleはLocalのみのまま不変であることを回帰試験で固定した。main.tsへ`--remote`を追加したが、endpointの既定値は持たず`--endpoint`と`--model-id`がなければ利用エラーで fail-closed とする。実endpointへの接続・配線は行っていない。
- P4-05.c（N04の集計側）: `eval/extraction/compare.ts`に純粋関数`compareRuns`を追加。evaluationVersion / datasetVersion / splitが異なる報告同士は例外で拒否する。ケース対応の4分類（両方一致・Aのみ失敗・Bのみ失敗・両方失敗）、モデル別の失敗内訳（SampleStatus別、評価reason code別）、エスカレーション回収上限（goldを使う事後的な上限であることを明記）、実行時に検知可能なルートでの回収率と誤エスカレーション件数を分けて出す。routableの定義（status非ok、または評価にmismatch/violation codeが残るケース）はCaseEvaluationに残るフィールドからの近似であることをコード内に注記した。
- 検証: 新規試験26件（supply 10件・providers 9件・compare 7件、fetchは全てfake、ネットワークなし）。`bun run verify` **976 pass / 0 fail / 18,823 assertions / 77 files**（従来950件から新規26件分増加）、`bun run build`成功。整形・lint・型・境界検査もverify内で成功。
- 未実施（この環境の制約）: Local Providerとhost（MCP）がこの環境に無いため、LFM2.5 / Lunaの実モデル実行、dev100/holdout100の200件比較、N03/N04の実測値、A46の正式Local受入判定は一切行っていない。**正式受入は未実施**のままである。次に必要なのは、host側のLocal接続が使える環境でadapterの接続確認（各数件）を行い、指示/schema/予算を凍結してから本評価へ進むこと。
- 変更範囲: eval/extraction/{supply,providers,compare}.ts（新規）、eval/extraction/{runner,scoring,main}.ts（追加のみ）、test/eval/{supply,providers,compare}.test.ts（新規）。凍結dataset（dataset.v2.jsonとdigest）、閾値、src本体は不変。作業ブランチ `work/next-stage-p405` へローカルcommitのみ、push未実施。


## エージェントをremote対照モデルにした抽出実測（2026年10月29日、受入ではない）

Local Provider／MCPホストが無い環境で、P4-05のharnessへ実モデル相当の出力を初めて通した対照測定。生成役はMuse（サブエージェント群）が担い、各生成役にはモデル可視情報（発話・entity候補・predicate）だけを渡し、gold・caseId・splitは渡していない。初回生成のみ、再試行なし。指示は`agent-muse-v1`としてdev/holdoutで凍結し、holdout結果を見た調整はしていない。引用は生成役が選んだ文に対しバイト範囲を正規化（計画P4-05.bで許容された正規変換）し、修正件数は両splitとも0件だった。provider種別は`remote`で、runnerの`acceptance.eligible`は偽。**Local正式受入（A46/N03）ではない。**

- dev100: 全件status ok（不正出力0）。採用precision 43/72（0.597）、採用recall 43/66、保留recall 32/34、区分正解 28/30。閾値（各19/20）は未達。
- holdout100（集計のみ、個別ID・本文は出さない）: 全件status ok。採用precision 42/69（0.609）、採用recall 35/66、保留recall 32/34、区分正解 28/30。違反はScope漏洩・引用捏造・忘却後復活・仮説の実測化すべて0件。閾値未達。
- 供給分析（P4-05.a）: 両splitとも供給不足（gold_not_supplied）0件、意図した保留10件。失敗はすべてモデル／契約解釈へ帰属（dev 25件、holdout 33件に何らかの不一致）。
- 失敗の集中: 引用範囲の粒度（QUOTE、dev16/holdout17）、値の表現（PAYLOAD、9/10）、predicate選択（5/6）。devでは訂正グループに誤採用16件と忘却後復活2件が集中した（holdoutでは違反0）。
- 解釈: 形式遵守は強いモデルで完全に取れる一方、このdatasetの精度閾値は「契約の規約（訂正の意味論・引用粒度・値の正規形）への追従」を強く測っており、生の読解力だけでは届かない。LFM2.5の初回測定では、形式失敗と規約解釈の失敗を分けて読む必要がある。
- 証拠の所在: 実行成果物はrepo外 `~/workspace/dev/agent-model-run/run1/`（batch・生成出力・replay・report）。dataset digestはext-ja-v2の凍結値のまま。repo側の変更は本記録のみ。


## 指示v2（規約明示）の対照測定（2026年10月29日、受入ではない）

v1のdev失敗を実物で分析し、規約が指示に無いことが主因と特定した。gold参照との突合で判明した規約は2つ:(1)訂正は訂正後の主張だけをassertedで出し、真偽反転はmodalityでなく値で表す。(2)引用は前置き節を除いた主語始まりの最小文。これらと「値は訂正後の最終値」を明示した指示を`agent-muse-v2`とし、生成役・手順はv1と同一にした。dev→holdoutの順で測定し、holdoutはv1で参照済みのため**2回目の参照**として記録する（未見の改善証拠とは扱わない。未見確認は別集合が別途必要）。

- dev100: 採用precision 43/72→58/64（0.597→0.906）、採用recall 43/66→58/66、保留recall 34/34、区分 30/30。QUOTE不一致16→0、PAYLOAD 9→2、忘却後復活 2→0。対応付けでは v1失敗25件中18件が回復、悪化1件、双方失敗7件。
- holdout100（集計のみ）: 採用precision 42/69→45/55（0.609→0.818）、採用recall 35/66→45/66、保留recall 34/34、区分 30/30、違反0。QUOTE 17→0。残る不一致はPAYLOAD 5・VALID_TIME 2のみだが、不一致のあるケースは21件で、主因は誤採用ではなく未抽出（recall側）。
- 解釈: 規約の明示は構造の異なるholdoutにも移転した（precisionと引用は改善）。一方recallの改善幅はdev（+0.23）よりholdout（+0.15）が小さく、未見の文構造での取りこぼしが次の壁。閾値（各19/20）は依然未達で、Local正式受入ではない。
- 証拠: repo外 `~/workspace/dev/agent-model-run/run2/`。repo側の変更は本記録のみ。


## 規約の採用と手順実験の開始（2026年10月29日）

採用判断: エージェント対照実測で効果が確認できた2規約（訂正の扱い・引用範囲）を、共有指示文`EXTRACTION_INSTRUCTION`へ取り込み版を`eval-extract-instruction-2`へ更新した（providers.testの版固定も追随）。`spec/evaluation-baseline.md`へ規約と根拠を追記。全体verify 976件成功・失敗0。実モデル（LFM/Luna）での再測定は未実施で、この採用は指示文の既定値を変えるものであり、受入判定には影響しない。


## 手順明示v3の対照測定（2026年10月29日、採用せず）

holdoutで残った未抽出（recall）への対処として、抽出手順「主張文の列挙→抽出→文単位の再走査で取りこぼし回収」を明示した`agent-muse-v3`をdevで測定した（規約はv2と同一、生成役・手順基盤は同一）。

- dev100: 採用precision 58/64→60/67（0.906→0.896）、採用recall 58/66→60/66（0.879→0.909）と微増したが、保留recall 34/34→30/34、区分 30/30→26/30へ悪化。NOT_EXPECTEDが0→4件（再走査が保留すべき主張まで拾った）。PREDICATE不一致は6→1へ改善。対応付けでは v2失敗6件・v3失敗7件で正味は拮抗。
- 判断: **採用しない**。再走査の無条件な回収圧が保留の規律（A46の安全側）を壊すトレードオフであり、純増ではない。列挙ステップがpredicate選択を助けた可能性は副観測として残すが、devでの追加調整は過適合の恐れがあるため打ち切り、未見集合（E01 JacRED等）での検証候補とする。
- 証拠: repo外 `~/workspace/dev/agent-model-run/run3/`。repo側の変更は本記録のみ。共有指示文は`eval-extract-instruction-2`のまま不変。


## E01 JacRED外部妥当性suiteの実装（2026年10月29日、測定は未実施）

研究計画E01のadapterを新規suiteとして実装した。既存の`dataset.ts`/`runner.ts`/`scoring.ts`/`providers.ts`は変更していない。

- `eval/extraction/jacred.ts`: 上流DocRED形式からsuiteへの決定的変換と選定。文本文はtokenを`""`で結合（元文書の生バイトと偽らない旨をメタデータに明記）。entityは最小sent_idのmention名をdisplayName、残りをaliasesとし、idは`ent-<vertexIndex>`。goldは根拠1文のrelationだけを(subject, relation, object)で重複除去して保持し、複数根拠・Na・重複はunsupported件数として残す。選定はseed `jacred-e01-v1`のsha256順、除外は文数16・結合bytes 6000・entity数24・表現可能relationなしの順、上限dev 30/test 60で凍結し、manifestに選定前後の件数と理由別内訳を残す。
- `eval/extraction/jacred-scoring.ts`: relation P/R/F1（micro集計）、根拠文一致率。未知のentity id・relationコードの予測はinvalidとして分離しtp/fpに入れない。予測の重複除去と引用なし件数も数える。
- `eval/extraction/jacred-runner.ts`: 1件につきprovider呼出し1回（初回生成のみ）。alias主体は供給entityへ解決し、解決できないaliasは未知idとして採点側のinvalidに数えさせる。非relation候補はignoredとして数え、不正出力はinvalid_output、provider例外はerrorとして全件を分母に残す。
- 試験`test/eval/jacred.test.ts`は手作りの上流fixtureだけで変換・選定・採点・runnerを通し、実データファイルは読まない。
- 測定（実モデルでのdev/test実行）は未実施。結果が得られたら本台帳へ別途記録する。A46の閾値・受入の意味は変更していない。


## E01初回測定： JacRED dev30での外部妥当性（2026年10月29日、探索的・受入ではない）

suite `jacred-ja-v1` を使い、エージェントをremote対照モデルとしてdev選定30文書を測定した（条件： entity候補を与えた関係抽出、根拠1文に収まる関係のみが採点対象）。生成時の事故として、初回のバッチ生成で文書本文が生成役へ渡らない不具合があり、空回答は破棄して本文の存在を機械確認した上で再生成した。再生成分のみを採点している。

- 関係: tp 79 / fp 104 / fn 157、precision 0.432 / recall 0.335 / F1 0.377。正解側に当たった関係の根拠文一致は77/79（0.975）。形式違反・無効な予測は0。
- 採点対象は選定文書内の表現可能な正解236件で、対象外326件（複数根拠など）はunsupportedとして別数えした。JacRED側の正解の網羅性には既知の限界があるため、precisionは過小評価の可能性がある。
- 失敗の集中: HasPart（P527）は正解36件すべて未抽出、PartOf（P361）は fn 31、AdministrativeLocation（P131）は fn 31。過剰側はCreator（P170）fp 9（tp 0）、Follows/FollowedBy（P155/P156）は方向の混同が疑われる。生年月日（P569）・国籍（P27）はほぼ完璧だった。
- 解釈: 合成200件で見えた失敗（形式・規約）とは別物で、実テキストでは関係の意味判断と部分‐全体の向きが壁。小標本のため探索的表示とし、次の仮説は「部分‐全体と方向を持つ関係の定義・向きの明示」だが、devでの追加調整は過適合に注意する。
- 証拠: repo外 `~/workspace/dev/jacred-run/run1/`（suite・マニフェスト・レポート）。repo側の変更は本記録のみ。


## E01用語集v2の再測定とtest確認（2026年10月29日、探索的・不採用）

devの失敗集中を受け、全35コードの向き・定義・日本語表現を精密化した用語集v2で再測定し、未見のtest選定60文書では薄い用語集v1と対で比較した。

- dev30: F1 0.377→0.407（precision 0.432→0.467、recall 0.335→0.360）と小幅改善。ただし狙ったHasPart（P527）は正解36件が依然tp 0で、PartOf・所在・Creatorもほぼ不変だった。
- HasPartの正解実例を確認すると、州→都市・国→領域という地理的包含が大半で、根拠文は出生地等の文であり部分‐全体を述べる文は無い。JacREDが地理包含をP527で注釈するデータセット規約であり、モデルの失敗とは切り分ける。本文から直接読めるのは逆向きの所在（P131）までである。
- test60（未見・対比較）: v1 F1 0.319（P 0.321 / R 0.316）に対しv2 F1 0.301（P 0.310 / R 0.292）で、devの小幅改善は未見では再現しなかった。根拠文一致は両者とも全件一致。
- 判断: 用語集v2は**採用しない**。定義の精密化はこのモデル級・この課題では一般化する改善にならず、残る壁は関係の意味判断とデータセット規約の2つに整理された。今後の実モデル測定はv1相当の薄い用語集を基準とし、規約起因のクラスは採点解釈で注記する。
- 証拠: repo外 `~/workspace/dev/jacred-run/run2/`。repo側の変更は本記録のみ。


## E03引用意味支持の分析ハーネス（2026年10月29日、実装のみ・測定未実施）

研究計画E03の分析側を新規モジュールとして実装した。既存の`scoring.ts`/`runner.ts`/`dataset.ts`/`providers.ts`・契約・閾値・凍結datasetは変更していない。

- `eval/extraction/quote-support.ts`: 純粋・オフラインの検証と集計のみ。意味判定はrepo外（judgeモデルまたは人手）がJSON文書で作る前提で、本モジュールは判定を生成しない。
  - 型: `QuoteSupportVerdict`（supports/contradicts/insufficient）、`QuoteSupportItem`（itemId、goldMatched: boolean|null、contractValid、verdict）。
  - `summarizeQuoteSupport`: 判定総数・verdict別件数・支持率、goldMatched（true/false/null）別の内訳、層分離（contractValidRateと、契約を通ったものだけの支持率）、食い違い2種（gold一致だが支持なし／gold不一致だが支持あり）、atomicPrecision（goldラベル付き候補数を分母とし、無ければ全件を分母とする。recallは計算せず呼び出し側が併記する）。空入力では率はnullでNaNを出さない。
  - `parseQuoteSupportJudgments`: 判定文書`{suiteId, items:[{itemId, verdict, rationale?}]}`の厳密検証。未知verdict・itemId重複・欠落は`QuoteSupportError`。
  - `pairJudgments`: 予測と判定の対応付け。予測に無いitemIdの判定は常にエラー、未判定の予測は`requireComplete`指定時のみエラー。gold/契約フラグは呼び出し側が予測ごとに供給し、suite固有のレポート形には依存しない。
- 試験`test/eval/quote-support.test.ts`は手作りfixtureのみで集計・層分離・食い違い・検証拒否・対応付けを通す（14件）。
- 意味判定の実測定（judgeによる判定文書の作成と集計）は未実施。結果が得られたら本台帳へ別途記録する。判定は補助指標であり採用権限を持たず、A46/A50の閾値・受入の意味は変更していない。


## E03 引用の意味支持の初回測定（2026年10月29日、探索的・補助指標として採用）

取得済み出力の再分析として、引用が位置だけでなく内容も主張を支えるかを、生成の出所を伏せた別エージェントの判定（支持/反証/証拠不足）で測った。集計は `eval/extraction/quote-support.ts`（commit 50d875b、全ゲート1006件合格）。判定対象293件＝ext-ja-v2 v2実行の採用候補のうち候補が単一で同定可能な110件（曖昧な6サンプルは除外として記録）と、JacRED dev予測183件。全件が契約検証（バイト・範囲）は通過済み。

- gold一致した候補の引用支持率は 175/180 = 0.972。位置が合う引用は、ほぼ常に内容も支えていた。残り5件は照合の結果、引用範囲の粒度（文全体ではなく主張部分）と文書文脈への依存という規約差が中心だった。
- JacRED devでは、gold不一致の予測104件のうち41件が「引用文は主張を実際に支えている」と判定された。gold基準のprecision 0.432に対し、意味支持ベースでは 117/183 = 0.639 で、差の +0.207 はモデル過剰ではなくgoldの欠落・規約差として定量化できた。
- ext-jaでは意味支持ベースの精度が dev 0.918（gold基準0.906）とほぼ一致し、holdoutでは 49/49 だった（単一候補サンプルへの限定つき）。合成側の形式成功は過大評価ではなかった。
- 照合（運営者確認）: judgeとgoldの食い違い52件全件＋一致からの固定無作為12件を確認。judgeの実質的な誤りは「担当」をownerと厳密に読んだ1件程度で、食い違いの大半はgold側の欠落・規約差だった。一致標本は12件全て妥当。
- 限界: 生成とjudgeが同系統のエージェントであり、合意は独立証拠ではない。ext-jaのentity値の主張は、判定用レンダリングで対象名が一般表記になった件があり、引用文内の名前で判定されている（件数は測定成果物側に記録）。judgeに採用権限は持たせておらず、A46/A50の閾値は無変更。
- 判断: E03の補助分析は**採用**する（診断として有効）。今後の実モデル測定では、gold基準の主指標と並べて意味支持率を併記する。
- 証拠: repo外 `~/workspace/dev/e03-run/`（バッチ・判定・対応表・除外記録）。


## E04追加suiteの機構（2026年10月29日、実装のみ・測定未実施）

研究計画E04（履歴とSliceの同予算比較）の追加suite側を新規モジュールとして実装した。既存4条件のharness・runner・採点の振る舞いは変更していない。suiteデータ（episode・質問・gold・oracle素材）自体は別途作成され、`eval/decision/e04-suite.json`として供給される前提で、本実装はその読み手と集計だけを持つ。

- `eval/decision/e04.ts`: 純粋関数のみ（モデル・時計・ネットワーク・ファイルに触れない）。
  - `loadE04Suite`: suite JSON（suiteId `e04-ja-v1`、共通予算 `budgetTokens`、episodes、questions）の厳密検証。構造・ID一意性・分類の妥当性に加え、質問→episode、goldの根拠発話IDとoracleの根拠発話IDがそのepisodeに実在する相互参照まで検査し、違反は `E04SuiteError`。
  - `renderHistory`（H-full）: 全発話を `[発話ID] (日付 発話者) 本文` の行で時系列に描く。`truncateHistory`（H-budget）: 最新の発話から遡って予算（`estimateTokens` 見積もり、質問は含めない）に収まる分だけ残し、残した行は時系列で描く。切る規則はgoldを見ず実行前に固定。
  - `parseExtractionCandidates`: 抽出評価の疎な候補JSON（配列または `candidates` を持つオブジェクト）への寛容な読み手。不正な要素は例外にせず件数を数えて読み飛ばす。entity値の参照は `entityId` / `id` の双方を受ける。
  - `buildSlice`（W-slice）: 実抽出候補から決定的な選択・描画だけでSliceを作る。主体・対象はepisodeのentityへ解決（alias照合を含む）。保留様式（negated/hypothetical/question）を除外し、（主体、述語）ごとに引用発話が最新の候補だけを残し、質問に名前が出る主張を先に、残りを発話の新しさ順に並べ、共通予算で切る。引用はバイト範囲が正しく復号できる場合だけその範囲、でなければ発話全体。含めた根拠発話・予算で落ちた件数・supersede件数・保留除外件数・partialを返す。
  - `buildOracleContext`（W-oracle）: 質問のoracle主張を同じ予算規則で描く。診断専用で、製品ゲートや公式スコアへ混ぜない。
  - `scoreE04Answer`: goldに対する採点（必須語句グループ、禁止語句の混入、保留の適否、文脈内引用の妥当性と理由）。`summarizeE04`: arm別・arm×分類別の集計（正答率、混入件数、保留正確度、平均入力token、根拠recall平均、partial件数）。失敗とpartialは分母に残し、n=0の率はnull。
- 試験 `test/eval/e04.test.ts` は手作りfixtureのみで、loaderの検証拒否、履歴描画の順序、切詰めの新しさ保持と脱落報告、sliceのsupersedeと保留様式除外、予算超過のpartial、oracle描画、採点の各分岐、集計の算術と空armを通す（25件）。
- 実モデル測定（およびエージェント対照測定）は未実施。結果が得られたら本台帳へ別途記録する。既存A46/A50・`p5Accepted` の意味と閾値は変更していない。


## E04 Sliceの関連度tierに1ホップ展開を追加（2026年10月29日、実装の精緻化・測定未実施）

E04初回測定の準備で、連鎖した質問（multi-session分類、「検索APIが依存しているAPIの担当者は？」型）では必要な主張のentity名が質問文に現れず、従来の2段tier（質問に名前が出る／出ない）では予算で落ちることが分かった。`buildSlice`の並び替えだけを次のとおり変更した。supersede、保留様式の除外、予算の停止規則、返すフィールドは無変更。

- tier 1: 主体・対象の名前（aliasを含む）が質問文に現れる主張（従来どおり）。
- tier 1.5（新設・1ホップ展開）: tier 1の主張が参照するentity ID（解決済みの主体・対象ID）の集合に、主体IDまたは対象IDが含まれる主張。
- tier 2: 残り全部。並びは tier 1 → 1.5 → 2、各tier内は従来どおり発話の新しさ順。

試験は `test/eval/e04.test.ts` に2件追加（連鎖質問fixtureで、名前が質問に出ない主張が無関係なtier 2主張より先に並び、予算で落ちないこと。tier順序 1 < 1.5 < 2 が新しさ・入力順によらないこと）。仕様側は `spec/decision-evaluation.md` のE04節に3段tierを記載した。実モデル測定・対照測定の結果はまだ無い。既存A46/A50・`p5Accepted` の意味と閾値は変更していない。


## E04 探索的測定（2026年10月29日、エージェント対照・正式受入ではない）

P5-04.aのLocal正式受入に先立ち、同じ遠隔対照法（Museを読み手・抽出役）でE04を探索的に実施した。suite `e04-ja-v1`（独自作成の4エピソード×4問=16問、分類は更新7・時間2・棄却4・複数session3、LongMemEvalの分類を借用した独立セットで公式データの流用ではない）。予算は推定token共通上限150（当初240では全episodeに効かなかったため、読み手の結果を見る前に150へ変更して固定）。H-budgetの切詰めは「直近を残す」ルールを事前固定。W-sliceは実抽出（指示v2）から決定的に構築し、関連付けは名称一致＋1ホップ拡張（commit a6fa527）。W-oracleは診断専用。

- 主比較（同予算）: H-budget 正答 12/16（0.750）に対し W-slice 16/16（1.000）。平均入力は slice 142 に対し履歴切詰め 154 で、sliceは少ない入力で全問正答した。
- H-budgetの失敗4件は全て「切詰めで根拠が文脈から消え、読み手が正しく不明と保留した」ケースで、根拠recallは失敗した問いで0〜0.5だった。複数session分類は H-budget 0/3 に対し slice 3/3。失敗は読み手でなく検索側に帰属する。
- 参考アーム: H-full（無制限、平均240）は16/16、W-oracle（平均27）は16/16。W-sliceとoracleの差は0で、この規模では抽出・Slice構築による読解側の損失は観測されなかった。旧値の混入（contamination）は全アーム0件。
- 解釈の範囲: 履歴が短く全量が文脈に収まる規模では生履歴でも全問正答しており、「同予算ではSliceが勝つ」は支持されたが「Sliceが全履歴に勝つ」は本測定の対象外。標本16問・生成と読み手が同系統という探索的限界つき。p5Acceptedは変わらない（正式受入はLocal実モデル待ち）。
- 証拠: repo外 `~/workspace/dev/e04-run/`（抽出・文脈・回答・採点詳細）。repo側はsuite・ハーネス・本記録。


## P5-04.a1 対照測定（2026年10月29日、remote対照・正式受入ではない）

decision harnessにremote証拠種別を追加し（commit済み、受入には絶対に使えない柵つき）、既存20仕事×4条件をエージェント対照で初測定した。プロンプトはharness自身のbuildPromptをそのまま使い、予算2000、落下セル0。証拠: repo外 `~/workspace/dev/decision-run/run1/`（report.json/md）。

- 条件別合計（20仕事・各80点満点換算の素点合計）: memory-only 49、memory-related 52、memory-plain-facts 77、memory-world 76。安全違反は only/related に各6件、plain/world は0件。
- 評価15仕事の world対only: 改善11・悪化0・同点3・判定不能1（D19）。ゲート参考値は「悪化2」で不成立だが、その2件は調整用仕事D03/D04（world 3点に対しonly 4点/3点）で、評価仕事の悪化ではない。harnessの集計が調整用の悪化も数える現行仕様のまま記録する。
- framing（world対plain-facts）: 改善0・悪化1（D12）・同点19で **not-demonstrated**。強い読み手では、効いているのは事実の供給そのもので、Worldの枠組み表示（条件・置換・保留）の上乗せは観測されなかった。計画の規定どおり、枠組みの寄与は主張しない。D12の差はrubric必須語句への言い換え不一致（両回答とも保留自体は正しい）で、人手注記として残す（rubricは緩めない）。
- D19の要判定2件（「2名の承認でマージできる」の過剰一般化）は運営者判定で両件とも禁止主張に該当する（レビュー依頼の規則を認証処理の修正へ根拠なく拡張）。harness上の未解決扱いは変えず、注記として記録する。これによりD19は実質world改善側だが、公式集計は判定不能のまま。
- 解釈: 条件の明示と安全は plain/world 両方で確保され、差が出たのは必須条件の言い回し程度。枠組みの価値は弱い読み手（LFM2.5）でこそ出る可能性があるが未測定。p5Acceptedは不変。


## E04長履歴版の探索的測定（2026年10月29日、エージェント対照・受入ではない）

suite `e04-ja-v2`（v1の事実連鎖と16問を保持し、各episode約64発言・全履歴 約1,400推定tokenへ拡大、gold根拠は前半〜中盤に配置、時間分類にas-of質問を追加し18問）で同じ4アームを再測定した。予算は推定150tokenで据え置き。証拠: repo外 `~/workspace/dev/e04-run2/`。

- 結果: H-full 18/18（平均1,411token）、H-budget 4/18（棄却4問のみ正答、根拠recall 0.0）、W-slice 15/18（平均151token、根拠recall 0.89）、W-oracle 18/18。旧値混入は全アーム0件。
- 読み: この規模でも強い読み手＋全履歴は崩れなかった。Sliceの優位は予算が効く条件に限られることが改めて確認できた（同予算で 0.833 対 0.222）。H-budgetのrecall 0は根拠を前半〜中盤に置いた配置上の最悪条件であることも併記する。
- Sliceとoracleの差3件は原因が特定できた。(1) 連鎖質問2件（ep-a-q4、ep-d-q2）: 1ホップ先の主張が、同じ対象の周辺主張との予算競合で落ちた（根拠recall 0.5）。Slice内の優先付けの問題。(2) as-of質問1件（ep-d-q5）: 抽出規約とSliceの置換が「現在の値だけ」を残すため過去時点の状態を提示できず、読み手は誤答せず保留した（安全な失敗）。時点指定の質問には有効期間を意識したSlice選択が要るという設計上の指摘として残す。
- 事故の開示: 本測定の抽出指示で候補の包み形式（kind付きunion）を誤って別形式で指示し、初回のSliceが全空になった。生成内容自体は正しかったため、決定的な形式変換で包みだけを直して再構築した（変換前の生成物も証拠側に残る形で上書き前に確認済み）。数値への影響はない。


## P5-04.a2 対照測定（2026年10月29日、remote対照・ゲート未達、理由は構造的）

.a1と同じ20仕事について、質問を見せない抽出役が各仕事の原典（memory+related）だけから主張を導出し、明示した採用規則（根拠idが実在しmemory範囲内、重複除去）で44件を採用（棄却0）、実パイプライン（buildWorldSlice）を通して判断させた。証拠: repo外 `~/workspace/dev/decision-run/run2/`。

- 合計: 抽出由来world 38、抽出由来plain 43（.a1の手書きworld 76、手書きplain 77、memory-only 49）。安全違反は由来world 1件・由来plain 2件。評価15仕事の由来world対memory-onlyは改善1・悪化6・同点6・判定不能2で、計画の.a2ゲート（抽出由来で既存ゲート達成）は未達。
- ただし差の主因は抽出の失敗ではない。確認した仕事では、手書きWorld主張の決定的な条件が原典のどこにも無い。例: D01「在庫20個以上なら3営業日、未満は7営業日」は原典に無く、D07「バックアップは平日のみ（週末はメンテナンス窓）」も原典に無い（原典は毎晩実行とだけ言う）。D12「10万件は2025年度契約の値」も同様。原典だけからは原理的に導出できず、忠実な抽出は罠に落ちる。手書き主張が原典の言い換えに留まる仕事（D16）では由来worldも満点で、手書きと一致した。
- 帰結: .a1で観測されたWorldの改善（評価で11件）は、枠組みや導出の効果というより、運営者の知識を主張として注入した効果が大きい。製品配線では、条件・限定のような運営者知識の入力経路を一級の設計対象にすべきで、原典からの抽出だけで代替できるとは想定しない。これはworld-pipelineが手書き部分を開示してきたことの定量的な裏付けである。
- framingはここでも由来world≒由来plainで未実証のまま。


## E01規約v3の測定（2026年10月29日、エージェント対照・suite基準指示として採用）

JacREDの注釈規約（地理的・行政的包含はP527 HasPartで注釈する、P131のチェーン、入閣はP463所属など、E01/E03の分析で判明した分）を薄い用語集v1に足した規約v3を、dev30と未見test60で測定した。証拠: repo外 `~/workspace/dev/jacred-run/run3/`。

- dev30: F1 0.377（v1）→ 0.407（v2）→ 0.427（v3）。内訳は precision 0.439 / recall 0.415。狙った分類ははっきり動いた: P527 tp 0→21（fn 36→15、fp 18）、P131 tp 21→31（fn 31→21、fp 19）。
- test60（未見）: F1 0.319（v1）→ 0.301（v2）→ 0.363（v3）。recall +0.085、precision +0.011 で、規約の効果は未見でも再現した。用語集v2と違い、今回は採用する。ただしこれはJacRED suite専用の基準指示であり、WorldModel本体の抽出指示（eval-extract-instruction-2）とは分離したままにする。
- 動かなかったもの: P361 PartOf は dev/test ともほぼ不動（test tp 4→2）で、私の規約仮説（組織所属）ではgoldの用法を説明できていない。未解明として残し、これ以上の指示いじりはdevへの過適合になるため打ち切る。P170も小幅。残る差は関係の意味判断とgold欠落（E03で意味支持precision 0.639と定量化済み）。

## M0：計測基盤と改善の実装計画（2026年10月31日）

- 対象: `06e9480`を起点に、ブランチ評価の改善案をM0〜M5へ具体化。今回はM0のみ実装。共有指示・API・本体経路を再利用する方針を先に示し、新しい採点器・意味判定・DB接続機構は作っていない。
- 変更: `eval/measurement/{main,run,report}.ts`、package.jsonの`measure:world`、`test/eval/measurement.test.ts`、計画・受入索引・eval/README・構造文書。
- 公開契約・migration・本体src・兄弟repo・既存閾値の変更: なし。既存の未追跡bundleは変更していない。commit/push・マージも未実施。
- 機能: 既存extraction/decision/performance CLIを実行し、元レポート・stdout/stderr・exit・引数・コード/入力hash・環境を新規directoryへ保存。再使用拒否。失敗・invalidated・品質不合格を分ける。元データのchecksum検査と指標再計算、同条件の比較、変更ファイル・prompt版の表示。
- 受入: M01〜M05。実子プロセス、匿名化、失敗分母、未知usage、部分性能標本、コード/条件/環境/モデル/datasetの差、編集と復元、中断相当の未完了記録、改変・summary再計算を専用試験で確認。通常試験のモデル要求0。
- 部分→結合→全体: 専用 **6 pass / 0 fail / 55 assertions**。評価系 **380 pass / 0 fail**。最終`bun run verify` **1040 pass / 0 fail / 19084 assertions / 81 files**、`bun run build`成功。型・lint・境界・配布consumerはverifyに含む。

基準測定はコードを固定して保存した。下記はローカルのgitignored成果物で、共有・移送するときはdirectory全体を保全する。git commitだけでは今回の未commitコードを識別できないためmanifestのsource digestを正本とする。コード本文のsnapshotは保存しない。

| 実行（`bun run measure:world run --suite ... --out ... -- ...`） | 成果物 | 結果 |
|---|---|---|
| extraction、`--fixture oracle --split dev` | [ext baseline](../../artifacts/measurement/2026-10-31-m0-extraction-baseline/result.json) | completed、exit 0、fixture、正式受入false |
| decision、`--fixture good --mode evaluation` | [decision baseline](../../artifacts/measurement/2026-10-31-m0-decision-baseline/result.json) | completed、exit 0、fixture、p5Accepted false |
| performance、`--sizes 1000,10000,100000` | [performance baseline](../../artifacts/measurement/2026-10-31-m0-performance-baseline/result.json) | completed、exit 0、合成実SQLite |
| performance、同じ引数・同じコードでもう1run | [repeat](../../artifacts/measurement/2026-10-31-m0-performance-repeat/result.json) | completed、exit 0。ばらつきと比較経路を確認する対照 |

性能2runのsource digestはともに`5f295cbe3405719e9c118c6c98bc78cc90f80a86544ba579ef72877cf8f412b0`。
protocol digestは`d6fdae071afa1ae257c5164e30bb2dbe6a6337ca03da1543fcd432ee08781d4e`。
環境は各manifest参照（Bun 1.4.4、同じOS/CPU、seed 42、warmup 10＋100標本）。他の検証と重ねず性能計測を実行。

| 主張数 | Slice p95 run1/run2 ms | writer p95 run1/run2 ms | 最大取得行数 |
|---|---|---|---|
| 1,000 | 13.889 / 12.816 | 2.957 / 1.466 | 500 |
| 10,000 | 12.025 / 21.518 | 0.828 / 0.961 | 500 |
| 100,000 | 14.796 / 21.702 | 0.368 / 1.014 | 500 |

既存10k Slice<=50ms・通常writer<=20msの基準内。両者は同じ実装なので高速化実績ではなく基準のばらつき。
`measure:world compare --baseline ...performance-baseline --candidate ...performance-repeat --out ...performance-comparison.json`は[comparable、changedFiles=[]](../../artifacts/measurement/2026-10-31-m0-performance-comparison.json)。`replay --run ...performance-baseline`も追加モデル要求なしで成功。

- 実装: M0完了。fixture: 成功。実SQLite: 成功。host結合・実モデル・実運用: 未実施。正式A46/A50の受入は変更なし。
- 制約: 金額・正確なモデル呼出し数・host待ち時間は未計測。未報告tokensはnull。抽出raw生成文の追加保存はなく、既存holdoutの非保存・監査を維持。provider自己申告や外部モデルserverの不変性はこの基盤では証明しない。
- 差分点検: 個別語句・質問・資料IDで意味判断を代替する製品処理は追加していない。固定分岐は既存CLI/レポート契約・比較条件・安全な保全のためだけ。source/モデル/評価条件が変わった比較は改善の証拠にしない。
- 次の票: M1で同じsourceをplain/本体Sliceへ通す診断を実装し、現在のE04から本体へ持ち込むべき不足だけを再現する。M2/M3の本体変更・M4の有料モデル実行はまだ開始していない。

## 継続実装：M1〜M3とM4接続基盤（2026年10月31日）

ユーザーの継続実装・検証依頼により、World内で先行条件を満たす作業を実施。以下を最終版の証拠とする。上のM0記録は当時の到達点。

- M1: `eval/pipeline/{types,fixtures,replay,main}.ts`を追加。既存prepare/validate、公開inbox/candidate.settle、明示adopt、履歴読取、snapshot/Sliceを実ファイルWAL上で実行。引用検証だけで採用せず、採用は固定したfixture hostの操作。原典外の手書き知識やoracleを混ぜて効果を測らない。旧E04/decisionは独立して維持。
- 入力のraw候補、全verdict、供給/検証/保存/採用/取得/表示の根拠と欠落段階を保存。goldは採点だけに使う。plainとWorld表示はkind以外同じ素材を持ち、引用・条件・有効期間・状態・出典版・評価理由・探索coverageを保持。JSON全体のbytesを測る。
- M2: 既存のcondition/validTimeは本体経路で消えず、境界前/境界時点でsatisfied/violatedを正しく分けた。複数時点の主張を一律に最新一件へ潰す処理は追加していない。履歴用指示`eval-extract-history-1`はproviderのpurposeで明示選択。A46の既定v2本文はsha256 `16390c5b03e4f945cd79618990f6c17b18c37cd421423c90191c1c142db0c515`のまま。新指示の実モデル意味品質は未測定。
- M3: `SliceRequest.focusAssertionRefs`（最大64、ID/版一致、対象focusとの和）を追加。欠落/旧版/終端除外はpartialで明示し、必須単位が入らなければoverflow。既存の権限・source/restore・whole-unit・receipt・SQL境界を維持。schema/migrationと接続生成の変更なし。
- 表示は`indexed-sources/1`で重複する出典refを共通catalogへの整数参照にする。元のunitを完全復元できることを試験し、本体WorldSliceの形式は変えない。探索打切りのcoverageもモデル向け表示に残し、完全性を過大表示しない。
- dev原出力: `--record-dev`とM0自動連携を追加。最初の要求/出力/状態/usageのみを保全。holdoutは生成前に拒否、過大出力は省略を明示、記録失敗は後続要求を停止。`eval:replay-extraction`はdataset/要求/100件coverageを照合し、モデル要求0で既存採点を再生。再生providerは常にfixture。
- M4接続: `eval/extraction/larm-provider.ts`は既存host clientとreadonly設定読取を利用。期待モデルIDとの厳密一致、途中変更拒否、確認済みモデル版の明示指定を要求する。モデル版自体はcatalogで照合できず、operator由来と明記する。出力は無加工、取消signalを渡し、通常終了・早期拒否・例外で接続を解放。解放失敗は成功codeを返さない。設定・秘密のコピーやhost変更はない。

### 検証と最終版の比較

- 部分: 新規focus 4件、pipeline 7件、dev再生3件、登録provider3件、既存providerの履歴目的1件。主張の欠落/旧版/終端・入力上限・空集合互換・順序/重複・権限、引用不正、採用分離、可逆表示、期間境界、探索打切り、raw保全/省略/記録失敗、model不一致/途中変更/cleanup失敗を検証。
- 結合: projection・eval・scenario **623 pass / 0 fail**の後、追加したcoverage/接続終了の試験も最終全体へ含めた。
- 最終`bun run verify`: **1058 pass / 0 fail / 19187 assertions / 85 files**。整形・lint・型・境界・配布consumerを含む。`bun run build`成功。
- 対照は同じ最終harness/入力を使い、main `06e9480`の`projection/contracts/slice.ts`と`projection/service/slice.ts`だけへ戻した隔離コピー。新APIの未対応は診断として記録し、旧コードで新規API試験が合格したとは主張しない。
- [最終対照](../../artifacts/measurement/2026-10-31-final-control/result.json)、[最終候補](../../artifacts/measurement/2026-10-31-final-candidate/result.json)、[比較](../../artifacts/measurement/2026-10-31-final-comparison.json)はcomparable。差は上記2本体ファイルのみ。protocol digestは双方`3c410cd3914cf80b00b996976f5ee53e9d9ce198e7a3d96464020726699d7044`。
- source digest: 対照`f18b5aded39c3d02644a11f3bcc080c6145093e05a08472e7e881d0609843b42`、候補`5ec6dbff234098116060f6f6f3032f7a682cdcf80b65e90b20eca3156b23de6c`。未commitのコードはcommit番号だけで識別しない。

固定診断は3連鎖群＋時点境界2問（必要根拠8）。旧対象指定は両版2/8、新主張指定は候補8/8。旧版の新フィールド拒否による0/8をモデル誤答率と呼ばない。
3連鎖群の全表示は2825/2842/2844 bytesで共通4096以下、時点2問は各3096 bytesで8192以下。plain/Worldは同じ根拠を持つ。
rawは双方8/8であり、この小規模測定はWorldが原文より優れることや、実LLMの選択・未見の意味品質を証明しない。M3の意味品質ゲートは維持する。

性能も上記と同じ最終source/protocolの[対照](../../artifacts/measurement/2026-10-31-final-control-perf/result.json)/[候補](../../artifacts/measurement/2026-10-31-final-candidate-perf/result.json)を、他の検証と重ねず測定。[比較](../../artifacts/measurement/2026-10-31-final-performance-comparison.json)はcomparable。

| 主張数 | Slice p95 対照/候補 ms | writer p95 対照/候補 ms | 最大取得行数 |
|---|---|---|---|
| 1,000 | 9.763 / 8.671 | 0.992 / 0.992 | 500 |
| 10,000 | 8.813 / 8.850 | 0.777 / 0.316 | 500 |
| 100,000 | 11.254 / 11.583 | 0.227 / 0.773 | 500 |

10k Slice<=50ms・通常writer<=20msを維持。小差は実行ばらつきの範囲として扱い、高速化実績とはしない。
devの100件保全・再生もコマンド経由で実施済み。採点一致を確認（fixture、追加生成0、正式受入false）。実行例とコマンドはeval/README.mdを参照。

### 実モデルのゲート・残作業

[公開catalog確認](../../artifacts/measurement/2026-10-31-g5-catalog.json)では、profile名lfm2.5に対してmodel IDはornith1.5-strix。公開profile一覧もこの1件で、固定版・重みdigestは得られない。
設定名だけでは計画対象LFM2.5の固定モデル/版を同定できないため、正式200件/400生成とA46/A50は未実施。別モデルへ置換した結果でゲートを通していない。catalog確認は生成要求0。
M4の再開条件は、対象モデルの同定根拠と期待ID・確認済み版・予算を固定できること。adapterの準備は完了しているが、自己申告を実物の版証明とは扱わない。
M5のhost配線・実仕事一巡はM4と外部公開契約が先行し、兄弟repoは引き続き参照専用。parent P4/P5は未受入のまま。

俯瞰での方針修正: (1)単位選択だけで最終表示が入らない根拠を得て、上限を上げず出典catalogへ変更。(2)合成時刻資料の月表記に対応根拠が不足していたため、原典にUTC境界・単位を明記して両armを再測定。旧runは履歴として残し、最終採否の証拠はfinal-*だけを使う。(3)接続ownerの早期終了/例外/解放失敗を追加確認し、成功の誤表示を防いだ。
閾値・期待値を弱めず、正常な長時間処理を中断していない。source編集中の結果を最終根拠にせず、評価器を変えた際は対照も取り直した。
差分点検では個別の質問・名前・資料IDによる意味判断の代替、独自writer/queue/HTTP、製品DB・設定・秘密の変更はない。既存bundleと兄弟repoは不変。commit/push/mergeは未実施。

## Eumenes本体の更新と根拠保持（2026年10月31日）

ユーザーが「eumenes本体側を更新」「必要な改修も行って構わない」と明示許可したため、前節までの兄弟repo参照専用からEumenesだけを改修対象へ追加した。他の兄弟repo・製品DB・設定・秘密、サーバー操作は対象外。M4の正式品質ゲート、M5の実仕事一巡は未受入のまま。

- World配布物を`eumenes-world-model-0.0.1-be38c74a8016.tgz`へ固定し、hostのpackage/lock/manifest/checksumとインストール済みsource digestを照合。tgz SHA-256 `be38c74a80166f32c53b4bbe3bada3c9280a42980bc0be132ed4c4cf804e8769`、配布source digest `f5963ee9152fae95dd18ef566a967718f4798ef0230d7c47221a0f0537ba801e`。後者は配布対象srcのdigestであり、harness込みのM0 source digestとは対象範囲が異なる。
- 新旧のmigration 7本/hashと公開export集合は同一。旧tgz・他依存・本体の多数の既存差分を保持した。新規モデル向けツールや主張選択の既定動作は追加していない。
- host既存`world.query`/`sourceOf`を再利用。値120字・条件100字・述語60字での切断を再現し、全文保持へ修正。期間は条件計算の有無によらず提示。版manifestはdigest/representationを保持し、引用range/quote digestは元のEvidenceとして別に保持する。意味の採否・選択はLLM、codeは構造・権限・版・上限を検査する。
- host実SQLiteで主張ID/版のSlice選択と訂正後の旧receipt拒否を検証。登録済み調査経路から引用片・報告採用まで長文と条件が届き、予算超過のpartialも維持。実モデルではなくscripted fixture。
- 同入力の表示比較で値/述語/条件末尾の欠落が解消。有効期間は両版保持。Source本文1035→1524 bytesであり、最終要求全体の量や速度改善・モデル正答率とは扱わない。上限の増加はない。
- 変更前World結合212 pass。改修後は新規5件を含め217 pass / 0 fail、配布/migration/steward利用側133 pass / 0 fail。
- 本体作業ツリーの領域検証は途中のソース変更を検出しinvalidated。固定コピーでworld/agent-runtime/tool-runtime/stewardを再検証し、457 pass / 0 fail、UI 17 pass / 0 fail。format/lint/型/境界/SystemContext/SQL境界とDesignSystem buildを含めpass。前後revision `a88f297e7516ce55271d374bd989b8827ff14e2e3205e9b39cbfe01c58d0c9e1`一致。今回の実装・依存・試験ファイル11本と現ツリーをhash照合した。
- 担当外の境界4件・サイズ6件は別記し修正していない。新writer/queue/HTTPや例題・語句の意味分岐は追加なし。正式モデル比較・実運用・稼働サーバー反映・commit/pushは未実施。

正本は[Eumenes実装・検証記録](../../../eumenes/spec/world-evidence-integration-2026-10-31.md)。同repoの`verification-reports/world-integration-2026-10-31/`に変更前snapshot、再現/結合/利用側ログ、保持計測、固定verify report、対象ファイルhashと今回だけのpatchを保存した（gitignored）。全体の未確定変更を今回の差分として扱っていない。

## 技術品質80点に向けた改善（2026年11月5日）

ユーザーが改善・Claude/Lunaの有料比較・同一基準で80点以上の確認を明示依頼。
branch確認後、ローカルmain `06e9480`と既存の未コミット変更を前提に再開した。
開始時hashと今回差分を照合し、先行作業のprojection/focus、M0〜M4接続、bundle等を保持。
兄弟repoは参照専用のまま、検証はsourceだけの使い捨てコピーで実施した。

| 票 | 今回の実績 | 未受入・適用限界 |
|---|---|---|
| Q00 | 開始時全ファイルhash、固定API版・dataset・予算台帳、最終固定ソース前後hash一致 | serving重み・請求明細の完全同一性は証明しない |
| Q01 | 鮮度をedgeから影響/関連/依存/Gap/scenarioへ保持。旧版3 fail→修正後4 pass | confirmedは条件充足。鮮度から意味の採否をcodeで決めない |
| Q02 | 4 inbox状態のcandidate root、遅着拒否、実hostのsource由来root供給を確認 | 任意host/state→manifestなしinboxの自動発見は保証しない。新索引/migrationなし |
| Q03 | 配布文書同期、MIT通知を両tgzへ同梱、固定vendor維持、依存確認、clean consumer/frozen install、CI定義 | ホストされたCI runは未実行。そのアンカーは2のまま |
| Q04 | 共通API transport、zprofileキー継承、予算10 USD、失敗/不明usageの予約保持、fake5件と両社実接続 | 通常verifyで有料APIを呼ばない |
| Q05 | 対照・契約追補の抽出比較とdev診断、既存20仕事の判断比較を別記録 | 正式品質ゲートは別判定。独立60件、新40仕事の交差pipeline/盲検judgeは未実施 |
| Q06 | 全17種の共通境界、公開read/usage、split往復/全DML rollback、実process終了、3変異の検出 | 全17×全DML×全競合窓の直積や電源断は未検証 |
| Q07 | clean tgz導入→採用→Slice→拒否/rollback→forget→別process再起動、同DBを旧配布物へ戻して閉gate/本文0、実host/Memory journal復元 | 稼働host反映・実仕事・24時間運用は未実施 |
| Q08 | 同じrubric1.1.0/library全30項目で正式技術80.3点、根拠100%、確信度Medium | 計画全体の完了、API意味品質やLocal正式受入の合格とは区別 |

最終固定コピーで新規frozen install14パッケージ、verify **1078 pass / 0 fail / 19532 assertions / 90 files**、build成功。
最終tgzによる実host/Memory結合 **62 pass / 0 fail / 796 assertions**。
最終M0 source digest `4a826c7737b196ddc96a8ef94560257b9684a1a34a9972a8715237f674e9b5f7`、前後一致。

[再評価](quality-80-review.md)に30項目の根拠・評点と限界、[検証範囲](quality-80-evidence.md)にリスク行列を記録。
証拠は`artifacts/quality-80/2026-11-05/`。Expected80.4をCurrentへ流用せず、保守負債2・自動化2を維持。
CLIの意味修復や質問別分岐は追加せず、schema拒否は双方同じJSON生成へ固定し直した別runとして保存。
API追補は検証専用であり、既存の正式providerや製品の自動採用経路へ採用していない。

俯瞰評価の記録: hostコピーの依存不足3回を受けて実行環境の閉包を修正し、62件成功。
APIでは旧指示の型不足→native schemaの外部制約→非制約JSONの契約説明不足を根拠に方針を更新。
進捗のある長時間API処理を時間だけで再起動せず、固定コピーを維持した。
公開allowlistやconsumerの引数/返却状態/再migration等のfixture誤りは失敗記録を残して訂正し、期待を弱めて通していない。

initial_instructions 1回、context_compile累計4回、compile_eval累計4回。

最終API集計: 抽出1000評価、判断20仕事×4条件×両社160評価、接続/診断7要求で合計1167 POST。
usageからの保守的計上0.656022 USDと未確定2件の予約0.013605 USDを合わせ上限0.669627 USD。
台帳lock解放済み、10 USD以内。抽出は全版で95%/0許容を満たさず、追補3はdevで停止。
判断も両社で悪化・比較不能・要判定が残り未受入。独立60件/新40仕事/盲検judge/hosted CIは未実施。
技術80.3は確認したが、Q05や計画全体・Local/実運用の受入を完了扱いにはしない。

最後の全体確認で既存measurementの変更→復元をOS通知が取りこぼすケースを確認。
実行前後のinode/size/mtimeNs/ctimeNs照合を補い、portable source/protocol digestは内容hashのまま維持。
通知なしでも既存試験成功、時刻照合も外す変異では失敗。期待値/待ち時間は緩めず、最終固定verify1078件・build成功。
直接APIのprovenanceは旧remote注記と区別し、元reportを保持した派生記録を追加。数値や受入条件の変更はない。


## 2026年11月5日 API品質追補（プロジェクト内）

利用者依頼に従いCI・本流統合を除外し、API品質未達原因の改善と残る評価を実施した。[全結果と次票](api-quality.md)。

- 引用文字列→厳密UTF-8範囲のwire、callerの述語/観測catalog、共通指示、最初の失敗を保持して独立要求を継続する共通API sessionを実装。製品の意味分岐・schema/migration・独自writerは追加していない。
- 既存200×2モデル×2版=800、新独立60×2×2=240、40仕事×2抽出×2読取×2版=320比較/4arm1280回答枠を完了。全320比較の記録再生が一致。順序均等採点も完了し、回答不変と各組合せ内10回ずつの配置を検査。
- 固定コピーverify1086 pass/0 fail/19577 assertions/92 files、build成功。source前後一致c3823ad…。CIは実行していない。
- 同じrubric 1.1.0/libraryの全30項目で技術品質80.3を再確認。APIは品質未達、採点不一致も残り、受入済みにはしない。Local/P5・実host/Memoryの新規受入・長期運用を完了へ変更しない。
- 費用は過去分・未確定予約を含む保守的上限2.93 USD以内。全3826要求、最大同時2、API自動再試行なし。キーはzprofileの環境を利用し、個別.envへ記載しない。
- 証拠：`artifacts/api-quality/2026-11-05/`。元の回答・採点・旧snapshotは保持。以後の課金呼出しと本流取り込みは実施していない。


## 2026年11月6日 過剰保留・採点整合性の改善（プロジェクト内）

最新の正本は[API品質の確定結果](api-quality.md#最新の確定結果2026年11月6日judge-9--selector-2)。CI・本流/兄弟repoへの取り込みを行わず、既存ローカルmainと未コミット変更を保持した。

- selectorが根拠を空集合へ落としていた経路を再現。既存のcaller述語定義を渡し、資料上の根拠と条件充足/鮮度/有効時点を区別する共通指示へ修正。J02/J05専用分岐や空でない選択の強制なし。読取りdevは36/40→40/40。
- readerが見たcontextManifestがjudgeに渡らず、平文正答が誤判定される欠落を修正。共通factoryを再利用。旧graderでmetadata回帰試験1fail、新版で成功。校正は回答28＋抽出10で両社38/38。
- 全40仕事×2抽出版×2抽出×2読取の320組/1280回答枠を完了。候補Worldは全4組合せ40/40、原文より評価用12〜13件改善/全40件悪化0。平文は39〜40/40で改善5件要件を満たさず、構造の優位は未実証。
- 新規確認60例の候補版は両社とも95%/0違反/欠測0/意味57件以上を満たした。対照版の新規60例だけは費用配分で省略し、全40仕事の対照は保持。
- 既存native holdoutはLuna57/65 precision・57/66 recall、Claude56/64・56/66で未達。旧独立Luna意味56/60（必要57）も未達。対照版の撤回値再掲8回答枠、生成HTTP503の1要求/2セルも失敗として保存。**API総合は未受入**。元の期待値・分母・閾値・全arm安全性0条件を変更していない。
- 採点修正では全320組の回答・厳密採点・保存経路を固定し、434件の採点だけを実行。全320組の最終オフライン再生は差分0・ネットワーク0。同一judge入力310群は最初の判定共有で不一致0、異会社で同じ入力25群も全boolean一致。普遍的な採点精度の証明とはしない。
- Codex自身が事前固定8仕事/64組/256回答枠と全安全8枠・厳密/意味差12枠・J32を原典照合。外部人手や無作為標本とは呼ばない。残る差12枠はJ34の依頼外typed claimsで、厳密失敗を維持した。
- 最終固定コードverify **1094 pass/0 fail/19635 assertions/93 files**、build成功。同じrubric1.1.0/library全30項目・同じ重みで技術80.3、正式、根拠100%、確信度Medium、除外0を維持。製品src143ファイルは前回評価版と同一。Local/P5・実host/Memoryの新規受入・24時間運用を完了へ変更しない。
- 累積費用上限は既知usage9.26874495＋未確定11予約0.08889165＝**9.3576366 USD（9.36 USD以内）**、9947予約、最大2並列。過去計上・不明予約は減らさず、同じ累積10 USD台帳を使用。再試行・旧rawの再生成・有利な判定の選択なし。キーはzprofileを継承し.envへ複製していない。
- 最新M0 `df0d414fc74194a67b3ccb16ffa0c6ff70055a2a3218fc410a9fc67413fb851d`。source-context83.tgz SHA256 `4c6f22fa50519a32204d91c1a61e86d8c5f09f8b72def187010052e52e7ea2a2`。vendor/distを含む403 M0ファイルの一致を確認。各固定版を保持し、生成器・入出力ハッシュ・未変更関数の証拠で検証を接続した。

証拠は`artifacts/api-quality-next/2026-11-05/`のacceptance-final83.json、codex-source-audit83.json、score-technical83.json、offline-context83/、final-qa83.json、SHA256SUMS83.json。新しい根拠のないnative調整の反復を止め、注釈/意味解釈/保持更新/多出典の次票を残した。技術80点超と、新規/通しの候補版合格は確認したが、利用者が求めたAPI全基準の達成は未完了として報告する。以後の課金や本流取り込みは行わない。

## 2026年11月6日 コードレビューと修正

目的は現在のローカルmain・未コミット変更をレビューし、再現できる不具合を解消すること。
既存のLLM指示・API共通実行・条件評価・公開Slice・SQLiteの書込み境界を確認してから修正した。
範囲はこのプロジェクト内。CI・本流への取り込み・有料API検証は実施しない。
完了条件は再現試験、関連結合試験、verify/build、修正差分の再レビューで未解消指摘がないこととした。

修正した指摘は8件。

1. API応答のメモリ内・ディスク再利用がraw保存方針の違いを無視していた。保存方針の不一致は再送せず拒否する。要求hashを分けて初回応答を再生成する方法は取らない。
2. 費用台帳が不正・欠番・精算済み再利用の予約IDを受け入れた。連続した一意の安全整数だけを受け入れ、読込失敗時はlockを回収する。
3. 実usageが予約を超えた後も新しい費用予約を受け入れた。既知費用を保持したまま追加予約を止め、再起動でも同じ停止状態を復元する。
4. 台帳を閉じて書込みlockを解放した後も精算を書けた。終了後の精算を拒否し、ファイルが変わらないことを確認した。
5. `.mjs`/`.cjs`が測定の入力hash・実行中変更検知から漏れた。同じ共通判定に含め、書換え後に元へ戻した場合も測定を無効にする。
6. 同じキャッシュを使う別ApiSessionが、同じ要求を2回送れた。fake APIで2呼出しを再現。共通キャッシュに原子的な`.claim`と送信前の記録同期を追加し、実行開始・応答記録が欠けた場合も再生成を拒否する。単一sessionのメモリ内Mapでは別instance間を保護できないための最小限のファイル排他であり、意味判断の追加ではない。
7. 数学的な条件同値判定が、未登場の文字列/entity値と大きな数値の外側区間を試さず、異なる式を同値とした。公開条件評価を再利用し、等値集合の補集合、単位ごとの境界・区間を試す。組合せ上限は展開前に強制する。
8. `planScopeEpoch`が最大安全整数から不正な更新番号を作った。上限での変更は例外、同じ状態の再送は維持する。実SQLiteのfile/WAL・memory双方で、失敗時に以前の投影と更新番号を保持することを確認した。

回帰試験は修正前の失敗を記録してから修正した。初回5fail→23pass、重複呼出し1fail→関連40pass、条件比較1fail→9pass、更新番号3fail→563pass。
最終の評価系結合試験は41pass/0fail。`bun run verify`は**1104pass/0fail/19694 assertions/93 files**、`bun run build`成功。
format/lint/typecheck・依存境界・全domain・SQLite・インストール済みconsumerを含む。未実装のhost/運用受入を代わりに完了扱いにしない。

レビュー対象は既存差分、API費用/応答キャッシュ/採点/測定経路、公開契約、権限・Scope・revision、同期transaction/rollback境界。
最終差分点検では語句・シナリオ別分岐やLLMの意味判断を代替する処理の追加なし。今回確認できた指摘の未解消は0、残作業0。
実API品質の前回未受入はこのコードレビューで合格へ変更せず、過去の固定コード・採点記録・技術80.3点の証拠も書き換えていない。

追加API費用は**0 USD**。共有台帳のコピーを新しい読込規則で再生でき、累積上限は**9.3576366 USD**、9947予約を維持した。
原台帳SHA256 `37688e387670c221d0af5be252f9f475110c7d8b2dcc1fe1eec3c682e5172a70`は着手前後で一致。
証拠は`artifacts/code-review/2026-11-06/`のbefore.json、各修正前後のlog、integration-final.log、verify.log、build.log、budget-compatibility.json、final-audit.json。

## 2026年11月6日 API品質の残課題追試（8.2）

正本は[追試計画・全結果](api-quality-followup.md)。依頼に従い累積10 USD以内、CI・本流統合なしで実施。
`codex/api-quality-remaining`上の変更で、HEAD/製品src/公開契約/既存goldを維持し、commit/pushも行っていない。

- 既存のhost contextManifestを共通化し、抽出と抽出採点にも明示。生成入力へreference/holdModalityを混ぜないfake回帰試験は旧版で失敗、新版で成功。
- 「伝聞でも帰属を引用から落としてよい」という指示の矛盾を修正。日時と観測条件、述語方向を共通指示で整理。コードによる語句分類・逆述語補修・固定正答なし。
- 事前固定の新しいdev8例×両社×旧/新版は両社7/8→8/8。実際の話者帰属が欠落した引用が両社で修正された。抽出採点校正は既存10例/社すべて一致。
- 8.2の既存native holdout100件/社は400要求で全件完了。両社ともok100/100、処理エラー/違反0。
  Lunaは採用精度57/65→59/66・採用再現率57/66→59/66・保留32/34・区分27/30→28/30。
  Claudeは56/64→58/64・56/66→58/66・33/34→34/34・27/30→29/30。Claudeの保留/区分は合格、採用精度/再現率は両社とも95%未達。
- 同名群は両社7/10。残る正規方向・引用の不一致はredacted集計を保持し、隠れたgroupや名前別規則で通さない。
  旧独立の二出典期待と一引用形式の不一致、正規方向の契約の曖昧さ、既存40仕事の平文比較上限を残課題へ記録した。
- 旧/新独立60件、既存dev100件、40仕事の新版全体再実行は予算見込みに収まらず省略。部分標本や旧版の合格を新しい全ゲート達成へ外挿しない。**API総合は未受入**。
- 部分/結合26試験成功、最終verify **1105pass/0fail/19704 assertions/93 files**、build成功。
  固定コピーからのみ実APIを実行し、前後ソースと作業ツリーのsource digestが一致。秘密一致0、raw非保存400キャッシュの保存違反0、過去証拠8857ファイルのhash差0。
- 新規484要求、最大同時2、再試行0。追加費用上限0.57420675 USD、過去分を含む累積は**9.93184335 USD**（既知9.8429517＋従来の未確定11予約0.08889165）。
  過去の台帳prefixは不変、10431予約、残額0.06815665 USD。追加の課金は停止した。

証拠は`artifacts/api-quality-followup/2026-11-06/`。固定コードのarchive SHA256は
`09a0cbafdfcf71a8544492ad6befe64c189428a2a71e22b06a81d7176be827a5`。
観測できた改善を残し、原典/表現契約の整理と新しい十分な検証予算なしに、同じ失敗へ指示追記・再試行を続けない。

## 評価・表現契約の監査と判断更新（2026年11月6日、ローカル検証）

作業票は[contract-cycle.md](contract-cycle.md)。既存のLLM指示、wire、
公開候補検証器、採点、Scenario/SQLite更新機構を確認し、採点条件の緩和や
文言別の製品分岐を追加せず、既存機構を再利用した。srcと公開契約は変更していない。

- 固定40仕事の320セルをオフラインで再集計。groundedの平文対照は
  評価30件中29/30/29/30件正解で、完全なWorldの改善上限は1/0/1/0件。
  固定対照に対しては改善5件ゲートに到達不能。旧閾値と合否は維持し、
  summaryに到達可能性を別項目として追加した。将来のモデル試行の上限ではない。
- 独立60件のI-lifecycle-09は2出典を単一主張に要求するが、現行quoteからは
  Evidenceが1件しか生成されない。両方の引用を個別にnative decoderと
  公開検証器へ通して再現した。入力manifestで支持Evidenceを代用しない。
  この1件だけから全体95%が不可能とは断定していない。
- 有料acceptance/independent/regression等は、未解決の表現衝突を
  台帳/session開始前に検出して止まる。3入口を通信禁止の子プロセスで検証し、
  費用台帳の未生成まで確認した。古い結果・gold・採点期待値は変更していない。
- 「課金前に契約を監査する」という1仕事で、明示Goal→予測→実際の監査値
  →観測登録→旧receipt失効→新Slice取得→明示入力の判断案の訂正→新判断の
  利用検査を、実ファイルSQLite/WALと公開APIで一巡させた。
  next-stepは版2→3(candidate)→4(active)、根拠はoperator/audit/afterへ追跡可能。
  条件違反、依存不足、相関と因果仮説を別々に保持し、supportedを因果証明にしていない。
- 観測なし、古いreceipt、測定構成違い、未確認source、Scope不許可、host gate閉鎖は拒否。
  同一観測の再送はno_op、host後処理の失敗は訂正をrollbackする。
- 判断案・Goal・時刻・許可はfixture、監査値は実行結果、DBは実SQLite。
  Claude/Lunaの自律判断、実host実行台帳、Local/実機受入、Worldの優位性は未検証。
  過去のAPI総合未受入と正式評点を更新していない。
- 部分/結合は12pass/77 assertions。全体verifyは
  **1117pass/0fail/19781 assertions/95 files**、build成功。
  API呼出し0、追加費用0、台帳hash不変で累積上限**9.93184335 USD**を維持。
  CI/commit/push/本流への取り込みは行っていない。

証拠: `artifacts/contract-cycle/2026-11-06/`のbefore.json、audit/audit.json、
cycle/cycle.json、verify.log、build.log、final-audit.json。
監査と一巡のsource digestは一致。次は複数引用の意味・検証契約を確定し、
同一原典/同一operator情報の別protocolで実モデル判断を測る。未解決の契約を
指示追記だけで補い、既存評価を再課金する進め方は採らない。

## 契約修正のローカル受入（2026年11月6日、実APIなし）

作業票は[contract-remediation.md](contract-remediation.md)。編集前に
`contract-remediation/1`の合否条件と複数引用の契約差分を固定した。
旧改善5件/悪化0・95%・gold・過去結果は保持したまま、次を修正した。

- 公開operationの必須構造・未知field・SourceStateを利用前に検査。
  prediction/outcomeのinput欠落、null state、採用根拠のないplanは
  例外や書込みを起こさず拒否する。既存の根拠重複/版衝突の理由コードも維持。
- 観測訂正の接続例はOutcome、派生観測の置換、使用済み判断の失効を同じ
  host transactionで反映。最新版と不一致の測定を使う採用は拒否し、
  先行到着した生Outcomeからの反映・再送・途中失敗も試験した。
  新しいdomain queryは同一Outcome identityの最新版を既存索引で1件取得する。
  Outcome単独で任意hostの全派生文脈を自動更新するAPIとはしていない。
- `quotes` 1〜12個を公開候補へ追加、旧`quote`は互換、併記/空/過多/重複/
  不正な追加引用は拒否。第一Evidenceのhost割当IDを維持し、追加IDだけを
  同期SHA-256で導出する。全入力manifestとhost由来の根拠系列を保持した。
- Native抽出版は`typed-calendar-9-multiquote`。単一引用schemaも保持し、
  profileごとに実際の容量を監査する。新版で旧baselineを救済しない。
  I-lifecycle-09は元の2出典goldに一致し、read前forgetで全主張が消えることも確認。
- 部分/結合29pass/190 assertions。全体verifyは
  **1131pass/0fail/19887 assertions/97 files**、build成功。
- API呼出し0、台帳hash不変、累積上限**9.93184335 USD**。
  CI/commit/push/本流への取り込み、隣接repoや製品DBの変更なし。

証拠: `artifacts/contract-remediation/2026-11-06/`。
この合格はローカルの契約・結合に限定する。新版の実モデル比較、実hostの
実行台帳との接続、P5/Local正式受入、評点の再評価は未実施。

## 差分レビューと整合性修正（2026年11月6日、実APIなし）

既存の未commit変更を含め、公開入力、遷移plan、保存と利用再検査、複数引用、
観測訂正、評価への接続を点検した。既存のLLM指示・公開検査器・純粋plannerを
確認して再利用し、次の再現可能な問題を修正した。

- **遷移planの欠落・混入（P1）**: 停止対象を省略したinvalidateでも成功し、
  旧版がactiveのまま残った。現在のheadと既存plannerから再構成したplan全体を
  canonical照合し、書込み前に拒否する。6 actionで不正planの無変更と正規planの
  成功を検証。rule/subjectの認可はhostの責任であり、再構成で権限を与えない。
- **主張の検査経路による不一致（P1）**: 支持根拠のない無条件指定、originと
  根拠の不一致、実測時刻欠落が保存経路を通った。既存の文脈非依存な検査を共有し、
  保存・旧候補のactive化・通常read・receipt再利用・公開Projection/Sliceで確認する。
  既に保存済みの不整合なactive内容も利用できない。履歴取得と失効による後始末は
  維持し、失効後の旧内容は投影から除外する。
- **観測版の飛び番と遅着（P1、接続fixture）**: Outcome版からAssertion版を
  算出していたため、飛び番で正しい訂正を拒否し、遅着の反映で判断材料が巻き戻った。
  receipt中の実版と宣言した測定の出典・値・単位・metric・subjectを照合し、
  最新Outcomeより古い反映はDML前に拒否する。飛び番の訂正成功、遅着拒否、
  拒否時の全行不変を実SQLiteで検証した。
- **手書き評価材料の誤った扱い（P2、旧decision接続）**: 公開投影の検査を
  揃えた結果、出典のない4材料をactive/document_claimとして渡していたことが
  判明した。candidate/model_hypothesisとして接続し、Sliceのclaim/hypothesisを
  モデルへの提示にも保持した。新提示版は`decision-world-presentation/2`。
  課題・rubric・正解・合格基準は変更していない。旧実モデル結果はそのまま保持し、
  新提示との比較では両armの再測定が必要。この変更を実モデルの品質改善とはしない。

部分→結合→通しの順に検証。最終の対象結合は**113pass/0fail/2192 assertions**、
全体verifyは**1143pass/0fail/20001 assertions/98 files**、build成功。
途中の全体検証12failは上記の旧decision接続1原因に絞り、製品の検査や期待値を
緩めず修正した。再現試験、旧データ、正常系、後始末を含めて再点検し、今回の
確認範囲に未修正の再現可能な指摘は残していない。

変更は構造・状態・根拠契約の検査とfixture接続に限定。発話や固有名による
製品分岐、意味判断の固定処理、新しい実行基盤は追加していない。
過去証拠1052ファイルのhash差0、費用台帳hash不変、API呼出し/追加費用0。
累積費用上限は**9.93184335 USD**のまま。CI/commit/push/本流取り込みなし。

証拠: `artifacts/code-review-fixes/2026-11-06/`のprobes-before/after.json、
legacy-before.json、pure-projection-before.log、integration-final-v2.log、
verify-final-v2.log、build-final-v2.log、final-audit.json、SHA256SUMS.json。
実モデルのAPI品質は従来の未受入を維持し、実hostの接続・運用受入と正式評点の
再評価は今回のローカル成功から外挿しない。

<a id="host-sync-fixes-2026-11-06"></a>

## 初期同期と強制終了復旧の指摘対応（2026年11月6日）

ユーザーが4指摘の評価後に改修を依頼し、CIは対象外とした。F01/F02に必要なEumenesホストのソース・試験も対象に含め、製品DB・設定・秘密・サーバー操作、他の兄弟repoは対象外のままとした。別Codexチャットへの送信、commit/push、実モデル/API呼出しは行っていない。今回は評点を再計算しない。

- **F01 初期同期**: conversationの公開writer操作が、outbox以前の確定メッセージの現在版を200件ずつ補完する。既存イベントは変更せず、outbox自体で再送・rollback・途中再開を重複排除する。本文をoutboxへ保存しない。Worldは既存の適用関数・Scope/認可/墓標/schema/gate検査を共有し、OFF中の初期同期では`inbox.receive`のメタデータ受領だけを許す。意味適用・採用・モデル呼出しは通常のON条件を維持する。旧outbox-onlyの完了フラグは末尾migration `world/0012-initial-source-sync`で一度無効化する。開始済み状態を保存し、ページ上限・中断後も確定済みcursorから続ける。
- 初期受領の想定外の拒否や未確認のforgetが残れば完了にしない。Memoryで既に忘却した旧メッセージ、同期中の訂正・撤回、World inboxの消去、再送後の非復活を検証した。505件のfixtureでは500件の確定後に中断し、再準備でcursorを失わず、訂正・撤回後504件を重複なく受領した。初期同期の開始前・通常OFF中のscanは従来契約のまま。
- **F02 実process復旧**: `world-process.test.ts`が親から実SIGKILLを送り、別processでファイル/WAL・実Memory復旧・実World journalを開き直す。Memory journal追記後、World journal追記後、chunkのcommit前/後、Memory確認中、cursor保存中、restoreのbegin/reconcile/finish前/後の10境界を検証した。1002 rootsを分割して処理し、投影・主張履歴・墓標・Scope/host gate・cursor・Memory external確認・未完了intakeを、同じ復旧順を通した完全な対照再生と比較する。再送も一致。古いDB＋新しい両journalの復元も含む。restore epoch変更と未適用入力の破棄は既存契約であり、通常再開と完全復元の対照を区別する。
- **F03 runner重複**: `operative-sources-comparison`と`operative-sources-holdout`を共通`runner.ts`へ統合。入口は17/18行。資料・指示・採点・順序・上限・初回成功/失敗cache・凍結検査を維持した。両入口のprepare/resumeとsource変更拒否、保存済み回答の再採点をモデル呼出しなしで確認した。既存凍結runを新コードで無理に再開する扱いには変えない。

部分→結合→通しで検証。変更前は過去メッセージ受領0件、初期同期の再準備で確定cursorがnullになることを再現した。修正後の専用5試験は5 pass/0 fail（初期同期3・source backfill1・初期受領ガード1）。SIGKILL試験も下記ホストの最終通しに含む。

- WorldModel: `bun run verify` **1144 pass/0 fail/20017 assertions/99 files**、`bun run build`成功。境界、純粋層、SQLite、配布consumerを含む。製品src・公開export・配布物・固定vendorは不変。
- 固定コピーのEumenes: `bun run verify -- --domain conversation --domain world --domain memory --domain steward`成功。**backend 530 pass/0 fail/86 files、web 63 pass/8 files**。整形・lint・全体型・依存/SQL境界・規模上限・SystemContext・migration・DesignSystem buildを含む。最終input revisionは前後一致 `0045f9b15ae64141602b6d05dcdaef68c9915b7ec136bce1b845288b2903198e`。対象19ファイルは作業ツリーとbyte一致。
- 検証用コピーの初回起動はGit基点不足で失敗し、次はpackage固有の依存不足で停止した。実装や期待値を変更せず、コピーに実基点と既存の固定依存を接続して再検証した。担当外の既存差分・作業中に更新された文書は保持した。元の作業ツリーのDesignSystem buildやサーバー操作はしていない。

証拠: `artifacts/host-sync-fixes/2026-11-06/`の`world-verify.log`、`world-build.log`、`host-verify.log`、`host-report/report.json`、`initial-sync.log`、`resume-regression-before.log`、`final-audit.json`。契約は[ホスト接続契約の追補](../host-contract-v1.md)を参照。

**未受入**: 稼働hostへの反映・製品DBのmigration・実データ初回同期、実モデルの意味品質、実仕事、24時間/複数Scope運用、電源断・媒体破損・journal書込み中の全バイト境界。今回の10境界成功をそれらの合格へ読み替えない。CIは変更・実行していない。
