# Eumenes WorldModelの構造と接続設計

2026年10月9日。設計提案。API名、表、性能予算はこれから実装する案であり、既存APIとの区別は本文に記す。後続のP0でディレクトリとSQLite試験基盤を準備した。現在の実装範囲とコマンドは[実装計画書](implementation-plan.md)と[プロジェクト構造](project-structure.md)を優先する。

**WorldModelを独立したTypeScriptパッケージとして開発し、実行時はEumenesのbackendへ組み込む。** Memoryは原典と本人の記憶、Worldは根拠に基づく現在の理解と変化の見通し、Eumenesは目標・委任・実行を所有する。開発・配布の境界を分け、DB更新と回答採用の整合性は一つのホストで保つ。

目指すWorldModelは、エージェントが「今どうなっているか」「なぜ仕事に関係するか」「何を変えると何が変わりそうか」「何を確認すれば判断できるか」に答えるためのモデルである。根拠付きの主張、条件付きの影響関係、実行結果による再評価を組み合わせる。[SAAAの全体コンセプト第2・5・6・7章](https://chatgpt.com/space/page_9fc5877949748191b556705128f6a2f5)の五要素と所有境界を継承する。

## 1 開発可能性を維持する構成

SAAAでは、多くのドメインが一つのdesktop crateへ集まり、Tauri、音声、Provider、Memory、Tool実行などの変更・検証範囲が結び付いている。releaseのfat LTOに加え、build scriptはnative音声やsidecarの配置も担う。今回の静的調査だけで時間の寄与率は断定できないが、日常のWorld変更からdesktopのコンパイルを外す境界は必要である。[調査根拠](source-inspection.md)

| 選択肢 | 利点 | 負担 | 提案 |
|---|---|---|---|
| 独立TSパッケージを同じbackendへ組込み | 本体単独で試験でき、採用と保存を同じtransactionにできる | 同期処理の上限と依存方向を厳格にする必要がある | 初期から採用 |
| World専用HTTPサービスとDB | プロセスの障害・配備を分けられる | 分散した失効、再検証、忘却、二重書込みの設計が増える | 遠隔利用などの具体的必要が出た時点で判断 |
| SAAA Rustコアのbinding | 検証済み意味論の再利用候補になる | 配布対象、binding、型変換、ビルド経路が増える | 最初は規則とfixtureを継承。性能不足の演算だけ後で比較 |
| 専用Graph DB | 大規模探索の選択肢になる | 新しい運用・整合性境界を持つ | SQLiteで不足を測定した後の候補 |

TypeScriptへの変更だけで高速化を保証しない。本体の試験がEumenes、React、音声、LARM実接続を要求しないことを受入条件にする。SAAAのRustソースをruntime依存にせず、移植した規則と変更した意味論をfixtureで比較する。独立したRustコア自体が重いと認定したわけではない。

```text
Code/
  eumenes/                 製品ホスト、会話、推論、実行、認可、画面
  eumenes_memory/          Records、Recall、本人State、抽出、忘却
  eumenes_world_model/     World固有の主張と遷移、投影、探索、予測評価
  SAAA/                    参照元

eumenes_world_model/
  src/
    index.ts               純粋APIの公開入口
    sqlite.ts              同期永続APIの公開入口
    contracts/             World固有の型と契約版
    domains/               identity、assertions、conditions、projection、
                           reasoning、scenarios、extraction、lifecycle
      <domain>/            index.ts、sqlite.ts、contracts、service、repository、test
    infrastructure/sqlite/ 借りた接続型とmigration順序の集約
  fixtures/                言語非依存の入力と期待結果
  test/                    純粋、実SQLite、配布物consumer試験
  eval/                    日本語抽出、回答品質、実モデル比較
  scripts/                 検証、配布、依存境界、性能計測
  spec/                    設計と契約
```

一つのpackageから始め、機能ごとにpackageやサービスを増やさない。純粋層はIO・SQL・モデルを呼ばず、時刻とIDを引数で受け取る。各domainのrepositoryは純粋層を利用できるが、逆向きの参照は禁止する。大きな共通barrelから全実装を相互参照しない。

開発はTSソースで直接試験する。正式配布はESM JavaScriptと型宣言を含む`eumenes-world-model-<version>.tgz`に固定し、consumerが本体ソースの型検査まで引き受けない形にする。Eumenesは`vendor/eumenes-world-model/`に配布物とmanifestを保持し、version、SHA-256、source revision、契約版、DB schema版、検証結果を記録する。隣接checkoutのHEADへ恒久依存しない。

型境界に必要なSourceRefやAccessContextはMemoryの公開型を再利用する。Memory内部へのimportや共通型の手書きコピーはしない。ただし現行MemoryはTSソースをexportするため、Worldの配布だけで依存全体の型検査を隔離できたとは言えない。Memoryの型を使う範囲を測り、正式接続までに薄い型宣言の公開口または配布時の型宣言を整える。巨大な共通基盤packageは作らない。型宣言・依存グラフで検査範囲を分ける考え方は[TypeScript公式資料](https://www.typescriptlang.org/docs/handbook/project-references.html)を参照する。

## 2 正本と責務

| 所有者 | 正本 | Worldからの扱い |
|---|---|---|
| Eumenes conversation | 確定発言、発言者、原文版 | SourceRefで参照。途中ASRを事実にしない |
| Memory Records | 取り込んだ資料・Tool結果の本文と版 | 引用位置と取得状態を持つ参照 |
| Memory State | 本人の好み、習慣、個人情報、明示制約 | 元itemの版を参照する投影。Worldで上書きしない |
| World assertions | World固有の状態・関係の主張、採用判断、訂正、反証 | 意味解釈の台帳。現実や原典そのものの正本ではない |
| World projection | 検索用の対象・状態・edge・Focus | assertionsと参照元から再構築可能 |
| EumenesのGoalと委任 | 採用された目標、許可操作、期限、予算 | GoalRef。推定した目標は提案に留める |
| Eumenes queueとTask実行台帳 | attempt、lease、取消、実行結果、検証 | 版付きRuntimeRef。LLMが成功状態を作らない |
| Capability Registry | Toolの版、適格性、利用条件 | 能力の関連を示す参照。実行直前の照合はRegistry側 |
| ContextStill | 再利用知識、Episode | 公開契約で取得。永続根拠の要件不足なら一時参考 |
| Eumenes Context Broker | 今回提示する情報と共通予算 | MemoryViewとWorldSliceを合成。新しい長期正本を作らない |

SAAAのPersonal Stateという論理的責務を、本人の主張はMemory、World固有の主張はWorldへ分担する。**Worldが独自の主張履歴を持つことと、Memoryの同じ事実を二重管理することを区別する。** Memoryには現在World関係を格納する契約がないため、汎用`personal_fact`へedgeを押し込まない。

World固有の主張とは、例えば「この構成ではキャッシュが応答遅延を減らす」という解釈である。ユーザーがこれを訂正した場合は、確定した訂正発言を出典にWorldの主張を更新する。「ユーザーは短い返答を好む」はMemory側へ渡す。派生グラフを直接編集して履歴を失わない。

### 現行Eumenesに不足する正本

既存のMemory接続計画はContinuityを前提にしているが、現在のEumenesでは削除済みである。コード上のretired migrationも確認できる。従って`ContinuityStateAdapter`を既存機能として接続する案は採らない。

Eumenesに最小の`goals`ドメインを新設する案を置く。採用された目標、主体、対象Scope、望む状態、優先度、状態、source、revisionを所有する。委任権限と具体的Taskは後続の`work`等の実行所有者が持つ。初期World単独試験ではGoalSnapshotのfixtureを使えるが、製品で目標を踏まえた回答を成立させるにはこの公開口が必要である。旧Continuityのテーブルを自動的に復活・移管しない。

## 3 WorldModelの情報構造

中心は、**対象、根拠付き主張、時間と条件、変化の関係、判断用の切り出し**である。グラフはこの情報を読むための表現とする。

| 構成要素 | 主な内容 | 例 |
|---|---|---|
| Entity | 安定ID、kind、Scope、明示alias、外部参照 | Project、Actor、Service、Resource、Artifact、Metric、Concept、Action、GoalRef |
| Assertion | 主語、述語、型付き値または関係、根拠、期間、採用状態 | `service.available = true`という観測付き主張 |
| Evidence | source、版、digest、引用範囲、発言者、来歴、支持・反証 | 計測結果、本人の報告、資料の記述 |
| ConditionSet | 条件式、対象・構成・期間、解釈できた範囲 | 同一モデル、warm cache、同じ入力長 |
| Relation | 因果作用、依存、相関、構造、目標への寄与 | `cache --decreases--> latency` |
| Prediction | 介入、比較基準、期待する変化、評価期限 | cache導入前後でp95が減るという仮説 |
| OutcomeAssessment | 実観測、比較条件、支持・反証・比較不能 | 入力長が変わったため効果を断定できない |
| Focus | 現在のTask、明示関心、一時注目と終了条件 | 今回の音声遅延改善 |
| WorldSlice | 今回の判断に必要な構造と根拠manifest | 関係する状態、経路、条件、不足、参照版 |

Actionは能力や介入内容を表す対象であり、実行jobではない。GoalRefは望む状態の参照であり、Worldが実行目標を勝手に作る口ではない。全EntityをLLMの自由名で作らず、ホストのProject ID・resource ID・Task IDを優先する。同名だけの統合はせず、候補が複数なら未解決のまま返す。統合は履歴付きの可逆操作とし、誤統合から分離できるようにする。

### 主張の基本形

各主張は少なくとも次の属性を持つ。

```text
Assertion
  id / revision / principal / scopeKey
  subjectId / predicate / typedValue または relationPayload
  evidence[] / rootEvidenceIds[] / derivationInputManifest
  origin: runtime_observation | user_report | document_claim | model_hypothesis
  lifecycle: candidate | active | disputed | superseded | retracted | invalidated
  observedAt / recordedAt / validTime / freshnessPolicy
  supersedes[] / contradicts[] / interpretationVersion
```

`active`は利用対象に採用されたという意味で、真実の証明ではない。根拠の種類、採用状態、現在性、評価結果を別の軸で返す。`fresh / stale / unknown`をlifecycleへ詰め込まない。現実が未知であることと、検索できなかったことも分ける。

本人の発言は「本人がそう報告した」根拠である。資料の説明を実測へ、assistantの要約を新しい観測へ昇格させない。同じ原典の要約・転載・再抽出はrootEvidenceIdでまとめる。ただしrootが違うだけで統計的独立性まで保証せず、同じ実験・転載系列などの依存も保持する。根拠数やLLMのconfidenceだけで因果を確定しない。

World固有の明示訂正は、対象とScopeが確定していればモデル待ちをせず旧主張の利用を止める。対象解決が曖昧なら候補を示し、その主張を必須にする判断は保留する。新しい訂正を古い会話のバックフィルで上書きしない。

### 時間と条件

現実に成立した期間`validTime`とシステムが知った時刻`recordedAt`を分ける。「9月から利用」のような表現は月単位の精度を保持し、架空の開始日を作らない。現在照会と「当時どう理解していたか」の照会を分ける。後者も現在の忘却・認可を必ず適用する。

条件は型付きの比較と`all / any / not`から成る深さ・件数制限付きの式にする。値の単位、観測時点、鮮度を検査し、`satisfied / violated / unknown`の三値で評価する。未知の否定は未知、ANDに偽があれば偽、ORに真があれば真とする。矛盾する観測はunknownにし、理由を返す。表現できない複合条件は原文参照付きで保留する。

条件未記述を「無条件で成立」とは解釈しない。SAAAでは条件配列が空ならunknownになる。これを継承し、明示的な無条件主張を扱うなら`conditionMode: explicitly_unconditional`と採用根拠を別に設ける。Scope・期間・版・認可の検査は無条件主張でも省略しない。

### 五要素の扱い

| 要素 | 表現と推論規則 |
|---|---|
| 因果と影響 | increases、decreases、causes、enables、inhibits。介入内容・比較・機構・成立条件を持つ。増減の合成は比較可能な指標・条件に限定する |
| 目標 | GoalRefとserves_goal。目標の採用・完了・撤回はホストが決める |
| 条件 | 状態・関係・予測へ付属するConditionSet。独立edgeへ平坦化しない |
| 相関 | 対称関係、正負、対象集団、期間、測定方法。因果探索では伝播させない |
| 依存 | 必要な前提とavailable・unavailable・unknown。必要条件が満たされても成功を保証しない |

補助関係のrelated_to、part_of、important_forは関連の説明に使い、因果伝播には混ぜない。因果探索、関連探索、依存確認を別の操作として実装する。逆向き探索は原因候補の発見に使えても、関係の向きを逆転させない。ループは訪問済み検査と上限で止め、feedbackを無限に合成しない。

## 4 エージェントへ返す理解と予測

Worldは、任意の仕事を代行するPlannerを内蔵せず、Plannerと会話に使える判断材料を返す。

| 問い | 提案する純粋API | 返す内容 |
|---|---|---|
| 今どうなっているか | `buildWorldSlice` | 対象、状態、期間、現在性、根拠、不足 |
| なぜ今回の仕事に関係するか | `explainRelevance` | Goal・依存・構造を含む関連経路 |
| 何が妨げているか | `checkDependencies` | 未充足・未知の前提、確認先 |
| この変更で何に影響するか | `traceInfluence` | 条件付き因果経路、潜在的方向、反証 |
| AとBを試すと何が違いそうか | `compareScenarios` | 仮定ごとの予測、差、不明点、必要な測定 |
| 予測は実際に成立したか | `assessOutcome` | 同条件比較の支持、反証、mixed、比較不能 |
| 次に何を調べるか | `findResearchGaps` | 判断を変え得る不足と確認候補 |

すべてschemaと上限を持つ。照会中にLLM、ネットワーク、永続書込みを行わない。LLMが曖昧な質問を構造化要求へ変える部分はホスト側で検査する。最初から全APIをモデルのToolとして常時提示する必要はない。

### WorldSlice

Sliceは`asOf`、Scope、GoalRef、採用したassertionとsourceの版、投影版、policy版、忘却epoch、提示digest、完全性を持つ。関係ごとに条件、仮説表示、根拠を一緒に返す。共通Context Brokerが予算を配分し、説明単位で省略する。条件や反証だけ落として結論を残さない。

初期の探索上限候補はSAAAに合わせ、因果深さ3、関連深さ4、30対象、60関係、10経路、候補取得500行、展開500回、提示8KiBとする。これは上限案であって速度保証ではない。SQL取得、証拠展開、並べ替えにも上限を設ける。ホストの残予算が小さければさらに縮める。

結果は`ready / partial / blocked / overflow / disabled`を区別する。探索打切り、未知、原典欠落、未処理変更を理由コードで示す。認可外情報は名称や件数も漏らさず、判断に必要な条件が許可範囲で揃うかだけを示す。完全探索でない「経路なし」を「影響なし」に変えない。

任意の関連情報だけが不足する場合はpartialを使える。明示訂正・必須制約・対象版が検査できない場合はblockedとし、その情報に依存する回答・行動を止める。Worldを必要としない通常会話はホストが別要求として続けられる。blockedを黙ってWorldなしの成功へ読み替えない。

### 予測と仮定の比較

一般目的エージェントには、まず条件付きの定性的な変化モデルが適する。例えば次のように扱う。

```text
目標: 音声応答の待ち時間を減らす
介入候補: プロンプトcacheを有効化する
機構仮説: 再利用できるprefixのprefill処理量が減る
条件: 同一モデルとprefix、warm cache、対応するProvider
予測: 最初の応答までの時間が減る可能性
依存: Providerのcache機能と測定可能なusage
不足: cold/warm、入力長、混雑を揃えた比較
結論: 改善候補であり、この環境での短縮量は未確認
```

後から「平均が短くなった」という観測が来ても、構成・入力長・比較基準が違えば比較不能として残す。変更前後を比べただけで他要因が排除されたとは扱わない。結果は`comparisonId`、metric、unit、対象、条件、baseline、観測期間を照合する。

`compareScenarios`は、保存済みの世界を変更せず、一時overlayに介入と仮定を置く。出力は「これらの仮定の下での見通し」である。効果量や成功確率をedgeのconfidenceから掛け算しない。定量モデルが必要な領域は、後から版付きの専用モデルを同じEvidence・Outcome契約へ接続する。学習済み潜在モデルや普遍的なシミュレーターを初期必須にしない。

ResearchGapはmissing_condition、missing_measurement、missing_mechanism、conflicting_evidence等を返す。優先度は現在Goalの阻害、判断への影響、確認費用、期限から決め、根拠のない期待効用値を作らない。Gapは調査候補であり、実行許可ではない。Task側で安定キーを使い重複を抑える。

## 5 Eumenesへの具体的な接続

```text
Web / CLI
    │ HTTP / SSE
Eumenes application
    ├─ conversation / goals / Task / settings
    ├─ inference / LARM
    ├─ queue / scheduler
    ├─ memory adapter ── eumenes-memory
    ├─ world adapter  ── eumenes-world-model
    └─ Context Broker ── MemoryView + WorldSlice → dialogue
              │
       EumenesのSQLite単一Writer
       conversation等 / memory_* / world_*
```

提案する`api/domains/world`は、SourceAdapter、MemoryAdapter、GoalAdapter、queue handler、利用側の結合試験を置く薄い接続層とする。Worldの意味判断やWorld表のSQLを複製しない。lower domainからdialogueを参照させず、applicationで組み立てた依存を注入する。独立World packageからEumenesをimportしない。

Worldの永続APIは`eumenes-world-model/sqlite`で公開し、ホストから借りた接続を使う同期関数にする。DBを開かず、transactionを開始・確定せず、他ドメインの表をSQLで読まない。ホストは公開操作を同じ接続上で順に呼ぶ。WALの別readerは古いsnapshotを読めるため、採用時に別readerで再検証してからwriterへ保存する方法では不十分である。[SQLite公式の分離性の説明](https://www.sqlite.org/isolation.html)

### 更新の流れ

1. 確定した会話、Records、Memory State、Runtimeの変更をホストが受け、source ID・版・Scope・発言者を確定する。
2. 訂正・撤回・忘却による失効を決定的に反映する。抽出jobの待ち行列を待たない。
3. 永続inboxへ変更を受領し、受付cursorを進める。意味処理の適用checkpointは別にする。保留中の抽出が後続の削除を塞がない。
4. queueのprepare transactionで入力manifest、対象版、必要な既存状態を固定し、そのmanifestをMemoryの外部依存へ登録する。登録成功前にモデルへ送信しない。実行中の入力も忘却閉包へ入れる。
5. transaction外でLocal推論を行い、候補だけを返させる。ID・認可・source・時刻をモデルに発行させない。
6. settle transactionでattempt、取消、入力版、引用、Scope、条件、意味型、重複を検査する。
7. Worldの主張・遷移・投影・依存登録・処理checkpointを同時に確定する。操作の返り値がrejected等なら成功扱いせずrollbackする。

モデルは必要なときだけ使う。構造化された計測・状態変化は決定的Adapterで処理できる。同一operation key・同一payloadはno-op、同一key・異なるpayloadは競合として拒否する。再起動後は実行台帳とcheckpointから再開し、古い結果を採用しない。

### Memoryの既存接続口

`listMemoryChanges`、`registerExternalDependents`、`recordExternalDeletion`はMemory側の既存APIである。これをWorld専用APIへ改造せず、ホストが仲介する。[現行契約](../../eumenes_memory/src/contracts/external.ts)

- 変更フィードはID・版・状態だけを通知する。本文は公開APIから読み、cursorはprincipal・Scope集合・復元epochごとに管理する。Scopeを追加した場合も再同期する。
- 現行フィードの`source`はhost_sourceの忘却通知だけで、通常の会話追加・訂正を網羅しない。conversationとRuntimeにはホスト側の永続イベント／outboxとSourceAdapterを追加する必要がある。
- `providerRef`は例えば`eumenes-world`とし、推論Provider名と分離する。`externalId`にはWorldの主張版や入力manifestの安定IDを使う。登録は置換なので、過去版の依存を新版で上書きしない。
- 引用されたsourceだけでなく、抽出時に見せたsourceとstateも依存へ含める。根拠の支持関係と、忘却の対象になる入力依存は別に保存する。
- 現行登録は1派生物あたり最大32依存。上限超過を切り捨てず、入力窓を意味単位で分けるか保留する。多数の依存を隠す不透明なmanifest IDだけの登録はしない。
- 現行APIはsourceの所有Scopeを検査しないため、ホストの公開SourceAdapterで形式・所有者・Scope・現行版を検証してから登録する。

### 回答の生成と採用

現行`dialogue`の`prepareInTransaction / execute / settleInTransaction`を接続点にする。

prepareで同じ接続から必要なMemory・World・Goalのsnapshotを取得し、Brokerが予算付きContextと依存manifestを固定する。executeの直前にもsourceの現行版・失効と送信許可を検査し、外部送信を含めた実際のProviderへ許可された情報だけを渡す。失効処理は該当する実行へ取消を通知するが、既に送信した内容の回収は保証しない。World文面は参照データとして渡し、system命令・ユーザーの現在指示へ昇格させない。

settleでは同じwriter transaction内でsource、必須状態、WorldSlice、policy、forget epoch、queueのattempt・lease・取消、推論receiptを再検証する。成功した回答とUsageReceiptを一緒に保存する。UsageReceiptには採用したslice digest、source/claimの版、package版、契約版、run/attempt、Provider参照を結び付ける。秘密や本文を通常ログへ出さない。

全World revisionだけで無関係な変更まで全回答を無効化しないよう、必要な主張・sourceとscope別の投影epochを追跡する。ただし追加の反証や新しい前提を見落とさないため、取得集合の変更を検知するscope/query epochも必要になる。初期はScope単位の保守的な無効化を許し、偽の失効が問題になった後に細分化する。

現行Eumenesは`delta`で途中本文を公開し、先行TTSへつなぐ。そのまま接続すると、最後に失効を検知しても既に読み上げた情報を取り戻せない。**最初のWorld利用回答は採用成功まで内容の公開・TTSを保留する。** 一般会話の速度と分けて計測し、後続で区切りごとの利用許可・公開receipt・送信直前検査を実装した場合だけ先行公開を解禁する。取消後の未公開chunkは破棄するが、公開済み情報の撤回を保証しない。

## 6 永続化と忘却

World表は次の論理グループで構成する。後続の[詳細実装契約](plan/contracts.md) C7で初版の所有表を具体化した。以下の表候補と異なる場合はC7を優先し、物理DDLはP2-01で固定する。

| 表の候補 | 内容 |
|---|---|
| `world_entity`、`world_alias` | 対象ID、型、Scope、aliasの根拠と履歴 |
| `world_assertion`、`world_transition` | World固有の主張版、採否、訂正、競合 |
| `world_evidence`、`world_input_dependency` | 支持・反証、root lineage、入力全体への依存 |
| `world_condition`、`world_prediction`、`world_outcome` | 条件式、予測、比較と結果評価 |
| `world_current`、`world_edge` | 読取り投影とscope別epoch |
| `world_inbox`、`world_checkpoint` | 受領済み変更、適用進捗、入力manifest |
| `world_tombstone`、`world_schema_info` | 再出現防止、schema版とmigration hash |

queueのjob、lease、再試行台帳をWorld表へ再実装しない。Worldが保存するのは意味処理の段階とcheckpointである。source本文や会話全体も複製しない。短い引用・派生説明を保持する場合はpayloadとして明示し、忘却対象に含める。

初期索引はprincipal・scope・subject・predicate・status・validTime、edgeの両端、sourceから派生物への逆引きに置く。構造化ID検索と限定した隣接探索で始め、全文・意味検索を全World照会の前提にしない。取得上限だけでなくquery planと読取り行数を検証する。

### 忘却と復元の順序

忘却はMemory OFF・World OFF・モデル不在でも動く。受付後はホストが対象依存の新規利用を止め、最新ジャーナルの耐久保存とDB適用を直列化する。同じwriter transactionでMemoryのforget適用、Worldの依存閉包の消去と墓標、公開投影の失効、外部削除receiptの確定を行う。削除成功を確認してから`recordExternalDeletion`へ必ず対象externalId付きでconfirmedを渡す。失敗時はpendingを残し、そのWorldデータは公開しない。

Memory側の現行契約には、外部依存辺が忘却ジャーナルへ載らない制約がある。起動・復元時はWorldの利用を閉じたまま、保持されているWorld manifestから外部依存を再登録し、最新のMemoryジャーナルを照合し、World側も全依存の墓標・現行版を確認する。再登録がTOMBSTONEDで拒否された派生物は直ちに失効・消去する。完了後に投影を再構築して公開する。

DB復元では変更seqが巻き戻り得る。`feedResyncRequired`だけに頼らず、ホストがrestore epochを変え、Memory・会話のcursorとWorldのcacheを破棄して再同期する。World/Memoryを別々のDB backupから戻す運用は初期構成に含めない。新しい復元世代で全依存を照合できない場合は公開を再開しない。

World固有の主張だけを忘れる操作にも、DB外の最新忘却記録とscope付き不透明IDをホストに保存させる必要がある。Memoryの内部journal schemaへ無断で追加せず、ホストの復元手順で両方を照合する。忘却操作IDは一つとし、関連する両journalの耐久化・DB適用が完了するまでホストの受付台帳をpendingに保つ。途中crash後は同じ操作IDで不足段階を再実行し、すべての照合が終わるまで対象を公開しない。意味的に同じ主張の再学習を止めたい要求は、ID単位の墓標とは別に対象・期間・source集合を確定した抑止規則として扱う。現行MemoryのID墓標だけで意味的再出現まで防げるとはしない。

管理下の検索・投影・説明・候補・scenario・利用中viewを消去対象にする。OS snapshot、既に送信した内容、管理外のexport、SSDの物理消去とは保証範囲を分ける。切り戻しで最新の墓標や権限撤回を戻さない。

## 7 背景保守と全体エージェントの接続

保守の起動契機は新しい確定情報、訂正、結果、期限切れ、再接続とする。無入力・無変更時に新しいモデル要求を作らない。queueの低優先度jobとして動かし、会話・ASR・TTSが資源を必要としたら譲る。Localモデルのみを使い、自動Cloud fallbackを禁止する。LANアドレスだけでLocal適格と判定せず、登録区分と転送契約を確認する。

SAAAの30秒以内のjob段階、12発言または32KiB、候補8件、同時推論1は比較開始値として使える。foregroundの占有率、最古待機、cancel確認を測って調整する。静穏待ち時間でASRを遮断しない。取消未確認の枠を再利用せず、遅着結果は元attemptと入力版を検証する。

全体の循環は次の分担で閉じる。

```text
確定情報 → MemoryとWorldの更新
         → WorldSliceで目標との差・影響・不足を説明
         → Eumenesが委任と予算に照らして仕事を選ぶ
         → Capability / 実装エージェントで実行
         → 専用台帳の検証済み結果を観測
         → Worldが予測と結果を照合
         → Eumenesが通知時刻と方法を決める
```

Situationは現在の会議・集中等の期限付き観測をWorldへ渡せるが、通知の許可と方法はEumenes側に残す。Worldが「集中していそう」と推測して明示通知設定を変更しない。Toolchainは不足能力を実装・検証・登録する別責務で、Worldは利用目的と依存・結果の関係を支える。

ハーネス自己改善には、失敗の条件・予測との違い・実際の結果を渡す。World内の仮説を評価正解として自己採点する閉路を作らない。評価器、候補、採否は別の版と台帳にする。これにより長期Memory、Personal World、Toolchain、自己改善という中核目標を維持しつつ、各部の開発を分ける。

## 8 実装順と受入

最初から全体の意味と境界を定め、機能ごとに「実装」「fixture」「実SQL」「ホスト結合」「実モデル」「実運用」の到達点を記録する。初期の限定実証を最終機能の縮小にしない。

| 段階 | 作るもの | 終了条件 |
|---|---|---|
| W0 契約と意味論 | 五要素、主張、条件、時間、Scope、Slice、非IOコア、言語非依存fixture | 相関混入、条件不明、逆因果、同名別対象、同根拠重複を拒否。未知契約版を拒否 |
| W1 永続化と失効 | 主張・遷移・投影、同期SQL、依存manifest、訂正と忘却、復元 | 実SQLiteでrollback、再送、応答喪失、古いDB復元、Memory OFF時の忘却を確認 |
| W2 最初の製品接続 | 正式tarball、world adapter、SourceAdapter、Goal公開口、Context Broker、回答採用 | 一つのScopeで登録→質問→訂正→再質問→忘却を通す。生成中の訂正を回答・TTSへ出さない |
| W3 継続構築 | Local抽出、永続inbox、checkpoint、queue、結果照合 | 日本語の否定・仮定・伝聞・多条件を評価。重複・取消・再起動・前景復帰が成立 |
| W4 判断支援 | 関連・因果・依存の製品接続、Gap、scenario比較、訂正画面 | 実際の一つの改善仕事で、候補→確認→実測結果→再評価を閉じる |
| W5 全体の実証 | ContextStill、Toolchain、複数Scope、長期運用、自己改善への証拠 | 個別の外部契約と受入を通し、無許可操作・削除後復活なく有用性を示す |

W0から五要素の構造と推論規則を持ち、W4で初めて因果の設計を始めるわけではない。W2は自動抽出を待たず、明示された構造化主張と実測fixtureを使ってホスト境界を検証できる。UIは最初に根拠付き一覧・詳細・訂正を作り、大きなグラフ表示は後から追加する。

### 必須の試験シナリオ

1. 同名対象がProject A/Bにある場合、誤統合・Scope漏洩を起こさない。
2. 同じ発言の要約が10件あっても独立根拠や確かさを増やさない。
3. 条件不明、条件矛盾、stale観測、単位不一致を有効な因果説明にしない。
4. 相関、目標、依存、逆向きのedgeを因果効果へ混ぜない。上限到達と経路なしを区別する。
5. 同条件の反証と、条件が異なる共存可能な結果を分ける。ユーザー報告を実測にしない。
6. 生成・抽出中の訂正、forget、認可取消、attempt更新を、採用transactionで検知する。
7. World保存後にMemory依存登録が失敗した場合、Worldを含む変更全体がrollbackする。
8. commit直後の応答喪失と再実行で重複主張・jobを作らない。
9. 最新忘却journalと古いDB、巻き戻ったcursor、未登録の外部依存を組み合わせても公開前に再照合する。
10. モデルが止まっていても訂正・忘却が反映される。保留jobが後続の失効を塞がない。
11. World回答の採用失敗時、途中本文・TTS・派生結果が完成扱いで公開されない。
12. 無入力・無変更で新しいLLM呼出し0、foreground開始で背景が資源を譲り、未完了は再開する。

### 検証範囲と性能の測り方

本体には`bun run verify -- --domain conditions`の領域選択と`bun run verify:all`を用意する。P0ではdomain試験0件を失敗とし、型検査などの共通検証は本体全体へ適用する。公開契約・schema・忘却・配布を変更した場合は本体全体と配布物consumer試験を通す。Eumenes側では登録後の`bun run verify -- --domain world`に加え、利用側のdialogue、voice-dialogue、queueと横断`verify:all`を行う。Eumenes側のworld domainとその検証はまだ存在しない。本体の最新配置・検証仕様は[プロジェクト構造](project-structure.md)を正本とする。

性能は同じマシン・同じfixture・同じ変更でcold/warmを分け、日常の一箇所変更→対象verifyまで、package更新→Eumenes利用側verifyまでの時間、読んだ型ファイル数、最大RSSを記録する。本体単独のverifyがEumenes/Tauriを読まないことを機械検査する。

World照会は1千・1万・10万主張と高分岐・循環ケースでp50/p95、SQL行数、展開数、RSS、出力bytesを測る。仮の運用予算は、代表1万主張でSlice p95 50ms以内、短いwriter処理20ms以内、背景ON時の会話p95悪化5%以内とする。機材・baselineを固定してから採用値を決め、現在の達成値とは扱わない。上限不足時は処理量を分割し、イベントループを長時間占有しない。

意味品質は同じ仕事を「Memoryのみ」「Memoryと関連検索」「Memoryと条件付きWorld」で比較する。正しい根拠、条件の維持、不明時の保留、目標への寄与、訂正負荷、入力量、待ち時間を測る。Scope漏洩、忘却後復活、相関の因果化、権限拡大は平均点で相殺せず失敗にする。評価用データを抽出promptの調整用データから分け、実モデル評価とfixture成功を混同しない。

## 9 着手前に固定する接続契約

優先して決めるのは、ホストのGoalSnapshot、sourceの版と変更イベント、配布時のMemory共通型、忘却・復元手順、World利用回答の公開境界である。これらは周辺の細部ではなく、Worldの理解を実際の応答へ安全に使うための入口になる。

本設計ではEumenesとMemoryの現行コード、製品DB、設定、旧SAAAの保存状態を変更していない。旧SAAAデータの移行は別工程とし、まず合成fixtureと新しい明示入力で循環を成立させる。移行時は原典・版・Scope・墓標が再現できるデータだけを検証付きで取り込み、旧グラフを無検査でactiveにしない。
