# 実モデル受入から学習の一巡までの実装計画

2026年10月28日。3つの拡張案を、WorldModel `ec876e3` の実装・受入記録に照らして統合した計画。
**今回は計画書の更新だけを行う。実装、モデル実行、製品への配線・投入は開始しない。**
以後の依頼で本計画の票を実装対象として指定できる。文書の存在だけで全段階の実施許可とは扱わない。

## 1. 目的と優先順位

WorldModelを「何を知っているか」の台帳から、根拠付きの状況を渡し、行動の予測と実測を照合し、次の判断を改善する基盤へつなぐ。
最初の判断材料は実モデルの測定結果とする。実モデルで未確認の意味品質を、追加fixtureの精密化だけで改善したとは扱わない。

着手順は以下に固定する。

1. **P4-05.a〜c**: entity供給契約を照合し、LFM2.5とLunaで同じ200件を比較する。
2. **P5-04.a**: 既存decision harnessの4条件を実モデルで比較し、抽出から作るWorldでも有効かを切り分ける。
3. **W1・W2**: 測定で必要と分かった失効伝播・状況提示の不足だけを直し、同じ基準で再評価する。
4. **P4-04.a、P5-01.i、P4-04.b、P5-03.i、P5-04.b**: 実行台帳の公開契約を整え、cache-latencyを題材に予測→実行→実測→照合→次の判断まで一巡する。
5. **AG1・L1**: Agencyとの接続、条件付きの規則の更新へ進む。
6. **P6.i**: Capability/Toolchain、複数Scope、24時間、20万head境界を実測する。

安全性・契約違反を実行前に発見した場合は、その最小修正を先に行う。一般的な機能拡張や予防的な再設計は先行させない。
小規模な成功やLunaの高得点だけでは、LFM2.5の正式受入を通過させない。

研究の取り込みは[比較実験計画](research-experiments.md)のE01〜E10を参照する。
初回の200件測定後にE03（引用の意味評価）とE01（JacRED）を追加し、P5-04.aでE04（同予算の履歴/Slice/oracle）を比較する。
不合格時も原因の診断は進められるが、研究実験で正式受入を代替しない。残りの実験は観測した不足と外部契約が揃った場合だけ発動する。

## 2. 現在地と、元案から整理した点

現状の正本は[進捗台帳](progress.md)。以下の項目を未実装として再度作らない。

| 元案の前提・提案 | 現物の根拠と今回の扱い |
|---|---|
| verifyが940件で整形・型に失敗 | `ec876e3`の記録は950件成功、build・独立環境相当も成功。[レビュー対応](../review-591b066-remediation.md)を参照。次回着手時に現在の状態を再確認するが、修正票には戻さない |
| entity listingが無い | [`listEntities`](../../src/sqlite.ts)と[`list-entities.ts`](../../src/application/sqlite/list-entities.ts)は既存。正式抽出の[`ProviderRequest.entities`](../../eval/extraction/runner.ts)にも候補がある。新APIを作る前に、実呼出しへの供給・版・上限・打切りの情報が欠けていないか調べる |
| SUBJECT_UNRESOLVEDが筆頭の実モデル失敗 | 過去のhost記録にはあるが、正式200件での頻度は未測定。供給不足、意図した曖昧性保留、モデルの取り違えを分けて数える |
| Sliceには落とす順位が無い | [`slice.ts`](../../src/domains/projection/service/slice.ts)はfocus必須、status、freshness、ID/版で順位付けし、説明単位ごと落とす。W2はこれを土台にした描画・状況提示の不足だけを対象にする |
| referencesCurrentContentをreasoningへ複製 | [`edgesFromEntries`](../../src/domains/reasoning/contracts/query.ts)が投影のcausalEligibleを運び、influence/dependenciesも既に参照する。W1は一連の受渡し・古いbasisの診断を確認する票とし、同じ版判定を各探索へ複製しない |
| JSON.parse、payload decodeを新規修正 | レビュー対応済み。不正生成の再投入防止と既存検証器を再利用する。新しいCORRUPT_ROWへの一括改名はしない |
| 抽出774件／10万件性能をこれから追加 | 抽出の正式datasetは200件（dev100/holdout100）。950は通常試験の件数。性能は[既存記録](../performance-baseline.md)に1千/1万/10万件があり、再測定と20万head境界を追加対象にする |
| Localが未接続 | 登録LocalのLFM2.5で実資料1件＋対攻撃2件の保存を確認済み。[小規模受入](../evaluation-baseline.md)は正式holdoutと区別する |
| P5-04のp5Acceptedを真にする | 真を目標値として実装しない。既存ゲートを実モデルで満たしたときだけ真になる。fixtureは引き続き偽 |

