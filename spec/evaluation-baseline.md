# 日本語抽出の評価基準（P4-05 / A46）

Local Providerが日本語の発話から作る抽出候補を、固定データと固定閾値で採点する基盤の仕様。実装は`eval/extraction/`、試験は`test/eval/extraction.test.ts`。モデル呼出し・queue・ホスト結合は含まない（ホスト所有）。

評価版は`ext-v2`（データ`ext-ja-v2`、閾値`ext-threshold-v2`）。`ext-v1`は退役した（理由は下記「版の履歴」）。v1の結果とv2の結果は混ぜない。

## 到達状態（混同しない）

| 区分 | 状態 |
| --- | --- |
| データセット（200件、正解固定、digest固定、holdoutはdevと文型が重ならない） | 実装済み（`ext-ja-v2`） |
| runner・scoring・fixture provider・CLI | 実装済み |
| fixture providerによる端から端の試験 | 実施済み（`ext-v2`で再実行。下記「決定的結果」） |
| 実モデル（Local Provider）による100件holdout評価 | **未実施・未受入**。Local Providerが未接続のため結果は存在しない。G5は未充足 |
| 実機・ホスト結合（P4-02、03、04） | 本票の範囲外 |

fixtureの結果はharnessが基準どおり動く証拠であり、モデルの品質の証拠ではない。実モデルの結果が表に入るまで、日本語抽出を受入済みとして扱わない。

## データセット

版`ext-ja-v2`。合成日本語のみ（実データ・秘密を含まない）。`eval/extraction/generate.ts`のテンプレート（語彙は`vocabulary.ts`）から決定的に生成し、出力を`eval/extraction/dataset.v2.json`にコミットする。正解はモデル実行前にここで固定され、実行結果を見て変更しない。

- 10群 × 20件 = 200件。各群は開発用`dev`10件、`holdout`10件。caseIdは`ext-v2-<group>-<dev|holdout>-NN`（NNは01〜10）で安定。
- 群: negation（否定）、hypothesis（仮定）、hearsay（伝聞）、other-person（別人）、same-name（同名）、period（期間）、condition-mismatch（条件違い）、multi-evidence（多根拠）、correction（訂正）、ordinary（通常例）。
- 各件は、合成発話（1〜3発話）、host供給のentity集合、期待結果、引用範囲を持つ。引用範囲は**Unicode code point**の`[startCp, endCp)`で保存し、検査は抽出ドメインのUTF-8 byte範囲へ変換して照合する。
- 期待結果は、`adopt`（採用する候補の主体・述語・値・引用・期間・条件・扱い）か、`hold`（適切な保留）。holdの理由は否定/仮定/質問/主体未解決/主体曖昧/忘却。

| 群 | 内容（devもholdoutも、意味の型は同じで文型は別。各splitは5文型を2巡） | 期待 |
| --- | --- | --- |
| negation | 「…は使えない」等の否定 | hold、区分`negated` |
| hypothesis | 「もし…なら」等の仮定 | hold、区分`hypothetical` |
| hearsay | 「…さんによると…そうだ」等の伝聞 | adopt（`reported`、仮説として採用）、区分`reported` |
| other-person | 担当が自分ではなく別人（5件）／Scope外の人物の話（5件） | adopt（別人を主体）／hold（主体未解決） |
| same-name | 氏名まで言う（5件）／姓だけ言い曖昧（5件） | adopt／hold（主体曖昧） |
| period | 年月日の始点・終点・両端（精度は年/月/日） | adopt（期間付き） |
| condition-mismatch | 「Wi-Fi接続中のみ」等の条件付き主張 | adopt（条件式を保持。条件落ちは誤採用） |
| multi-evidence | 雑談を挟む複数発話、同じ主張を2発話が支持 | adopt（支持する引用を含む発話を正しく選ぶ） |
| correction | 値の訂正（8件）／「忘れてください」（2件） | adopt（訂正後だけ）／hold（忘却） |
| ordinary | 単純な主張（8件）／疑問文（2件） | adopt／hold（質問） |

