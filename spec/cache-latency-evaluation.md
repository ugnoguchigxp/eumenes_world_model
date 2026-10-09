# cache応答遅延の改善評価 (P5-03 World側)

2026年10月9日。`spec/plan/integration-tasks.md`のP5-03と受入A45・A49のうち、World側の純粋規則とfixtureで確認できる範囲だけを記録する。

## 到達状態(最初に読むこと)

- 到達点は**fixtureと純粋規則の証拠だけ**である。
- 実Toolの実行、ホストの実行台帳、実モデル、実SQLiteは一切使っていない。測定値は手で固定した数列で、台帳項目はfixtureが作った模擬記録である。
- **host結合・実運用は未実施**。P5-03全体、A45・A49のhost側(Task/Tool許可、実行台帳の検証済み版の受け渡し、HF・HA)は未受入のまま残る。
- ここの成功を実測値の改善実績や、cache導入の採否の根拠として扱わない。

## 対象と場所

| 物 | 場所 |
|---|---|
| 固定入力・事前期待値 | `eval/scenarios/cache-latency/fixture.ts` |
| 独立した参照計算・採点 | `eval/scenarios/cache-latency/scorer.ts` |
| 純粋API連結のrunner | `eval/scenarios/cache-latency/runner.ts` |
| 実行入口 | `eval/scenarios/cache-latency/main.ts` (`bun run eval:cache-latency`) |
| 試験 | `test/eval/cache-latency.test.ts` |

通常の`bun run verify`はnetworkもmodelも起動しない。runnerは測定を注入されたexecutor(固定数列の再生)で受け、実際のToolを呼ばない。

## シナリオ

1. 明示Goal: 「声の応答遅延を減らす」。`goalId=goal-reduce-voice-latency`、版1、`adopted`。ホストが与える参照であり、Worldは作らない。
2. cache候補: `cache-candidate`が`voice-response-latency`を`decreases`(比較軸 `voice_response_latency`/`p95`)する、という仮説edge。status `candidate`、因果伝播の対象外。`serves_goal`でGoalへ結ぶ。
3. 成立条件と依存: 効果の条件は「prefixが1024 token以上」(観測 `prefix_tokens=1200`)。依存は`prefix-cache-capability`、`stable-prefix`、`latency-measurement-tool`の三つ(`depends_on`)。`checkDependencies`が`all_available`でも`successConfirmed:false`で、成功は意味しない。
4. 測定計画(`MeasurementPlan`)で次を固定する。

   | 項目 | 値 |
   |---|---|
   | model | `voice-llm-fixed-v1` |
   | prefix | `pfx-v3-1200tok` |
   | 入力長 | `input-256tok` |
   | warm状態 | `warm` |
   | metric/単位/統計 | `voice_response_latency` / `ms` / `p95`(nearest rank、20件のうち19番目) |
   | 期間 | 1時間の半開区間 |
   | baseline | `baseline-cache-off-1` = 820 ms(cache off、同一構成) |
   | 許容 | 30 ms。これ以内の差は結果と扱わない |
   | 最小標本数 | 20 |

   この計画から`assessOutcome`用の定量予測(`expectedDirection: decreases`)を作る。比較条件のうちmodel/prefix/warmは`configuration`、入力長は`inputProfile`に載る。
5. 許可された実測: Tool許可がある場合だけ、注入されたexecutorが記録を返す。
6. `assessOutcome`で照合し、報告と採否の根拠を作る。
7. 再評価: 元データの訂正、Goal撤回のたびに同じ入力から報告を作り直す。

## 事前に固定した三系列と期待値

期待値は走らせる前にfixtureへ書いた手計算の値で、Worldの予測や出力から導いていない。評価器(`scorer.ts`)は、計画の「低いほど良い」という規則だけで標本から別途計算する参照結果(`referenceVerdict`)を持ち、固定期待値と一致することも採点に含める。Worldの予測が「減る」であっても、実測が増えれば`refuted`になる。

| 系列 | 条件 | p95 | baseline差 | 期待 |
|---|---|---|---|---|
| A improved | 計画と同一 | 640 ms | -180 ms | `supported` |
| B worse | 計画と同一 | 905 ms | +85 ms | `refuted` |
| C other input | 入力長が`input-64tok` | 410 ms | 算出しない | `incomparable`(`INPUT_PROFILE_MISMATCH`) |

Cは数値だけ見ると最も速いが、比較条件が違うため改善実績にしない。他にwarm/cold、model、prefix、単位、metric、統計、baseline、期間の差、および許容内の差(`INSUFFICIENT_RESOLUTION`)も`incomparable`になることを表試験で確認する。`supported`は予測と矛盾しない意味で、因果の証明ではない(`causalProof:false`)。

## 規則と対応する試験

| 規則 | 実装 | 試験 |
|---|---|---|
| 条件が揃わなければ`incomparable` | `assessOutcome`の比較条件照合 | 三系列、条件差の表試験 |
| 途中訂正は最新版が観測、古い版は判定しない | 台帳版=結果版。最新版が不採用なら古い版を復活させない | 誤→正、正→誤、入力順入替、最新版が未検証 |
| Goal撤回 | `GoalReference.status=retracted`。測定結果は変えず、採否を`moot_goal_retracted`にし、gapの`blocksGoal`を外す | 撤回前後の比較 |
| Tool許可なしで自動測定しない | 許可なしは`NeedsPermissionGap`(`TOOL_PERMISSION_REQUIRED`、`automaticMeasurementStarted:false`)。依存不足は`DEPENDENCY_NOT_SATISFIED` | executorの呼出回数0 |
| 「作業完了」と「仮説支持」を別に報告 | `work.status`は台帳だけから、`hypothesis.verdict`は観測だけから決める | 完了かつ`refuted`、`failed`かつ`not_measured`など |
| 観測の追跡 | 各観測に`outcomeId`/版、`ledgerEntryId`/`ledgerRevision`、`toolRunId`、`sourceRef`(標本のSHA-256を含む)。採否の根拠に目標版・予測版・観測版を持つ | 三系列それぞれ |
| LLMの「完了」文は観測にしない | `llm_text`は`LLM_TEXT_NOT_OBSERVATION`で除外。検証済みで成功した台帳だけが観測。失敗・未検証・標本不足も除外 | 文面のみ、台帳との併存 |

報告の`work.status`は`not_started`/`completed`/`failed`/`not_confirmed`、`hypothesis.verdict`は`supported`/`refuted`/`incomparable`/`mixed`/`not_measured`。採否は`keep_candidate`/`drop_candidate`/`undetermined`/`moot_goal_retracted`で、Worldが採用や実行を決めるものではなく、証拠の整理である。

## 実行

```
bun run eval:cache-latency          # 三系列と許可なし経路を採点。失敗時はexit 1
bun test test/eval/cache-latency.test.ts
```

## 閉じていない点

- 実Toolでの測定、実行台帳の検証済み版の取得、Tool許可の実判定はホスト側で、ここでは模擬。台帳項目・許可・`SourceRef`はfixture値で、Memoryの実source状態とは照合していない。
- 実モデルによる「完了」文の生成は使っていない。LLM文面はfixtureの固定文字列である。
- 測定期間の標本時刻、warm状態の実確認、baselineの出所は固定値で、検証していない。
- 目標撤回の通知経路、訂正が届く経路(ホスト→World)は未結合。
- 実SQLite永続(予測・結果の版保存)との結合は本評価に含めていない。
- HF(world/関連実行domain)、HAの受入は未実施。