ホスト側は参照時点のEumenes `430ce3e6dbec4989190fc97195db34499bbf8d28`、Agency `bf34e9de9e6fa5b860eb4c8a86224be36250aa54`を確認した。
過去の34eead7の未配線記録を現在の欠落と断定せず、各ホスト票の着手時に実export・mount・tool登録・台帳を再照合する。

## 3. 境界と共通の完了条件

- **W**: このリポジトリ。純粋契約・検証器・同期SQLite API・評価harness・受入証拠を所有する。
- **H**: Eumenes。認可、entity/source/Goal snapshot、Provider、単一Writer、queue、実行台帳、回答採用と公開を所有する。
- **A**: Agency。目標、信念の確定、選択肢の選択と行動判断を所有する。
- **Memory**: 本人の記憶と原典の正本を所有する。Worldの解釈・規則候補で上書きしない。

H/A/Memoryの欄は外部の依存作業を明示するもので、WorldModelだけの実装依頼で兄弟リポジトリを編集しない。
必要な外部作業は契約・不足する実export・受入ケースを引き渡す。別Codexチャットへの送信はしない。

LLMは意味の抽出、対象候補の選択、状況説明、仮説・調査候補の提案を行う。
コードは権限、版、入力候補、出力schema、引用、予算、保存、数値照合を検査する。
名前・語句・個別の質問に対応した分岐で意味判断を代替しない。新しいHTTP層・Writer・queueをWorldに作らない。

各票の完了証拠には、変更ファイル、入力/契約/プロンプト/dataset/モデル/設定の版とdigest、実行コマンド、分子分母、全失敗、残る条件を残す。
通常試験、実SQLite、固定出力の再生、実モデル、host結合、実運用を別欄にする。
必要な境界・失敗の回帰だけを追加し、実モデル結果がないままfixture群を増やし続けない。

## 4. 作業票と依存関係

規模は変更範囲の目安で、工数や成功率の保証ではない。Mは複数の既存モジュール、Lは外部契約または実測の一巡を含む。
全票は未着手。既存P票の完了済み実装を作り直さず、残る受入を子票として実施する。

| 票 | 規模 | 所有 | 先行 | 成果・受入ID |
|---|---|---|---|---|
| P4-05.a | M | W、Hは供給確認 | 現行API照合 | entity候補と入力manifestの契約、N01 |
| P4-05.b | M | W(eval)、Hの既存接続を利用 | .a | LFM/Lunaの制約付きadapterと失敗記録、N02 |
| P4-05.c | M | W(eval) | .b | 同じ200件の差分・回収率・正式Local判定、N03/N04 |
| P5-04.a | M | W(eval) | P4-05.cのLocal正式受入 | 4条件の実モデル比較、手書き/抽出由来の区別、N05 |
| W1 | M、再現が無ければ検証記録のみ | W | 測定でbasisの問題を観測 | 失効根拠を使わない一貫した推論、N06 |
| W2 | M | W、H/Aは利用側 | P5-04.aの測定 | 状況viewと描画、選択肢・Gapの材料、N07/N08 |
| W5 | M、条件付き | W | 忘却の到達不足または費用を再現 | 最小の依存索引と移行、N09 |
| P4-04.a | M | H、Wは受入側契約 | P5-04.aの品質ゲート | 実行台帳の公開snapshot、N10 |
| P5-01.i / P4-04.b | L | H、Wは公開API | P4-04.a、W2、必要ならW1/W5 | 未配線分だけ接続、版と権限付き観測、N11 |
| P5-03.i | L | H＋W(eval) | 直前票、既存P5-02の必要範囲 | cache-latencyの実物の一巡、N12 |
| P5-04.b | M | W(eval)＋H | P5-03.i | 結果反映後の判断が改善するかを評価、N13 |
| AG1 | L | A/H、Wは公開操作 | P5-04.b | respond/settleとWorldの往復、N14 |
| L1 | L、後続 | W＋A/H | 複数の独立した実測経験 | 条件付き規則の候補と未見条件評価、N15 |
| P6.i | L | H、Wは測定・公開API | 実物一巡と採用するAG1/L1 | 運用・能力接続・大規模境界、N16 |

