# 意味品質の評価

実モデルを使う抽出・回答・比較評価はここに分離する。抽出・判断のharnessは実装済みで、実モデルの正式受入は未了。通常verifyでネットワークやモデルを起動しない。

登録済みLocal Providerで実資料から候補保存までを小規模に確認する場合は、
`bun --env-file=../eumenes/.env eval/extraction/local-smoke.ts --host ../eumenes`を使う。
SQLiteの設定は読取りのみで参照し、認証は既存のhostクライアントが使う。
[実測・前提・限界](../spec/evaluation-baseline.md#登録済みlocal-providerでの小規模接続受入2026年10月28日)を参照。
通常のverifyはモデルを呼ばない。

## 変更前後の計測（M0）

既存CLIをそのまま実行し、毎回新しいdirectoryへ記録する。
下記のbaseline/candidateは例示名。同じdirectoryの再使用は拒否する。

```sh
bun run measure:world run --suite extraction --out artifacts/measurement/ext-baseline -- --fixture oracle --split dev
bun run measure:world run --suite decision --out artifacts/measurement/decision-baseline -- --fixture good --mode evaluation
bun run measure:world run --suite performance --out artifacts/measurement/perf-baseline -- --sizes 1000,10000,100000
```

仮説と比較条件を固定してbaselineを記録し、処理が完了してから実装を編集する。
実装後に同じ引数で新しいcandidate directoryへ実行し、比較する。

```sh
bun run measure:world run --suite performance --out artifacts/measurement/perf-candidate -- --sizes 1000,10000,100000
bun run measure:world compare --baseline artifacts/measurement/perf-baseline --candidate artifacts/measurement/perf-candidate --out artifacts/measurement/perf-comparison.json
bun run measure:world replay --run artifacts/measurement/perf-baseline
```

runにはmanifest.json（開始条件・ファイルhash）、reports/（元CLIのレポート）、stdout.log/stderr.log、source-after.json、result.jsonが入る。
replayは保存済みファイルのchecksumを検査して指標を再計算し、モデルを呼ばない。比較JSONも既存fileを上書きしない。
runのexitは元CLIの0/1を引き継ぐ。品質不合格でも元レポートがあればstatus=completedとし、不合格の記録を保持する。
失敗はfailed、実行中のsource変更検出はinvalidated。いずれも比較不可。強制終了等でresult.jsonが無い場合も比較不可。
compareのexit 0は同条件で差分を計算できたという意味で、改善や採用の認定ではない。比較不可・改変・実行失敗はexit 2。

比較には同じsuite、引数、環境、モデル設定、dataset、評価器と予算が必要。
変更できる対象はsrcと共有抽出指示/adapterのproviders.ts。抽出のprompt-version/instructionVersionは変更前後の版を開示して比較する。
評価器や入力を変更したら両armのbaselineを新しい版で取り直す。時間計測は単独で実行し、複数runのばらつきを見る。
fixtureの得点・推定token数は実モデル性能や実課金の証拠ではない。未報告tokensはnull。金額、正確なモデル呼出し数、host待ち時間は計測しない。
性能標本のp95はrawMsから再計算し、欠けた標本を成功扱いしない。

実Local/remoteを測る場合も、`--`以降は既存CLIの明示指定を使う。既存のモデル・予算・holdout受入条件を先に満たす。
extractionの暗黙のprovider環境変数は使わず、provider-moduleはsource追跡範囲内に置く。環境変数や製品DBのdumpは記録しない。
holdoutの匿名化・監査は元CLIが行う。M1以降、抽出devを計測経由で実行すると、最初の要求・生出力・失敗・usageをreports/dev-trace.jsonlへ追加保存する。holdoutの生出力は保存しない。
dirty treeもhashで識別するが、コード本文のsnapshotは保存しないため、その版の再実行には対応するcheckoutの保全が必要。
モデルserverや外部hostの不変性はこの基盤だけでは証明できず、正式受入には別の接続・版確認が必要。

後続実装の対象と完了条件は[実装順M0〜M5](../spec/plan/next-stage.md#0-計測しながら改善する実装順2026年10月31日追補)、実績は[進捗](../spec/plan/progress.md)を参照。

## 本体経路の再生と根拠の保持（M1〜M3）

```sh
bun run measure:world run --suite pipeline --out artifacts/measurement/pipeline-new
bun run eval:replay-extraction artifacts/measurement/ext-baseline/reports/dev-trace.jsonl artifacts/measurement/ext-replayed.json
```

pipelineは独立した合成診断群で、既存E04/A46/A50の代替ではない。
同じsourceと凍結済み候補をprepareExtraction→validateCandidates→inbox/candidate.settle→明示adopt→readWorldSnapshot→buildWorldSliceへ通す。
採用は入力に固定したfixture hostの決定であり、引用検証の成功だけでactiveにしない。
供給・検証・保存・採用・取得・表示の根拠IDを分け、期待根拠は採点だけに使う。
raw/対象単位Slice/主張単位Sliceを比較し、plainとWorld表示には同じ情報を渡す。fixtureの主張選択を実LLMの選択能力とは呼ばない。

上限はheader・引用・manifest・条件評価を含む最終JSONのUTF-8 bytes。
`indexed-sources/1`はunit.sourcesをslice.sourceVersionsへの整数参照にした可逆形式で、条件・有効期間・状態・根拠本文を落とさない。
これで同じ出典digestを繰り返し送る費用を減らす。本体WorldSlice/receipt自体の形式は変わらない。
queryのselectedIndexesは明示したhost/LLMの選択を模したfixture入力で、質問の名称一致やgoldから計算しない。
現在のpublic APIではSliceRequest.focusAssertionRefsでIDとrevisionを指定でき、対象指定との和が必須になる。未取得・失効・版不一致はpartial、収まらなければoverflow。

pipelineの元レポートを再生する場合は`bun run eval:pipeline --out <new.json> --replay <reports/pipeline.json>`。
dev-traceの再生は100件の元要求との一致を確認し、不足・省略された過大出力・dataset違いを拒否する。再生結果は常にfixtureで、実モデル受入には使えない。
記録の書込み失敗は後続モデル呼出しを止める。生出力を失敗修正用の再生成要求へ戻さない。

履歴用の抽出はChatCompletionsProviderの`purpose: "history"`で明示的に選ぶ（eval-extract-history-1）。
既存A46の既定指示v2の本文・版は維持し、履歴目的の指示では複数の時点・条件を別候補に残す。生出力の意味をcodeで補正しない。
履歴指示の実モデル意味品質、完全な過去時点監査、host配線は正式受入済みとは扱わない。

## 登録済みLocal clientの接続（M4準備）

`--provider-module eval/extraction/larm-provider.ts`で既存hostのclientを使用できる。
`EUMENES_EVAL_EXPECTED_MODEL`（catalogの厳密なID）と`EUMENES_EVAL_MODEL_VERSION`（運営者が確認した固定版）を必須とする。
host rootは既定で隣接eumenes、変更時は`EUMENES_EVAL_HOST_ROOT`。履歴目的は`EUMENES_EVAL_EXTRACTION_PURPOSE=history`、既定current。
これらは本人が確認した値を渡す契約であり、profile名から実モデル/重み版を推測しない。catalogに版が無い場合、harnessだけでは実物を照合できない。
接続先・秘密は既存clientのreadonly設定/envを使い、レポートへdumpしない。接続終了失敗はrun失敗とし、元生成を再要求しない。
現在のcatalog確認ではprofile名と実モデルIDが異なり計画対象の固定版は未同定。正式測定・holdout参照はG5と実行予算が揃ってから行う。
## Claude / GPT-6 Luna APIによる外部比較

有料検証は明示実行専用。通常のverifyはネットワークやモデルを呼ばない。
個人の`~/.zprofile`のキーをログインシェルから継承するため、プロジェクトの`.env`への複製は不要。
標準名`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`と、利用者の
`OPEN_AI_API_KEY` / `CLAUDE_API_KEY`を認識する。秘密は記録しない。

今回の継続は`eval/api-quality/confirmation.ts`を使う。次は手動再実行用の例であり、
実行すれば課金する。出力先は毎回新規、台帳は過去分を含む**同じファイル**を渡す。
固定コピーから実行し、途中に編集を入れない。

```sh
zsh -lc 'EUMENES_EVAL_API_EFFORT=high bun eval/api-quality/confirmation.ts calibration artifacts/manual-calibration-new "$PWD/artifacts/quality-80/2026-11-05/api-budget.jsonl"'
zsh -lc 'EUMENES_EVAL_API_EFFORT=high bun eval/api-quality/confirmation.ts regression artifacts/manual-regression-new "$PWD/artifacts/quality-80/2026-11-05/api-budget.jsonl"'
zsh -lc 'EUMENES_EVAL_API_EFFORT=high bun eval/api-quality/confirmation.ts fresh artifacts/manual-fresh-new "$PWD/artifacts/quality-80/2026-11-05/api-budget.jsonl"'
zsh -lc 'EUMENES_EVAL_API_EFFORT=high bun eval/api-quality/confirmation.ts jobs artifacts/manual-jobs-new "$PWD/artifacts/quality-80/2026-11-05/api-budget.jsonl"'
```

モデルは`gpt-6-luna` / `claude-haiku-5-5`、標準tier、最大2並列。
confirmationのeffortは明示的にmedium/highを選べ、既定medium。今回の固定版はhigh。
要求のhashには実際のeffort・モデル・指示・入力・schema・出力上限・tierを含む。
実装版・全結果・費用・未達条件の正本は[API品質の検証記録](../spec/plan/api-quality.md)。

共有台帳で累積10 USD・12000予約を送信前に強制する。旧記録は再計算・返金扱いにしない。
新規の既知usageはinput/read 0.15、cache-write 0.25、思考を含むoutput 0.60 USD/百万token。
公式短文標準単価を上回るbuffer付き上限であり、請求明細の実額ではない。
最大input 100000token、body 80000byte、output 8192tokenを超える要求は拒否する。
HTTP失敗・usage不明・モデル不一致は予約を残し、同じ実要求を再生成しない。
台帳のlockは同時プロセスを拒否する。異常終了時も予約を消して費用を戻さない。
予約IDの欠落・再利用など不正な台帳は拒否する。実usageが予約を超えた場合は既知額を記録し、
再起動後も追加予約を止める。台帳を閉じた後の書込みも拒否する。
送信開始記録がない旧service-stopは「未実行」と区別し、最初の実行だけを許す。
要求ごとの`.claim`は別sessionからの重複送信も拒否する。応答の記録が欠けてもclaimは削除せず、
同じ要求を再生成しない。raw保存方針の違う再利用は、別要求として送信せずエラーにする。

- `calibration`：回答採点28例と抽出採点10例の正負・安全flagを両社で照合。
- `dev`：既存40仕事のdev10件。抽出の正式dev100件とは別。
- `regression`：既存抽出holdout100件/社と旧独立60件/社。`independent`は後者だけ。
- `fresh`：事前固定した新規独立60件を、2抽出版×両社で検証。実行後は未見と呼ばない。
- `jobs`：全40仕事を2抽出版×2抽出モデル×2読取モデルで比較。

抽出は両版とも常にdraftと元入力に対するreviewの2要求を行い、各段階の最初の応答を使う。
失敗時の再生成、best-of、review失敗時のdraftへのfallback、gold/scoreの生成入力はない。
mediumの抽出上限4096token、highは8192token。usageは2段階を合算する。
対照は公開契約3、候補は型付きnative wire契約8.1。Claudeで再帰/巨大grammarが拒否されたため、
候補は非再帰の条件ASTと固定形の暦境界を使う。引用の完全一致→UTF-8 byte範囲、ISO時刻→epoch、
LLMが選んだ暦単位→境界計算だけをcodeで行う。語句分類、曖昧一致、意味の修復は行わない。
callerの述語・値型・単位・ID宣言の不整合は、全出力を失敗として残す。

保存経路は公開APIと使い捨てSQLite。採用は合成fixture hostの明示操作であり、
引用検証の成功だけで本番の採用権限を与えない。選択なしの文脈には未採用候補を表示しない。
receiptは固定replay内で検証する。API待機中の本番更新から回答公開までの競合は対象外。

原文/平文/World/oracleの4方式を比較する。原文は直近whole-sourceの8192byte対照で、RAG一般とは異なる。
平文はWorldと同じ材料をfield-per-lineのJSON値として保持し、往復一致を検査する。
oracleは正解根拠の原文だけを使う診断条件。平文を意図的に劣化させて構造の優位を作らない。

回答の値・引用・保留は厳密に採点し、別会社のモデルが方式名を伏せて意味と安全性を採点する。
実際にモデルへ渡した根拠・引用ID・hostのvalidator結果も採点に供給する。
読取りのcontextManifest（参照権限の範囲・観測の来歴・記録方針）は共通factoryで作り、
回答と採点の両方へ同じ値を渡す。引用本文だけを渡して実際の入力情報を落とさない。
同一の完全な採点入力は1回だけ判定し、最初の判定を共有する。これは採点の再現性を固定する仕組みであり、
採点モデル自体のばらつきが消えたという証拠ではない。reference矛盾・未判定は不合格。
厳密採点の失敗を意味採点で上書きしない。
条件式の数学的同値判定では、参照されていない文字列・entity値と、各単位の数値境界・区間も比較する。
組合せ上限を超える式を同値とみなさず、展開前に打ち切る。

独立例とholdoutはrawを保存せず、hash/usage/集計・判定だけを残す。
40仕事の出力は再生用に保存する。raw非保存要求を後から再生成して失敗を消さない。
source前後不一致はinvalidated。`status:completed`は処理完了であり、品質合格ではない。
各score・欠測・95%/0許容・改善5件以上/悪化0の条件を別途確認する。

旧`eval/api/main.ts`は初回の契約/抽出/判断比較の入口として保持する。
旧版・旧料金計上の結果は履歴であり、現行8.1や新しい採点結果へ置き換えない。
実モデルのAPI品質、Local/P5正式受入、技術品質の評点は別の判定。
CIと本流への取り込みはこの作業に含まれない。
