# WorldModel 実装進捗

2026年10月9日。P0の構造準備だけが完了。以下は実装作業票の台帳であり、計画書の完成を機能の完成として記録しない。P0の22試験は[準備状況](../preparation-status.md)を参照。

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
| P4-05 | 日本語抽出の実モデル評価 | 待機 | W側基盤(dataset200件・runner・scoring・fixture)完了: eval/extraction、test/eval/extraction.test.ts 64件、spec/evaluation-baseline.md。待機理由: G5(Local Provider未接続)・先行P4-02/03(host)。実モデル未受入 |
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
- Memory配布物はローカル生成・生成時点のMemory src(未コミット変更含む)に固定。Memory側変更後は bun scripts/vendor-memory.ts で再生成。
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

本依頼は「World本体のみ」(../eumenes は参照専用、変更なし)。完了はP3-01まで。P3-02〜09、P4-01〜04、P5-01/02、P6-02はEumenes変更を含む依頼が必要で未着手。P4-05/P5-03/P5-04/P6-03/P6-04はW側の基盤・条件のみ実施し、実モデル・host結合・実運用は未受入。全体verify:all 772件合格、build成功。全体完成ではない。

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