W1/W2/W5は独立した大型拡張の列ではなく、測定で発見した不足に対する作業票。
安全性に関わる再現済み不具合は直すが、効果を測れないW2の高度化や、根拠のないschema変更は保留する。

### P4-05.a：entity候補の供給を確認する

**再利用先**: [`runner.ts`](../../eval/extraction/runner.ts)、[`listEntities`](../../src/application/sqlite/list-entities.ts)、[`candidate.ts`](../../src/domains/extraction/contracts/candidate.ts)、[抽出評価仕様](../evaluation-baseline.md)。

- モデル共通の入力は、同じsource/window、許可されたentityのid・名称・alias、predicate集合、利用可能な観測キーとする。
- 既存ProviderRequest.entitiesを正本として再利用する。hostに不足がある場合だけ、同じScope・read snapshotから既存listEntitiesで取得する接続をHの残作業にする。
- entityの版、取得上限、truncated、Scope/原典/forget/restore/policyの版は検証用manifestへ保持する。モデルには判断に必要な候補だけを提示する。
- 候補の絞込みに意味判断が必要ならLLMへ委ねる。無制限全件読取りや固有名辞書で代替しない。未掲載候補を「存在しない」と扱わず、供給不足として記録する。
- 空集合、同名複数、未知ID、打切り、抽出中のmerge/forgetを区別する。モデルが選べないケースを自動採用しない。

**完了**: N01。正解の候補が供給されていない失敗と、供給済みだがモデルが誤る失敗を分離できる。
意図した曖昧性保留をSUBJECT_UNRESOLVEDの性能劣化へ数えない。供給契約を確定せずモデル能力の比較を始めない。

### P4-05.b：同じ契約でLFM2.5とLunaを受ける

**再利用先**: `eval/extraction/{runner,main}.ts`、[`local-smoke.ts`](../../eval/extraction/local-smoke.ts)、`examples/seed-luna/{luna,schema,quotes,pipeline}.ts`。
追加adapterはeval側に置く。既存exampleのschemaは単一のsource_claimとJSON文書の引用パス向けであり、正式datasetの汎用predicate・生発言へ無変更で流用しない。

- LFM2.5はSQLiteに登録したLocal Providerと既存Hクライアントを使う。Lunaは対照用のリモートモデルとして明記し、info.kind=localと偽らない。
- 現在fixture/localのみのProviderInfoとLocal専用CLIに、対照を識別する契約を追加する。Luna実行はLocal受入のeligibleを満たさない。
- 両モデルに同じ意味上の入力と出力schemaを渡す。SDKとLocalのwire差、必須reasoning、grammar対応範囲は記録する。未対応の制約を黙って外さない。
- 出力の型・ID集合・predicate集合・深さ・件数・bytes・引用範囲は既存検証器で検査する。意味内容はモデルに残し、引用の自動束縛はモデルが選んだ範囲の正規変換だけにする。
- 1件につき各モデルの最初の生成1回を評価する。不正JSON・引用失敗・timeout等を修正プロンプトへ戻さず、再試行や別候補で上書きしない。
- 配列や文字列の上限をparse前にも適用する。不正/過大出力は保存・inbox再投入・candidate.settleへ流さない。正しい候補も正式な採用規則を省略してactiveにしない。
- 無効化・取消後の遅着結果を受け入れない。再開は未実施ケースだけを対象とし、失敗したケースを未実施へ戻さない。

**完了**: N02。両adapterが同じ契約の正常・保留・拒否・取消を区別する。接続と各1〜数件の実モデル確認後、指示/schema/予算を凍結して本評価へ移る。

### P4-05.c：200件を比較し、失敗の集中と回収率を測る

**再利用先**: `eval/extraction/{dataset,scoring,runner,main}.ts`、`test/eval/extraction.test.ts`、`spec/evaluation-baseline.md`。
正本はext-ja-v2の200件、dev100と独立holdout100。新しい巨大datasetを作らない。

