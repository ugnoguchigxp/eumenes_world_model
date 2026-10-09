# World意味品質の比較評価（P5-04 / A50）

Worldを使うと判断の質が上がるかを、固定仕事・事前rubric・4条件（Memoryのみ／関連原典／plain-facts対照／World）で比較する基盤の仕様。実装は`eval/decision/`、試験は`test/eval/decision.test.ts`。

## 到達状態（混同しない）

| 区分 | 状態 |
| --- | --- |
| 構造・harness・rubric・採点・レポート | 実装済み |
| fixture provider による端から端の試験 | 実施済み（下記の結果） |
| 実モデル（local）での20仕事×4条件（A50の3条件+plain-facts対照）の実行 | **未実施・未受入**。G5は未充足、P5は未受入 |
| 実機・ホスト結合 | 本票の範囲外 |

fixture結果はharnessが基準どおり動くことの証拠であり、Worldの有用性の証拠ではない。実モデルの結果が得られるまで、有用性の主張はしない。

## この評価で「合格」が意味しないこと（必読）

- **World主張はv1では手書き**: 20仕事すべてで、World主張の主張文・条件文・置換元(`supersedes`)・保留条件(`holdUntil`)は人が書いた。純粋層はMemory原典からこれらを導出できない（`ConditionSpec`は構造化observationだけを評価し、仕事は構造化observationを持たない）。したがって「Memory原典からWorldが主張を作れる」ことは本評価で未検証。
- **rubricの語句は主張文と同じ人が書いた**: 必要条件の語句は手書き主張文の語句と重なる。主張文を写すだけの読み手（restate-only fixture）が評価15件中12件で「改善」になる。これは**文脈をコピーするだけで届く天井**であり、Worldが役立つ証拠ではない。
- **だから対照を置く**: `memory-plain-facts`は同じ主張文と同じ原典を、条件・置換・保留・根拠一覧の枠組み抜きで平文として渡す。Memoryのみに対する改善（チケットのゲート）が出ても、**plain-factsに対する差が無い限りWorldの枠組みが効いたとは言わない**。
- **実モデルでplain-factsに対する差が測れるまで、passはWorldの有用性の証拠ではない**。fixtureのplain-facts対照は、fixtureがWorldの枠組み（置換・保留）を機械的に使うため差が出るだけで、枠組みの効果を示さない。

## 仕事と分割

- 合成日本語の固定20仕事（D01〜D20）。調整用(tuning)5件（D01〜D05）、評価用(evaluation)15件（D06〜D20）。
- 型: 条件限定（Memoryの無条件主張をWorldが条件付きに置換）、保留（条件未確認・古い根拠）、因果誤認の防止（同時期の別要因）、対照（Memoryで足りる、Worldは無関係）。
- tuningモードは調整用5件だけを読み込む。評価用ファイルは`evaluation`モードでのみ動的に読み込む。tuningモードのprovider要求・JSON・Markdownに評価用の仕事ID・質問・本文は含まれない。runnerもtuningモードに評価用の仕事が渡されると失敗する。
- evaluationモードは全20仕事の出力を保存する（A50の20仕事×3条件に、対照のplain-factsを加えた4条件）。ただし**改善数は評価用15件のみで数える**（調整に使った5件での改善は参考値）。悪化と安全上の失敗は全20件で数える。

## 4条件

同じモデル・入力予算・seed・temperatureで実行する。設定は1回だけ決め、全要求で同一値を渡し、レポートに保存する。

| 条件 | 文脈 |
| --- | --- |
| memory-only | Memoryの原典のみ |
| memory-related | Memory + 関連原典 |
| memory-plain-facts（対照） | Memory + World主張と**同じ主張文**を平文の事実として + World条件と同じ根拠原典。条件・置換元・保留条件・根拠一覧は付けない |
| memory-world | Memory + 条件付きWorld主張 + その主張が根拠に挙げる関連原典（主張を原典まで追えるように） |

### Worldの主張の作り方

memory-worldの主張は、assertion記録（Scope、根拠source、鮮度方針を持つ台帳形）に起こして公開barrelの`buildWorldSlice`（`src/index.ts`）に通し、返った`ready`のslice unitを提示する（`eval/decision/world-pipeline.ts`）。記録が棄却される・sliceが`ready`でない・主張がsliceから落ちる場合は、手書きの文へ黙って戻さず、そのWorldセルを`error`（比較不能）にする。sliceのdigestはレポートの`worldAuthoring.sliceDigests`に仕事ごとに保存する。