holdoutの内訳: 採用66件、保留34件、区分評価30件（否定・仮定・伝聞の各10件）、忘却ケース2件。devも同じ内訳。

### devとholdoutの独立（v2）

v1では、holdout 100件のうち95件が、entity・人名・数値・前置きを正規化するとdevと同一の文骨格だった（生成器が両splitで同じテンプレートを使ったため）。devでpromptを調整するとholdoutの文型も学習でき、holdoutが未知の汎化を測れなかった。

v2は群ごとにsplit別のテンプレート族を持つ。devは従来の文型（常体、「…そうだ」「…に依存している」等）、holdoutは別の文型（丁寧体、語順・語彙・構文を変えたもの、別の前置き・雑談文・根拠文）を使う。entity・人名・数値・前置きが違うだけでは別文型と数えない。

- 文骨格: 前置きを除き、entity名→`<S>`、人名（さん/氏付き）→`<P>`、田中→`<T>`、山田→`<Y>`、数字→`#`に置換した文（`eval/extraction/skeleton.ts`の`normalizeText`）。
- 試験`holdout is independent of dev`: 件単位の骨格と、文単位の骨格（句点・疑問符で分割）の両方で、devとholdoutの共有が0であることを検査する。
- 試験`the retired v1 data fails the independence check`: 退役したv1データ（`eval/extraction/retired/dataset.v1.retired.json`、digest固定）では同じ検査が95件の共有を報告する。つまり検査はv1で失敗する。
- v1データは退役物として残すだけで、`loadDataset()`は読まない。評価には使わない。

### 固定（digest）

`DATASET_SHA256`（`eval/extraction/dataset.ts`）は、データ全体（本文・正解・split）をキー整列したJSONのSHA-256。`loadDataset()`は一致しなければ`DatasetIntegrityError`で停止する。`test/eval/extraction.test.ts`が同じ値を独立に固定し、件数・split・caseId・正解の変更、生成器の再現性、引用範囲のcode point/byte往復を検査する。

現在値（`ext-ja-v2`）: `100097a76c4832c2af76b419c0fc16153f412163a711399d12ad10e1fc0fd332`
退役値（`ext-ja-v1`）: `712cff3b17fad1662fd0a5e5f9c26c8ded4940f069b3a7c42cea372aff51e296`

正解や件を直すときは、新しいデータ版（`ext-ja-v3`等）とdigestを作り、旧版の結果と混ぜない。

### holdoutの扱い

- holdoutをprompt調整・失敗の確認に使わない。調整は`dev`だけで行う。
- runnerの`selectCases`は`tuning`モードで`holdout`を要求すると`HoldoutAccessError`を投げ、provider呼出しの前に止まる。`dev`の実行は`tuning`モード固定。
- `diagnosticCaseText`（`--show-failures`）はholdoutの本文を出さない。reportにも本文は含めない。
- holdoutの実行結果は、標準出力にも結果ファイルにも**caseIdを出さない**（件数と分子・分母だけ）。失敗caseIdの一覧（precision・保留・区分・採用recallの失敗、0許容違反の件、欠落サンプル）は`dev`の出力にだけ出る。holdoutの結果ファイルは`redactHoldoutReport`でid列を件数に、サンプル列を件数に置き換える。
- holdoutの`--json <file>`は`<stem>.<UTC時刻>[-n].json`を毎回新規作成する（排他的作成。既存ファイルは上書きしない）。作成できなければ非ゼロで終了する。devの`--json`は従来どおり上書きする。
- fixture以外のproviderでholdoutを実行するたびに、`eval/extraction/holdout-runs.jsonl`へ1行ずつ追記する（`start`と`finish`）。各行に時刻、評価版、データ版とdigest、プロンプト版、モデルID・版、`finish`には各指標の分子/分母を持つ。**`start`行の数がholdoutを見た回数**で、プロンプト版ごとの回数を監査できる。ログを書けなければholdoutは実行しない（終了コード3）。ログのコミット・保管は運用者の責務。
- holdoutの本文がproviderへ渡るのは、`acceptance`モードでholdoutを実行するときの要求のみ。モデルが見る要求にgold・参照候補・Scope外entityは含まれない。
- 要求は`caseId`・群・splitを持たない。要求には実行ごとに塩を変えるハッシュ由来の不透明な`requestKey`（16桁hex）だけを付け、`requestKey`→caseIdの対応はrunner内にだけ置く（fixtureは見える窓の本文から自分の正解を引く）。モデルは要求からdev/holdoutや群を読み取れない。
- devとholdoutは、同じ発話文（雑談文を含む）も、同じ文骨格も共有しない。