1. devで接続と入力契約を整える。モデル・prompt/schema・dataset・閾値・上限・呼出し順・中止予算を記録する。
2. 凍結した同一版を、LFM2.5とLunaの両方でdev100/holdout100へ適用する。基本は計400生成。接続確認や調整の追加生成は別勘定で記録する。
3. 同じケース内で成功/失敗を対応付ける。モデルの要求にはgold、caseId、群、split、他モデルの回答・診断を入れない。要求内容の共通digestを残す。
4. holdoutを一度見たら、その版の調整には戻さない。失敗を見て変更する場合は新しい評価版と未見評価集合が必要。既存のholdout監査とID/本文を出さない出力規則を維持する。

失敗の分類は、主分類を事前に固定して総数を一致させ、副分類の重複件数も別に示す。
少なくとも「provider/timeout」「不正JSON・schema」「引用不一致」「対象未解決」「predicate契約外」「意味・条件・帰属の誤り」を含める。
validatorの実reason codeを保持し、判定不能を推測で別分類へ移さない。各群・モデル別に失敗件数、差分、分母、LFMのみ失敗/Lunaのみ失敗/双方失敗を示す。

**エスカレーションの二つの測り方**:

- まず同じ200件の最初の出力から、LFMで失敗しLunaで正解になった割合を計算する。分母はLFM失敗数、0件ならn/a。これはgoldを使う事後的な回収上限で、運用で実行できるルートと混同しない。
- 実際に検知できるvalidator拒否・timeout・明示保留だけをルート条件にした場合の回収率、不要なLuna要求、誤りの見逃しも別に計算する。検証を通る意味誤りを、goldを見て実行時ルートに追加しない。
- 回収結果は独立したLuna対照の最初の出力を使う。LFMの失敗した生成文はLunaへ渡さない。計400生成と仮想運用の呼出し数・費用を二重計上しない。
- 対応済み出力での計算はオフラインの回収率。直列のLFM→Lunaの壁時計遅延を実測したとは書かない。Local失敗後の自動Cloud fallbackを製品に有効化しない（A43の保証を維持）。

**正式受入**: N03/N04、A46。主分析はLunaとの差の集中だが、既存のext-threshold-v2も維持する。
Localのholdoutで採用precision、適切な保留recall、区分正解率、採用recallが各19/20以上、Scope漏洩・引用捏造・忘却後復活・仮説の実測化は0件。失敗・timeoutも分母に残す。
LFM単独、Luna単独、評価用の混合結果を別々に示す。混合だけの達成でLocal単独の受入を完了にしない。

### P5-04.a：配線より先に、判断品質の差を測る

**再利用先**: `eval/decision/{runner,types,real-provider,world-pipeline,scoring,report}.ts`、[判断評価仕様](../decision-evaluation.md)。
旧P5-04を.a（独立評価）と.b（実測経験を反映する評価）へ分け、P5-03を先行必須とするのは.bだけにする。

- .a1: 既存20仕事×4条件（memory-only、related、plain-facts、world）を同じ実モデルで比較する。主モデルは正式受入済みLFM2.5。Luna対照は抽出と同様に別表へ置く。
- 現在のdecision実providerはOllama互換loopback用。登録Localを使うeval adapterを追加し、endpoint検査を弱めてLANへ直結させない。必要なら既存Providerポートを再利用する。
- .a1のWorld主張は手書きであることをレポートに残す。この結果は枠組みの評価で、実モデル抽出の有用性とは呼ばない。
- .a2: 同じ質問・原典から、P4の実抽出→候補検証→明示した採用規則→WorldSlice→判断をつなぐ別版を作る。手書きgoldの主張への置換や、抽出失敗セルを原文回答で救うことは禁止。no-World/related/plain-factsも同じ原典を使い、抽出由来かを明記する。
- 実行前に表示形式、予算、出力制約、採点、必要なら既存の訂正回数設定を固定する。抽出は引き続き最初の1生成だけ。判断の再生成を採る場合は全条件同じ上限とし、費用・初回成績を別に残す。
- 条件の順序と独立コンテキストを保ち、前条件のassistant回答を次条件へ流用しない。採点で言い換えの誤判定が出たら人手で注記し、既存結果に合わせてrubricを緩めない。評価結果を見てprompt・描画・採点を変更した場合は版を分け、同じ既知15件だけの再実行を未見の改善証拠にせず、変更前に固定した別の評価群でも確かめる。

