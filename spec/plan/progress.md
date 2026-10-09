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
| P3-07 | Context Brokerと回答採用 | 未着手 | — |
| P3-08 | World回答の本文とTTS公開制御 | 未着手 | — |
| P3-09 | 最初の製品接続の受入 | 未着手 | — |
| P4-01 | 継続入力の受領と進捗 | 未着手 | — |
| P4-02 | Local抽出のqueue handler | 未着手 | — |
| P4-03 | 前景優先と取消と再開 | 未着手 | — |
| P4-04 | Runtime結果の観測化 | 未着手 | — |
| P4-05 | 日本語抽出の実モデル評価 | 待機 | W側基盤(dataset200件・runner・scoring・fixture)完了: eval/extraction、test/eval/extraction.test.ts 64件、spec/evaluation-baseline.md。待機理由: G5(Local Provider未接続)・先行P4-02/03(host)。実モデル未受入 |
| P5-01 | 判断APIを製品で使う入口 | 未着手 | — |
| P5-02 | 根拠付き一覧と訂正画面 | 未着手 | — |
| P5-03 | 一つの改善仕事を閉じる | 待機 | W側の純粋規則評価完了: eval/scenarios/cache-latency、test/eval/cache-latency.test.ts 47件(A45,A49のWorld部分)。待機理由: host実行台帳・Tool権限・P5-01/02/P4-04(host) |
| P5-04 | Worldを使う意味品質の比較 | 待機 | W側harness完了: eval/decision、test/eval/decision.test.ts 74件、spec/decision-evaluation.md。待機理由: G5(実モデル)・先行P5-03。fixtureのp5Acceptedは常に偽 |
| P6-01 | ContextStillの知識参照 | 未着手 | — |
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

本依頼は「World本体のみ」(../eumenes は参照専用、変更なし)。完了はP3-01まで。P3-02〜09、P4-01〜04、P5-01/02、P6-01/02はEumenes変更を含む依頼が必要で未着手。P4-05/P5-03/P5-04/P6-03/P6-04はW側の基盤・条件のみ実施し、実モデル・host結合・実運用は未受入。全体verify:all 772件合格、build成功。全体完成ではない。

レビュー反映(2026年10月9日): 独立レビュー1回、指摘9件+軽微1件を一括修正。抽出評価はdataset v2/ext-threshold-v2、判断評価は対照条件plain-factsと否定対応の禁止語判定、配布はd.ts export一致検査を追加。verify:all 824件合格、build成功。