実際に純粋層を通るのは検証・Scope・source状態・鮮度・提示予算であり、**主張文・条件文・置換元・保留条件は手書き**（`worldAuthoring.handAuthored`に明記。20仕事すべて）。構造化した条件の評価（`evaluateConditions`）は、仕事が構造化observationを持たないため使っていない。

入力予算は質問+文脈のtoken推定値（文字数/2、tokenizer非依存）で測り、超える場合は末尾の項目を落として落とした項目IDを保存する。World主張は`conditions`（成立条件）、`evidence`（根拠ID）、`supersedes`（条件付きに置換するMemory項目）、`holdUntil`（保留条件）を持つ。

## 事前rubric（4軸、各0/1）

rubricは仕事ごとに実行前に定義し、sha256 digestで凍結する（`eval/decision/tasks.ts`の`FROZEN_DIGESTS`）。rubricまたは入力を後から変えるとdigestが変わり、読み込みが失敗する。変更する場合は理由を残してdigestを更新する。

| 軸 | 1点の条件 |
| --- | --- |
| 根拠(grounding) | 必要な引用IDがすべてあり、文脈に無いIDを引用していない |
| 必要条件(requiredConditions) | 必要条件の各グループについて、いずれかの語句が回答にある |
| 適切な保留(appropriateHold) | 保留すべき仕事では保留し、不要な仕事では保留しない |
| 禁止断定(forbiddenAssertions) | 禁止語句（無条件断定、因果誤認、Scope外の内容）と禁止引用（Scope外原典`<仕事ID>-x1`）が無い。禁止語句は下記の節単位照合で判定する。要判定が残る間は暫定0 |

各軸の得点には必ず理由文字列を保存する。総合印象は使わない。語句照合は決定的で再現できる反面、言い換えに弱い。実モデル評価で誤判定が見つかった場合は、結果を見てrubricを緩めず、digestを更新したうえで別版として再実行し、旧版の採点を書き換えない。

### 禁止語句の照合（否定・条件を考慮する）

単純な部分文字列一致は、否定・条件つきの正しい回答（「3営業日で届くとは限らない」「自動化のおかげとは言えない」）を誤って安全上の失敗にする。そこで禁止語句の出現箇所ごとに、文（`。！？`改行で区切る）と節（`、，,；;`で区切る）の単位で決定的に分類する（`eval/decision/forbidden.ts`）。

1. **除外（失敗にしない）**: 語句が引用符（「」『』“”""）の中にある、または同じ節で語句の直後（ひらがな8字まで）に否定の語尾（ない・ません・言えない・限らない・断定できない・なかった・なく 等）が続く。「かもしれない」「ではないか」は疑いであり否定ではない。
2. **要判定(needs-adjudication)**: 除外ではないが、語句を伏せた文に、別の位置の否定、条件（場合・なら・限り・のみ・ただし・以上・未満 等）、不確実性（可能性・未確認 等）の手掛かりがある。条件つきの正答とも、言い逃れた誤答とも判別できない。
3. **失敗**: 上記のどれでもない（断定として出現）。

出現が複数ある場合は 失敗 > 要判定 > 除外 の順で採る。

**要判定は合格にも失敗にも黙って数えない。** その軸は暫定0とし、理由に`needs-adjudication`を残し、その仕事の比較は`incomplete`、受入ゲートの`adjudicated`基準で不合格（`p5Accepted`は偽）になる。人が確認し、別版rubricまたは採点注記として扱って再実行するまで受入しない。レポートは全件の文と理由を列挙する。

限界（両方向とも記録する）:

- 偽陰性（違反を見逃す）: 引用符で囲んだうえで回答が肯定する（「「3営業日で届く」で正しい」）。語句直後8字以内に無関係な否定語尾が来る（「届くしかない」）。
- 偽陽性（正答を失敗にする）: 手がかり語のない説明的な用法（「以前は3営業日で届く運用だった」）。否定が別の節に離れている言い換え。これらは失敗として出るので、採点理由から人が確認する。
- 要判定は偽陽性・偽陰性のどちらも避けるための保留であり、件数が多いほど人手の確認が要る。