**ゲート**: N05、A50。既存ゲート（安全違反0、悪化0、評価15仕事中5以上改善、全セル完了、要判定0）を維持する。
plain-factsを上回る効果は別に検査し、`framingEvidence`未実証ならWorldの枠組みの寄与を主張しない。
`.a1`のpassを`.a2`へ流用しない。製品への新たな配線に進むには、抽出由来のWorldでこのゲートとplain-facts対照の既存demonstrated条件を満たすことを要求する。
`p5Accepted`は既存の意味のまま残し、新しい配線移行ゲートは別欄へ記録する。親P5-04の全体完了は.bまで待つ。

### W1：失効した根拠を因果・依存の結論へ混ぜない

**変更候補**: `src/domains/reasoning/{contracts,service/shared.ts,service/influence.ts,service/dependencies.ts}`、`src/domains/projection/service/project.ts`、`src/application/sqlite/projection.ts`、既存scenario試験。

実行時に使ったedgeと原典・主張版を追跡し、投影→edgesFromEntries→探索→receipt検査を一巡で確認する。
状態遷移だけで矛盾を失わず、訂正・撤回・forget・restore後の再構築と増分結果が一致することを確認する。
reasoningが受けるedgeには現在Assertion本体やsupersedesが無いので、同じ意味の版判定を探索へ追加しない。
不足があれば投影/edge境界に最小のbasis検証情報を追加する契約を先に記録する。

古い根拠・根拠不明・条件不明を区別する必要が実測で出た場合に限り、既存reason codeとの対応を決めて`stale_basis`相当の診断を追加する。
旧edgeを渡された探索が常に最新DBを知るとは仮定せず、検証できないbasisはunknown/利用不可へ落とす。
**完了**: N06。誤った確定結論の再現がなくなり、正常な現行根拠の経路を過剰に消さない。再現が無ければ機能追加せず確認結果を残す。

### W2：状況・選択肢・必要な確認を、小さい文脈で提示する

**再利用先**: `projection/{contracts/slice.ts,service/slice.ts}`、`reasoning/service/{relevance,gaps,influence,dependencies}.ts`、`scenarios/service/compare.ts`、`eval/decision/{context,world-pipeline}.ts`。
計画上の追加名は`SituationView`と`renderSlice`。現行exportとして扱わない。新domainや第二の正本DBは作らない。

最初の題材をLARM/cache-latencyに絞り、同じScope/asOfの根拠から次を組み立てる。

| 提示内容 | 処理と境界 |
|---|---|
| 現在の対象・構成、問題 | 原典・観測・主張の版を併記。LLMの説明と検証済み実行状態を区別 |
| 原因候補と反証、まだ判断できない点 | 既存の因果/依存/Gapを素材としてLLMが解釈。unknown・disputed・適用条件を保持 |
| 前回から変わった点 | 版付きsnapshot差分。実行時の変化と、supersedes等による理解の訂正を分ける。由来が無ければ区別不明 |
| 選択肢ごとの見通し | 既存compareScenariosのoverlayへ前提を渡し、期待効果・悪化先・過去結果・判断が変わる条件を提示。Worldは選択・実行許可を出さない |
| 何を確認すればよいか | Gapがどの仮説・判断を区別するかをLLMに提案させ、hostが費用・時間・権限を添える。判断を変えない確認は低優先。コードの固定語句で順位を作らない |

描画は既存Sliceの原子性と版manifestを保つ。Goal関連度や反証・Gapを優先する選択が必要なら、根拠付きLLM提案とhostの必須集合を入力にする。
既存のfocus/status/freshness順位は対照として残し、「disputedなら常に最優先」のような一律の意味判断へ置換しない。
`renderSlice`はJSON等の明示した形式でデータをエスケープするが、エスケープだけをprompt injection対策とは呼ばない。
本文をsystem指示へ昇格させず、結論・条件・反証・出典ID/版を一単位で保持する。
表示予算にrendererの追加bytesも数え、必須単位が入らなければoverflow、任意単位の省略はpartialと省略理由を返す。digest/receiptは実際の選択内容に結び付ける。

**完了**: N07/N08。小数の予算境界goldenは契約確認だけに使う。主評価は実モデルでの条件追従・引用・誤一般化・入力bytes/tokenを、元のSlice表示と対比較する。
選択肢や調査優先度の拡張は、状況提示の小さな一巡で不足を観測してから着手する。

### W5：忘却の到達不足と線形コストを、実測に基づき解消する