## 閾値（`ext-threshold-v2`）

初期受入。結果を見て緩めない。変更するときは新しい評価版と理由を残す。

| 指標 | 定義 | 閾値 |
| --- | --- | --- |
| 採用precision | モデルがacceptedにした候補のうち、正解と全項目が一致するもの。同一候補の重複は1件だけ正解、残りは誤り | >= 19/20 |
| 適切な保留recall | 期待がholdの全件のうち、acceptedが0件だったもの | >= 19/20 |
| 区分正解率 | 否定/仮定/伝聞の件のうち、候補のmodalityが期待区分ちょうど1種類だったもの | >= 19/20 |
| 採用recall（v2で追加） | 分子＝採用すべき件のうち、正しい候補がちょうど1件acceptedで誤採用が0件だった件数。分母＝採用すべき全件（holdoutでは66）。timeout・error・不正出力・サンプル欠落は不採用（miss）として分母に残す | >= 19/20（66件では63件以上） |
| Scope漏洩 | Scope外entity idの参照、Scope外の下書き・source | 1件でも失敗 |
| 引用捏造 | 範囲外・窓外発話・digest不一致など、原文が裏付けない引用 | 1件でも失敗 |
| 忘却後復活 | 忘却を依頼した発話・主張が候補として再び採用された | 1件でも失敗 |
| hypothesisの実測化 | 仮定・伝聞が事実（asserted、`model_hypothesis`以外の由来）として採用された | 1件でも失敗 |

- 比率は整数比で比べる（浮動小数の誤差なし）。分母0は合格にしない（採用が0件ならprecisionは未定義で不合格）。
- 採用precisionの分母は「acceptedにした候補」で、失敗したサンプルには候補がなく分母に入らない。そのため採用precision単独では、沈黙・timeoutで大半を落としたproviderが満点になる。これを採用recallの閾値で塞ぐ。
- 品質率はすべて分子・分母・失敗caseIdを出す。
- 引用の採点は、モデルの引用が正解文の範囲内にあるかで見る。期間は精度・始点終点の有無・原文語句の一致で見る。暦の計算結果の数値はhostの責務のため照合しない。条件は種類（条件あり/なし）で見る。
- モデルの出力は抽出ドメインの`validateCandidates`で検査する。型・Scope・引用digest・host割当IDの検査を通らない出力は採用にならない。モデルが付けたid/scope/origin等は`FORBIDDEN_MODEL_FIELD`で却下される。

### 成功例だけで集計しない

分母は常にholdout全件。タイムアウト・不正JSON・providerエラー・harness失敗のサンプルは、保留recall・区分正解率・採用recall・遅延・timeout率に残る（失敗はmissとして数える）。サンプル欠落・重複・未知caseIdは「未完了」で不合格。受入には100件すべてにサンプルが必要。

### 版の履歴

| 版 | 内容 | 理由 |
| --- | --- | --- |
| `ext-v1`（退役） | データ`ext-ja-v1`、閾値`ext-threshold-v1`（precision・保留recall・区分正解率の3つと0許容違反） | — |
| `ext-v2`（現行） | データ`ext-ja-v2`、閾値`ext-threshold-v2` | 独立レビューの指摘2点。(1) holdoutがdevと独立でなかった（上記）。(2) 閾値が採用の網羅を見ておらず、失敗サンプルが採用precisionから消えるため、大半を沈黙・timeoutしたproviderが通りえた |