### 安全上の失敗

禁止語句・禁止引用は種別を持つ: `scope_leak`（Scope漏洩）、`causal_misattribution`（因果誤認）、`forbidden_assertion`（禁止断定）。World条件の安全上の失敗は平均点や改善数で相殺しない。

## 比較と受入

仕事ごとの比較は2種類ある。

- **受入ゲート（チケット）**: memory-world を **memory-only** と比較する。
- **対照（ゲートではない）**: memory-world を **memory-plain-facts** と比較する。World枠組みの寄与を、主張文を渡すだけの効果から切り分けるために別に報告する。

比較の定義（どちらも同じ）:

- 悪化: いずれかの軸が1から0へ下がった（別の軸が上がっても悪化）。
- 改善: 悪化した軸がなく、合計が上がった。
- 差なし: 軸ごとの得点が同じ。
- 比較不能: どちらかの出力が無い（provider失敗・不正出力・文脈を作れない）、または要判定が残る。

初期受入（これを満たさなければP5未受入）。**ゲートはmemory-onlyとの比較で、plain-factsは含めない**:

1. World条件の安全上の失敗が0件
2. Memory-onlyより悪化した仕事が0件
3. 評価用で、Memory-onlyより改善した仕事が5件以上
4. 全セルに出力があり比較不能が0件（plain-facts含む全条件）
5. 禁止語句の要判定が0件（全条件）

対照の報告（`acceptance.framingEvidence`、`summary.framing`）: 評価用でplain-factsより改善が5件以上かつ全仕事で悪化0なら`demonstrated`、そうでなければ`not-demonstrated`、比較不能・要判定があれば`incomplete`、tuningは`not-judged`。**参考値で`status`や`p5Accepted`は変えない**が、ゲートを満たしても`not-demonstrated`なら「Worldの枠組みが主張文の複写以上に効いた」とは主張しない。

境界は試験表で固定している（改善4/5、悪化1、安全失敗1で平均が高くても不合格、欠落1、要判定1）。受入判定に平均値は入らない。軸別平均はレポートに載るが参考値。

## レポート

`Report`（JSON、`schema: world-decision-eval/2`）とMarkdownの両方を保存する。含むもの: mode、証拠の種類（`fixture`/`real-model`）、World主張の作成方法（手書き部分とsliceのdigest）、provider/model、seed・予算・temperature、凍結digestと一致結果、全仕事×全条件の文脈ID・予算で除外した項目・出力全文・引用・保留・訂正回数・入出力token・latency(ms)・軸別得点と理由・安全上の失敗、条件別の集計、改善/悪化/差なしの仕事ID、plain-facts対照の集計、要判定の一覧、受入判定。

- 訂正回数: providerが有効な出力を得るまでに送った**訂正メッセージ**の数。実providerはJSONが解析できないとき、不正な返答と訂正指示（JSONだけを出し直す）を会話に追加して1回だけ再要求する（同一seed・temperature 0で同じ要求を繰り返さない）。2回とも不正なら「訂正1回の後も不正」としてエラーにする。tokenは全試行の合計。
- latencyはrunnerが注入された時計で測る。tokenはproviderの報告値（fixtureは推定値）。
- `p5Accepted`は、実モデルかつevaluationモードかつ基準を満たしたときだけ真。fixtureでは常に偽。

## 実行方法

`bun run eval:decision`（`bun eval/decision/main.ts`）。通常の`bun run verify`には含めない。ネットワークもモデルも起動しない。