**再利用先**: `src/application/sqlite/forget.ts`、各domainのrepository/migrations、`spec/{schema-v1,world-sqlite-public-api,performance-baseline}.md`。
現状はmanifestなしinboxのsource/state到達にhostのcandidate root指定が必要。entity参照を含むassertion/predictionの検索はScope単位のpayload走査がある。

通常の接続実験より前に索引一般化へ進まない。ただし製品のforget受入までに、到達不足を解消するか、Hが漏れなくrootを供給する検証済み契約が必要。
対象Scope、到達漏れ、走査件数・経過時間をまず測る。新索引が必要なら、正本と同じtransactionで依存参照を登録・削除し、既存行のbackfill、版替え、拒否候補、再構築、忘却・復元を含める。
immutable migrationを編集せず新しい番号を追加する。索引を別の意味分類器にしない。収集した本文を新表へ複製しない。
**完了**: N09。forgetの閉包と消去結果が変わらず、既存行・未settle入力からも到達する。EXPLAINと費用を測り、索引名だけで全走査解消を主張しない。

### P4-04.a / .bとP5-01.i：ホスト契約を切り、必要な配線だけ行う

**W側の変更候補**: `scenarios/contracts/{prediction,outcome}.ts`、`src/application/sqlite/{types,apply}.ts`、`eval/scenarios/cache-latency/`、`spec/host-contract-v1.md`。
**外部依存**: Hの公開実行台帳、World adapter、application組立て。編集先はホスト側の実exportを確認してHの作業票で確定する。

最低限のRuntime snapshotは、実行ID/版、実行したactionId/版/parametersDigest、Scope、comparisonId、prediction/plan参照と版、metric/unit/statistic、configuration/model/inputProfile/warm状態、baselineRef/値、測定window/値または標本、検証状態・検証器版、結果source/digestとする。
これは既存ComparisonConditions/Prediction/Outcomeへの対応表で確定する。新しい成功応答の仮実装や独自実行台帳をWorldに作らない。
LLMの「実行成功」本文、Toolの終了codeだけ、検証不明の台帳は実測値へ変換しない。
予測と結果は同じ行動・parameters・条件へ結び付ける。自由記述interventionだけで同一性を証明せず、対応不能は比較不能とする（研究E08）。

Hでquery mountとtool登録が既にある場合は作り直さず、認可・budget・Goal・利用receipt・生成後の再検査が同じ経路に載るかを確認する。
未配線分だけを接続し、取消・forget・原典訂正時の遅着観測を拒否する。既存P3-05〜09の製品導入条件と、必要なP5-02の訂正手段も満たしてから実物一巡へ進む。
**完了**: N10/N11。検証済みの公開snapshotだけがWorldの実測観測になり、権限なしで実行を開始しない。

### P5-03.i / P5-04.b：状況→予測→実測→更新→次の判断

**再利用先**: `eval/scenarios/cache-latency/{fixture,runner,scorer,main}.ts`、`scenarios/service/{compare,assess}.ts`、`eval/decision/`。

- cache-latencyを最初の実仕事とし、Goal、比較構成、対象入力、warm/cold、baseline、期待方向、許容誤差、測定窓と採否基準を実行前に凍結する。
- W2で根拠付きの状況を渡し、Agency/利用者が仮説と許可された比較を選ぶ。既存Predictionを保存し、Hが実行と測定を担う。
- 予測を見て行動を変更した場合は、実行前に変更後の行動について予測を作り直す。行動Aの予測と行動Bの結果を比較して更新しない。
- 実台帳のOutcomeをassessOutcomeへ渡し、supported/refuted/incomparableをそのまま残す。期待に合う標本だけを選ばず、失敗・未取得・条件違いも残す。
- 照合結果を根拠に、LLMが「どのモデル/入力/構成で何が成立するか」の修正候補を作る。候補検証と既存の採用手順を通し、元主張と理由sourceを追跡できるようにする。
- 取得できた結果の区分だけを報告する。3区分のhost受入ケースが揃わなければそのケースは未受入とし、数値を作って埋めない。
- 次の質問を、更新前/後の状態で、凍結した同じ判断基準と独立した文脈により比較する。調整に使った質問と未見の条件外・反対条件を分ける。