`ext-threshold-v2`は`v1`より**厳しくなる方向だけ**の変更で、緩めてはいない。`v1`の3つの閾値（いずれも19/20）と4つの0許容違反は不変で、採用recall >= 19/20を追加した。v1で不合格だった結果はv2でも不合格になる。評価版が変わったので、`ext-v1`の結果は`ext-v2`と比較しない。

## 記録するもの

モデルID・版・設定、プロンプト版（`--prompt-version`）、評価版・データ版とdigest・閾値版、入力bytes（モデルに見せるJSONのUTF-8、サンプルごと・合計・最大）、遅延のp50/p95（nearest-rank、全サンプル）、timeout件数と率、状態別件数（ok/invalid_output/timeout/error）、provider報告のtoken数（報告があるときだけ）、群ごとの合格件数。推論費用はproviderが`usage`を返すときだけ記録し、返さなければ「未報告」とする。

## コマンド

| 目的 | コマンド |
| --- | --- |
| harnessの試験（fixtureのみ。通常verifyに含まれる） | `bun test test/eval/extraction.test.ts` |
| fixtureでの端から端の確認（モデル結果ではない） | `bun run eval:extraction -- --fixture oracle`（他: `overconfident` `scope-leak` `bad-quote` `resurrection` `timeouts` `malformed`） |
| devでのprompt調整（Local Provider） | `bun run eval:extraction -- --split dev --provider-module <path> --prompt-version <id> [--show-failures]` |
| holdoutの受入評価（Local Provider） | `bun run eval:extraction -- --provider-module <path> --prompt-version <id> [--json <file>]` |
| データ生成（新しい版を作るときだけ） | `bun eval/extraction/generate.ts` → `bunx oxfmt --write eval/extraction/dataset.v2.json` |

- 既定は`--split holdout`（受入評価）。終了コード: 0＝実行完了かつholdoutで閾値充足（devは完了で0）、1＝閾値未達、2＝provider利用不可、3＝holdoutの監査ログ/結果ファイルを書けない、64＝引数誤り。
- 実モデルのproviderは、運用者が`--provider-module <path>`または環境変数`EUMENES_EVAL_EXTRACTION_PROVIDER`で明示した場合だけ使う。moduleは`createProvider()`を公開し、`info.kind === "local"`を宣言する。この評価harness自身はモデルクライアントを持たず、cloudを呼ばない。ただし「localである」という宣言はprovider moduleを供給する運用者/ホストの**自己申告**で、harnessは技術的に強制も検証もしない（宣言が`local`でないmoduleを拒否するだけ）。cloud向けproviderを`local`と偽って渡せば動いてしまうため、Local適格性（登録区分・転送契約）の確認はprovider側とホストの責務。`acceptance.eligible`もこの自己申告に基づく。
- providerが未設定・読込失敗・`local`未宣言・到達不能のときは、`not accepted: provider unavailable`を標準エラーに出して非ゼロで終了する。標準出力に数値を出さず、結果を捏造しない。
- 1要求の上限は既定30秒（`--timeout-ms`）、同時推論は1。timeout時はabort signalを送り、providerのpromiseが落ち着くまで（既定5秒の猶予`settleGraceMs`）次の件を始めない。signalを無視して猶予内に終わらないproviderは「放棄」として`abandonedProviderCalls`に数え、以降の件ではproviderを呼ばず`error`とする（2つの推論を同時に走らせないため）。放棄が1以上の実行はきれいな測定ではない。
- 通常のverifyはfixtureだけでrunnerとscoringを検査する。実モデルは明示した`eval:extraction`でだけ呼ばれる。

## 結果

### 決定的結果（fixture provider、holdout 100件、`ext-v2`）