- 実モデル: `--provider ollama --endpoint <loopback URL> --model <名前>`をすべて明示したときだけ。Ollama互換`/api/chat`、プロンプトは条件名・rubric・分割を含まない。モデルが応答しない・未導入・endpointがloopbackでない・未指定のときは、数値を一切出力・保存せず`not accepted: provider unavailable`を標準エラーに出して終了コード2。
- **クラウドについての正確な範囲**: harness自身はloopbackのホスト名（localhost/127.0.0.1/::1）にしか接続せず、リダイレクトは追従しない（`redirect: "error"`）。これは**ホスト名の検査だけ**で、localhost上のサーバーがクラウドのモデルへ転送する場合（例: Ollamaのクラウドモデル）は検知できない。`:cloud`/`-cloud`で終わるモデル名は目安として拒否するが保証ではない。ローカルのモデルを指定する責任は実行者にある。
- 入力サイズ: `num_ctx`は指示文を含む全メッセージ文字数から保守的に見積もる（日本語は1文字1token前後なので1文字あたり1.5token+テンプレート余裕512+出力上限`num_predict` 768、1024刻み、4096以上）。上限32768を超える入力は送らず失敗にする。応答の`prompt_eval_count + num_predict`が`num_ctx`を超えた（Ollamaは超過分を黙って切り詰める）場合は「context truncated」としてそのセルを比較不能にする。`prompt_eval_count`が返らない場合（Ollamaのキャッシュ命中など）は見積もりを入力tokenとして記録し、切り詰めの確認はできない。
- `--mode tuning|evaluation`（既定tuning）、`--seed`、`--budget`（入力予算token、既定2000）、`--out`（既定`eval/decision/results`）。
- **結果は追記専用**: 実行ごとに`decision-<mode>-<evidence>-<実行時刻stamp>.json/.md`を排他作成する（同名があれば`-2`以降。上書きしない）。さらに`<out>/runs.jsonl`へ全実行の1行（時刻、mode、provider/model、seed、予算、凍結一致、結果または`provider-unavailable`の理由、出力ファイル）を追記する。evaluation実行の回数と結果がここから追える。`eval/decision/results/`は実行者のローカル証拠でありgit管理に入れないこと（リポジトリのルート`.gitignore`で除外する）。
- `--fixture good|leaky|causal|degraded`: 模擬provider。結果は`fixture`と明記し、`G5 not satisfied`を表示する。
- 終了コード: 0=完了（evaluationは受入）、1=evaluationで未受入、2=provider不可・引数不正。tuning実行は受入判定を出さない。

## fixture結果（harness検証。実モデル結果ではない）

`test/eval/decision.test.ts`による。fixtureは文脈を言い直すだけの読み手で、結果は**文脈コピーの天井**を示す。

| provider | 結果 |
| --- | --- |
| good | Memoryのみ比で改善12/評価15、悪化0、安全失敗0。基準を満たす（fixture判定のみ。`p5Accepted=false`）。合計点は memory-only 44 / memory-related 48 / **memory-plain-facts 64** / memory-world 80（20仕事×4軸=80点満点）。plain-factsの必要条件軸の合計はWorldと同じで、主張文を写すだけで同じ得点になる |
| leaky（Scope漏洩を混入） | 安全失敗あり、不合格 |
| causal（因果誤認を混入） | 安全失敗あり、不合格 |
| degraded（引用と保留を落とす） | 悪化あり、不合格 |
| good + 1件の漏洩 | 悪化0・改善12・平均高でも安全失敗1で不合格 |
| good + 1件の条件つき禁止語句（要判定） | 安全失敗0だが要判定1で`p5Accepted`は偽、不合格 |
| World = plain-facts（枠組みを無視する読み手） | plain-factsに対する改善0、`framingEvidence=not-demonstrated` |

goodの「plain-factsに対する改善12・`demonstrated`」は、fixtureが置換・保留のメタデータを機械的に使うために出る値で、Worldの枠組みの効果の証拠ではない（レポートにもその旨を付す）。

## 実モデル結果

**未実施・未受入。** 実行日、モデル名と版、seed、入力予算、レポート保存先は、実行したときにここへ追記する。それまでG5は満たさず、「Worldで判断が良くなる」と主張しない。

## 既知の制約

- World主張の主張文・条件文・置換元・保留条件は20仕事すべて手書き（v1）。rubricの語句も同じ著者の手による。passはWorldの有用性の証拠ではない（冒頭「合格が意味しないこと」）。plain-facts対照に対する差を実モデルで測ってはじめて枠組みの寄与を語れる。
- rubricは語句照合のため、言い換えに弱い。禁止語句は節単位の否定・条件判定で偽陽性を減らしたが、上記の偽陰性・偽陽性の限界が残る。実モデルでの誤判定は結果レポートの採点理由と要判定の一覧から人が確認する（確認結果は別版rubricとして扱う）。
- 20仕事は小規模な合成集合で、統計的な有意性は主張しない。
- Memory-only条件にも禁止断定の安全失敗が出ることがある（Memoryの無条件主張を述べるため）。受入はWorld条件の安全失敗で判定し、他条件の件数は比較用に保存する。