**完了**: N12/N13、A45/A49/A50。保存件数ではなく、同じ誤りの再発率、条件外への誤一般化、引用/保留の正確性、判断に必要なbytes/token・時間を報告する。
実測を踏まえて判断が変わっても、正しく改善した証拠がなければ「学習した」とは言わない。
P5-04の親票は、.aの独立品質比較と.bの実物による結果反映の両方を満たしたときだけ完了にする。

### AG1とL1：Agencyとの合流と条件付き規則

**W側**: `assertions`の公開候補登録/状態遷移、`projection`のSlice/receipt、`scenarios`の既存照合、[host状態対応](../host-contract-v1.md)。
**A/H側**: respondの文脈組立て、settleで確定したBeliefの公開イベント/版、依存登録、採用と取消。

AG1ではrespondが読む状況をWorldSliceへ段階的に寄せ、必要な直近の利用者発話と会話進行状態を残す。
「生ログをすべて消す」固定ルールにはせず、生のassistant履歴を正本扱いして反復増幅しない経路を比較する。
settleの確定Beliefは対応する版・根拠を持つWorld候補として登録する。AgencyでactiveだったことやconfidenceはWorldのadoptを意味しない。
元がself/assistant由来なら本人の発言・runtime_observationへ昇格させない。Worldから読んだ主張をAgency経由で独立根拠として水増ししない。
同じイベントの再送、撤回・forget・restoreの往復をHのtransactionと依存管理で閉じる。

L1では複数の独立した経験と反証から、LLMが共通する条件付き規則を候補化する。
一つのモデルや一件の成功から適用範囲を広げず、経験の重複root、負の結果、条件外・別モデルの未見評価を含める。
モデルのconfidenceや同じ説明の反復回数を真偽判定に使わず、検証前は仮説として表示する。
研究E08でWorldEvolver型の規則更新とPSALM型の前提/効果更新を別々に比較する。
確率を出すE09と実行可能規則のE10は別の発動条件を満たすまで追加しない。
**完了**: N14/N15。AG1では回答の訂正追従と自己反復、L1では未見条件への一般化と誤一般化を実モデルで比較する。
役割はContextStillが経験・手順、Worldが条件付きの根拠と見通し、Agencyが目標と選択とする。

### P6.i：一巡の後で運用と規模を確かめる

**再利用先**: `scripts/bench-world.ts`、`fixtures/performance/`、`spec/{performance-baseline,operational-acceptance,operations-runbook}.md`、P6-02〜04。

- 同じ機材・条件で既存1千/1万/10万件を再測定し、20万headの再構築と200,001件の拒否境界を実SQLiteで測る。上限外のblockedで途中DMLが残らないことも確認する。
- Slice p95<=50msの既存基準と計測範囲を維持し、read/render/モデル/host queue/再構築/forgetの費用を混ぜない。RSS、走査・取得・展開数、commit、再構築の時間を分ける。
- 性能のためだけにreasoning/conditionsを永続化しない。ボトルネックと再構築可能性、削除時の失効契約が測定で示された場合に別票化する。
- 2principal×3Scope・24時間以上で、漏洩/忘却後復活/未確認slot再利用/無入力LLMを0、背景ONの前景p95悪化を5%以内にする既存A53を維持する。
- Capability/Toolchainは検証済み実行台帳への証拠供給として接続し、Worldの主張からTool権限を拡張しない。
- reason codeの一覧型と最小consumer例は、今回の新しい境界を使う時点で公開契約・consumer試験へ反映する。既存のunionを再定義するだけの独立W7は設けない。

**完了**: N16、A52〜54。配布・upgrade・停止・復元・忘却維持を手順から再現できる。短いfixtureを24時間実運用の代わりにしない。

## 5. 受入ケース索引

既存Aケースは削除・弱化しない。Nは本計画の追加観点で、試験ファイル名は実装票の着手時に確定する。

