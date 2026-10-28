# WorldModel 実装進捗

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
| P3-03 | SourceAdapterと通常変更のoutbox | 完了(host fixture/実SQLite) | Eumenes api/domains/{conversation,world}: outbox migration、correct/retract、ConversationSourceAdapter。conversation 10+20、world 10件(A36)。retractは本文空化+retracted_atのtombstone(dialogue_runsのFKを保つ)、旧eventのrevision/digest消去、cursorは不透明化。残: 旧メッセージ(outbox導入前)の初期同期scan(initial-sync backfill)が無いためnot usable on deployed data until initial-sync backfill exists; World must not be enabled before it(導入済みデータでは使用不可、backfill実装までWorldを有効化してはならない)。retract後のdialogue/memory派生コピーはP3-05 |
| P3-04 | GoalSnapshotの公開口 | 完了(host実SQLite) | Eumenes api/domains/goals 12件(A37)。goal epoch/revisionで利用receipt失効判定。残: 操作冪等キー・World向け読取専用口の分離は未実装 |
| P3-05 | Memory依存登録と忘却復元の結合 | 完了(host temp file SQLite、crashはfixture) | Eumenes api/domains/world: memory-adapter、world-journal(別JSONL)、lifecycle-adapter、host-gate、feed consumer。world 63件、memory 2件(A25,A30-A32,A38)。残: 実process killとMemory実復元は未実施、>500 rootsは複数forget(~n)に分割 |
| P3-06 | migration登録と手動入力の縦断 | 完了(host実Writer/temp file) | World migration7本+world_host_state/lifecycleを末尾に追加、manual-world.test.ts、migrations.test.ts 12件(A22,A25,A39)。World既定OFF。server.tsへの配線は未実施、製品DBへの実migrationも未実施 |
| P3-07 | Context Brokerと回答採用 | 完了(host実Writer/queue、fixture provider) | Eumenes api/domains/world/service/context-broker.ts、dialogue worldContext port、world_host_usage。context-broker 11件+dialogue/world-context 36件(A24,A40: 4注入点×7原因)。送信直前検査はWriter往復でありsend直前の窓は閉じられない。app.ts配線・実provider未実施。他セッション作業(timers)の途中変更によりEumenes全体testは一時的に失敗中のため最終確認は未了 |
| P3-08 | World回答の本文とTTS公開制御 | 完了(fixture、実ブラウザ/実TTS未実施) | Eumenes dialogue worldUsed/worldBlocked、progress()を採用済み回答のみ、attitude dataset先行保存の漏れ修正、voice canSpeak。voice-dialogue/test/world-release.test.ts 8件(A41: SSE本文とTTS spy)。ゲートを外すと6件失敗を確認。残: LARM delivery judgeへ未採用本文が送られる、Memory/agent-projection runの同種dataset保存、app.ts未配線のため実ブラウザ検査不可 |
| P3-09 | 最初の製品接続の受入 | 完了(host fixture)、実Local Provider未受入 | Eumenes api/application/world.ts(EUMENES_WORLD=off|protect|on、既定off)、world-acceptance-p3.test.ts 4件+world.test.ts 9件(A34host側,A35-A41)、real-local-providerは明示skip(未実施)。残: 既存メッセージのsnapshot scan無し、製品のmessage forget入口無し、既定Scopeのみ、実migrationは一時DBのみ。実モデル未受入はP4-05へ |
| P4-01 | 継続入力の受領と進捗 | 完了(host fixture/実SQLite) | Eumenes world/service/extraction-intake.ts、feedStages(owner→scanned→received→applied)、change-feed.test.ts 14件(A28,A29,A42)。残: 履歴backfillなし、packageにinbox/checkpoint読取APIが無くhost recordで代用 |
| P4-02 | Local抽出のqueue handler | 完了(fixture provider) | extraction-handler.ts(world.extract、larm-only/cloudAllowed=false、30s budget、slot再利用防止)、extraction-handler.test.ts 16件+application/world-extraction.test.ts 6件(A19,A20,A43、Cloud fetch 0)。実Local Provider未実施、entity listing無しでsubject名はSUBJECT_UNRESOLVED |
| P4-03 | 前景優先と取消と再開 | 完了(host fixture/stub provider) | Eumenes world/service/foreground.ts、extraction-handler(hold/unconfirmed slot/stale attempt)、application/world-foreground.ts、inferenceにforegroundBusy hook。scheduling.test.ts 11件+application/world-scheduling.test.ts 5件(A44)。実Local Provider未実施。前景=interactive laneの全job(長時間jobで抽出が止まる) |
| P4-04 | Runtime結果の観測化 | 待機(fixtureのみ。公開実行台帳が無く未受入) | runtime-adapter.ts+RuntimeLedgerPort fixture、outcomes.test.ts 14件(A18,A45のWorld部分)。待機理由: tool-runtime/agent-runtime/capabilitiesにcomparisonId/metric/unit/config/baseline/検証状態を持つ公開snapshotが無い。package側にoutcome source入力・prediction読取APIが無い |
| P4-05 | 日本語抽出の実モデル評価 | 待機 | W側基盤(dataset200件・runner・scoring・fixture)完了: eval/extraction、test/eval/extraction.test.ts 64件、spec/evaluation-baseline.md。2026-10-28にSQLite登録Localで実資料1件＋対攻撃2件の候補保存まで成功。正式holdout・日本語品質・host queueの実モデル受入は未実施（spec/evaluation-baseline.md）。小規模結果でP4-05全体を完了にしない |
| P5-01 | 判断APIを製品で使う入口 | 一部完了(Task連携は未受入) | Eumenes world-query(6 mode、上限、権限外、executionPermission none)、model tool定義、POST /api/world/query(未mount)、world-query.test.ts 14件(A14-A16,A47)。Task連携: 実Tasks domainにGap用kind/権限が無く未受入。tool登録・query mount・実resource stateは未配線 |
| P5-02 | 根拠付き一覧と訂正画面 | 完了(fixture backend、実機未実施) | Eumenes /api/world/{status,claims,forgets,...}、web設定画面World、world-claims.test 13件+http 4件+vitest 16件+Playwright 1件(A48)。訂正理由は本人の確認済みメッセージ。source本文表示・entity表示名・曖昧対象のbrowser caseは未実装/mock |
| P5-03 | 一つの改善仕事を閉じる | 待機 | W側の純粋規則評価完了: eval/scenarios/cache-latency、test/eval/cache-latency.test.ts 47件(A45,A49のWorld部分)。待機理由: host実行台帳・Tool権限・P5-01/02/P4-04(host) |
| P5-04 | Worldを使う意味品質の比較 | 待機 | W側harness完了: eval/decision、test/eval/decision.test.ts 74件、spec/decision-evaluation.md。待機理由: G5(実モデル)・先行P5-03。fixtureのp5Acceptedは常に偽 |
| P6-02 | CapabilityとToolchainと自己改善への証拠 | 未着手 | — |
| P6-03 | 複数Scopeと長期運用 | 待機 | 条件のみ固定: spec/operational-acceptance.md。24時間実測は未実施(H runnerが必要) |
| P6-04 | 運用手順と最終受入 | 待機 | 手順骨子: spec/operations-runbook.md。全手順が未実施 |

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