fixtureはモデルではない。oracleは正解の再生、他は正解を壊した劣化版。遅延は模擬時計（oracleは決定的に p50=292ms / p95=477ms、timeoutsはtimeout予算30000msを含む）。`ext-v2`（データ`ext-ja-v2`、閾値`ext-threshold-v2`）で再実行した値。**この表はharnessの検証であり、モデルの結果ではない。**

| fixture | 採用precision | 保留recall | 区分正解率 | 採用recall（v2で閾値化） | 0許容違反（失敗件数） | 閾値判定 |
| --- | --- | --- | --- | --- | --- | --- |
| oracle | 66/66 | 34/34 | 30/30 | 66/66 | 0 | 充足 |
| overconfident（全部断定、曖昧名を推測） | 56/95 | 5/34 | 0/30 | 56/66 | 忘却後復活2、実測化20 | 未達 |
| scope-leak（Scope外idを参照） | 0/0（未定義） | 34/34 | 30/30 | 0/66 | Scope漏洩98 | 未達 |
| bad-quote（範囲外の引用） | 0/0（未定義） | 34/34 | 30/30 | 0/66 | 引用捏造66 | 未達 |
| resurrection（忘却した主張を採用） | 66/68 | 32/34 | 30/30 | 66/66 | 忘却後復活2 | 未達 |
| timeouts（4件に1件timeout） | 52/52 | 23/34 | 23/30 | 52/66 | 0（timeout 25/100、p95=30000ms） | 未達 |
| malformed（不正JSON） | 0/0（未定義） | 0/34 | 0/30 | 0/66 | 0（invalid_output 100） | 未達 |

追加の閾値試験（`ext-threshold-v2`の根拠）: 保留・区分は全件正解で、採用すべき件のうち伝聞10件と伝聞以外の3件だけに答え、残り53件を沈黙またはtimeoutにしたprovider。採用precisionは全問正解の100%、保留recall 34/34、区分30/30で、`ext-threshold-v1`なら通る。採用recallが13/66のため`ext-threshold-v2`では不合格（理由は`adoptRecall 13/66 below 19/20`だけ）。

### 実モデル結果（Local Provider）

| 項目 | 状態 |
| --- | --- |
| モデルID / 版 / 設定 | **未実施** |
| 採用precision（holdout 100件） | **未実施** |
| 適切な保留recall | **未実施** |
| 区分正解率 | **未実施** |
| 0許容違反 | **未実施** |
| p50 / p95 / timeout率 / 入力bytes | **未実施** |
| 採用recall（`ext-threshold-v2`で追加） | **未実施** |
| 判定 | **未受入**（Local Provider未接続。G5は未充足） |

実モデルの結果が得られたら、この表を別の行として追記する（fixtureの行と混ぜない）。受入には、100件holdoutでの全閾値（採用recallを含む）充足と0許容違反0件が必要。`ext-v1`の時点で得た結果は存在しない（実モデルは未実施）ため、v1からの移行で失われる結果はない。

## 制約と未決

- 本評価はWorld側のharnessであり、P4-02のqueue handler・P4-03の前景優先・P4-04の結果照合は含まない。結果照合を評価するケースはP4-04後に別版で追加する。
- 区分正解率の「ちょうど1種類」は厳格な定義で、複数の区分を出すモデルは不合格になる。基準の変更は新しい評価版で行う。
- 現データは各splitが5文型を2巡する構成で、語彙が小さい。holdoutの独立はentity・人名・数値・前置きを除いた文骨格の不一致で検査しており、語彙・意味の近さまでは保証しない（entity集合は両splitで共有する）。実モデルの結果が十分に難しくない場合は、新しい版で拡張する（旧版の結果と混ぜない）。
- 「local」はprovider供給者の自己申告で、harnessは検証しない（上記「コマンド」）。holdoutを見た回数の監査は追記ログに依存し、ログの改ざん防止は範囲外（運用者が版管理・保管する）。
- 実モデル評価では、プロンプトに述語語彙（`dataset.predicates`）と期間・条件の出力形式を含める必要がある。プロンプトの設計はホスト側の責務で、本票では固定しない。