| ID | 観測する結果 | 既存ケース・検証先 |
|---|---|---|
| N01 | entityの供給不足/モデル誤り/正しい曖昧性保留を区別。Scope越境と遅着採用0 | A07/A19/A43、extraction・listEntities試験＋実呼出しmanifest |
| N02 | 各モデル1生成。不正生成の再投入0、引用捏造の採用0、Local/対照のkindを区別 | A19/A20/A43、validator・adapter＋実接続 |
| N03 | 両モデル同じdev100/holdout100を全件集計。正式Local基準、理由別差分、holdout監査 | A46、extraction runner/scoring＋実モデル |
| N04 | goldによる回収上限と実行時検知可能な回収率を分離。分母・費用・n/aを検査 | extraction scoring、対応表の集計＋実出力 |
| N05 | 4条件、手書き/実抽出、初回/訂正を分離。p5AcceptedとframingEvidenceの根拠を保存 | A50、decision harness＋実モデル |
| N06 | 状態変更で矛盾保持、内容訂正・撤回後の旧basis不使用、restore/増分一致 | A10/A14〜16/A24/A32、scenario＋実測の再現 |
| N07 | 予算境界でも説明単位とID/出典/版を保持。注入文を命令へ昇格させない | A12/A13/A40、少数golden＋実モデル比較 |
| N08 | 状況・選択肢・調査候補に根拠/unknown/変更理由を付け、実行やGoalを自動生成しない | A14〜18/A47、LARMの一巡と比較 |
| N09 | manifestなし入力・旧行・entity参照へforget到達。backfill後も削除・復元一貫 | A22/A23/A30〜32、実SQLite/EXPLAIN/費用 |
| N10 | 公開runtime snapshotの条件/版/検証/実行行動の対応が不足なら実測化せずincomparable | A18/A45、Hの実台帳とWの照合 |
| N11 | 実mount/tool経路で認可・版・取消・receiptを一貫検査。権限なし実行0 | A35/A39〜41/A47、H結合＋実機 |
| N12 | 同じ実行行動の予測→実測→照合を原典へ追跡。変更後の行動を実行前に再予測し、標本を選別しない | A45/A49、cache-latency実測 |
| N13 | 更新後の未見質問で再発率/誤一般化/入力予算を比較。未評価は未受入 | A50、decision別版＋実経験 |
| N14 | WorldとBeliefの循環根拠水増し0、撤回/forget伝播、自己反復と訂正追従を比較 | A24/A31/A40、A/Hの実モデル結合 |
| N15 | 複数経験の負例と未見条件を含む規則評価。未検証範囲の拡張0 | A18/A50/A52、独立評価集合 |
| N16 | 20万head境界・24時間・複数Scope・能力接続・配布手順を実測 | A33/A52〜54、bench＋H長期runner |

## 6. 測定の記録と停止条件

最初の実行前に、モデルの正確な版、両adapter、prompt/schema/dataset/閾値のdigest、timeout、token/費用/壁時計の総上限、追加呼出しを許す条件、保存先をrun manifestへ固定する。
実行予算が未確定なら本評価を開始しない。今回の計画書作成ではモデルを実行しない。

holdoutのcaseId・本文・goldの非公開規則を保ち、ケース対応はrunner内部で行う。外へ出すのは既存の匿名化された集計とdigest・理由分類の件数。
開発用や公開可能な実資料の原出力は、保持条件を決めたローカル証拠へ保存し、製品DB・設定・秘密をコピーしない。
実行中に対象コード/入力が変わった結果はinvalidatedとし、成功として台帳へ載せない。

- 接続・採点装置の問題: 原因を特定し、条件変更と無効になった範囲を記録してから再開する。
- 形式/引用/供給の失敗に集中: promptを長くする前に入力契約・schema・validatorとの対応を見直す。
- 供給済みだが意味誤りに集中: devで仮説を一つ変えて評価版を分ける。個別例用コードを作らない。
- Local正式基準または判断の移行ゲート未達: 未受入として配線・運用へ進まない。対照・失敗分類と次の仮説を残す。
- 同じ目的で3ラウンド、または根拠のない失敗反復: 進捗・未解決仮説・残作業を俯瞰し、条件を変える根拠がなければ止める。正常な長時間の処理を時間だけで再起動しない。

実装時の検証順は、対象の最小契約/回帰→関連するSQLite/consumer結合→凍結した実モデル測定→通常の全体verify/build。
文書だけを変えた場合はリンク・実ファイル・依存順・受入条件を確認し、モデル評価やコード試験を実施したと記録しない。

## 7. 次の着手点

最初の実装対象は**P4-05.aと.b**。既存のentity供給とLFM/Luna adapterの差分を閉じ、各数件の接続確認で本評価へ進める状態を作る。
その後は**P4-05.cの200件比較**を行う。renderSliceのgolden追加、汎用の学習機構、運用配線を初手にしない。
未受入が残る段階での「完了」は、その作業票の契約・検証・証拠が閉じたことだけを意味する。
