# 保存形式と補助ツール

## 対応範囲

今回の納品 `schema_version: 1.1` のフィールドを使った、限定的な整合性検査である。正式な全スキーマの実装ではない。スキーマを変更したら版と検査範囲を更新し、未知のフィールドまで検証したと報告しない。

現在対応する通常レコードのschema_versionは文字列 `"1.1"` のみ。新規収集の標準プロファイルではraw、candidate_id、除外・保留理由を必須にする。旧資料を監査するときだけ `validate` / `coverage` に `--legacy` を付ける。この互換モードはrawやcandidate_idの欠落と集約slotを受け付けるが、未知のschema_versionや不正な引用を許可するものではない。schema_version以外の任意フィールドの全検査は行わない。

コマンドはプロジェクト直下で実行する例。Skill 単体で渡した場合は、`grokbot/collect-eumenes-knowledge/` をそのフォルダへのパスに置き換える。全コマンドはネットワークに接続しない。

## バッチ

`raw.jsonl`、`first_output.jsonl`、`excluded_held.jsonl` は必須。0件なら空ファイル。rawを省略できるのは `--legacy` のみ。UTF-8 の1行1オブジェクト。空行、重複JSONキー、NaN、有限数として扱えない数値は受け付けない。

通常レコードに必要な主要項目：

| 項目 | 内容 |
|---|---|
| `record_id` | バッチをまたいで一意。最終2ファイル間で重複させない |
| `schema_version` | 文字列 `"1.1"`。この検証器の対応範囲を宣言する |
| `candidate_id` | 候補台帳の ID。分割後も共通にして件数を水増ししない |
| `claim` | `source_text`, `normalized_ja`, `modality`, `assertion_scope` |
| `claim_type` | 定義、構造、傾向等。意味によって LLM が選ぶ |
| `scope.domain` | 配分設定の AI / R / M / L / F |
| `scope` のその他 | 地域、制度、対象時点、版、取得日時。不明は不明とする |
| `provenance.source` | `source_id`, `url`, `path`, `content_sha256` |
| `provenance.quotes` | `text`, `quote_sha256`, `locator` の配列 |
| `conditions` | 条件の抽出状態、項目、結合関係。不明な結合を推測しない |
| `status` | 最終候補は `verified` または `source_reported` |
| `support_scope` | 本文・要旨・公式ページ等、実際に確認した範囲 |
| `review` | 自己点検／独立評価の別、実施者、方法、結果 |
| `license` | 保存と再配布を別々に記録。根拠URLと確認日時 |
| `extraction` | 指示、手法、版、初回出力であるか |

除外・保留レコードは `held_class: excluded | on_hold` と `reason_code` を記す。古いレコードの `status: verified` が残っていても採用として数えない。first_outputにheld_classを併記しない。statusがsource_reportedでもsupport_scopeは必要。source_reportedは、当該資料の報告としてのみ保持し、より強い支持確認が未完了であることを表す。取得失敗等で本文と主張を作れない場合は、架空のレコードにせず `excluded_held.jsonl` に次の slot 行を置く。

```json
{"record_type":"slot","source_id":"source-17","candidate_id":"candidate-17","domain":"AI","slots":1,"slot_status":"slot_unfilled_content","reason_code":"fetch_failed","detail":"本文取得を2回試みたが失敗。試行ログを参照"}
```

slot の `slots` は未充足の候補数。新規収集では1候補1行、candidate_idを付けてslotsを1にする。集計時にはslot同士、および通常レコードとのcandidate_id重複をエラーにする。旧形式のcandidate_idがない集約slotは個別候補に照合できないため、台帳点検が必要。

raw がある場合、その record_id 集合が最終2ファイルの集合と一致するか、同じrecord_idのcandidate_idと主領域が維持されているか検査する。分割は原抽出を確定する前に子レコードとして保存し、それぞれに共通の candidate_id を付ける。この版のツールは、raw確定後に親IDを子IDへ変換した履歴の照合には対応しない。後から分割が必要になった候補は当該バッチで保留し、理由と元IDを記した再抽出を別の版で行う。rawを書き換えず、旧版と新版を同時に集計しない。

## 本文・引用

`source.path` は `--source-root` 以下の相対パス。絶対パス、`..`、範囲外へのシンボリックリンクは許可しない。ハッシュは保存したファイルの全バイトを対象とした SHA-256。`sha256:` 接頭辞の有無の両方に対応する。

引用先は有効なUTF-8テキストでなければならない。循環したファイル参照も照合不能として報告する。

`quote.locator` は `path, byte_start, byte_end`。UTF-8 **バイト位置**の半開区間 `[start,end)` とし、そこを切り出したバイト列が `quote.text` と一致する必要がある。改行・空白も含めて同じにする。

条件等の `spans` は `quote_ref`（0始まり）と明示的な `span_in_quote: [start,end]`。こちらは引用内の Unicode **コードポイント位置**であり、バイト位置やJavaScriptのUTF-16コード単位ではない。`derivation: source_quoted` の場合、空でないspansが必要で、切り出した部分を連結した文字列または `…` で連結した文字列が `text` と一致する。justification_quote_refも実在する引用を指す必要がある。日本語や絵文字で位置の単位を混同しない。

本文原本と抽出テキストが別なら、原本URL、取得日時、原本ハッシュ、抽出方法と版、ページや節をメタデータに残す。HTML抽出後のoffsetをHTML原本に適用しない。検索抜粋は本文保存の代わりにならない。

## 検証

```sh
python3 grokbot/collect-eumenes-knowledge/scripts/collector_tools.py validate \
  --batch grokbot/runtime/run-001/batches/batch-001 \
  --source-root grokbot/runtime/run-001
```

標準出力のJSONを `validation.json` に保存する。終了コード0は記載した機械検査の通過、1は不整合または本文照合不能、2は入力・読み込みの問題。

`ok` は原抽出・除外・保留も含む全体の結果。原抽出に既知の誤りがある場合はfalseのまま監査記録に残す。`first_output_ok` は採用ファイルとID・候補の整合性に関する結果で、採用件数は `first_output_records`。同じ候補の再割当てや重複は別途coverageでも点検する。この二つの結果を区別して報告し、CLI終了コードを無視して成功と表示しない。

検査するもの：対応schema_version、主要オブジェクトと主張項目、ID重複、rawの分配と候補ID・領域の維持、最終出力のstatusとsupport_scope、slotの置き場所と候補重複、引用の有無、HTTP(S)出典URLの基本形、本文と引用のハッシュ、本文の引用位置、spanと根拠参照、自己分割参照、未解決combinatorがnullであること。

検査しないもの：全スキーマ、review/license/extractionの全項目、日時の正しさ、URLの実在、URLと保存本文の真正な対応、意味の支持、資料の独立性、鮮度、ライセンスの妥当性、分割履歴全体の循環、ライフサイクル台帳の完全性。上の表は納品で記録すべき項目であり、全項目が機械検査済みという意味ではない。`semantic_review: not_performed` を返す。欠けた本文を新しく取得して古い取得時点の検証成功に置き換えない。

## 配分集計

```sh
python3 grokbot/collect-eumenes-knowledge/scripts/collector_tools.py coverage \
  --batch grokbot/runtime/run-001/batches/batch-001 \
  --config grokbot/collect-eumenes-knowledge/config/distribution.json \
  --target-total 500
```

`--batch` は候補が重複しない別バッチについて繰り返せる。各論理バッチの現行版だけを渡す。同じcandidateが複数バッチに現れたら新版の自動選択をせずエラーとする。rawは数えない。最終レコードを candidate_id でまとめ、分割で1候補が複数行になっても1件とする。readyとheld等にまたがる候補はpartial。`--legacy` でcandidate_idがない場合だけrecord_idを別の識別空間で代用し、その件数を `legacy_record_id_fallbacks` として返す。candidate_idの空文字・nullは互換モードでもエラー。識別できない集約slot数は `legacy_unidentified_slots`、通常レコードの総行数は `final_record_count`。旧形式での候補単位の精度は保証できない。

`ready` は first_output に入ったと申告された候補数である。coverageは本文・引用の検証を実行しないため、機械検証や独立審査の合格数ではない。`candidate_count` は ready / held / excluded / partial / unfilled の合計。`ready_fraction` もこの分母を使う。`ready_gap` は新規探索の目安であり、評価失敗の差し替え許可ではない。分母は渡されたファイルに現れる候補だけなので、未処理候補を含む台帳全体との照合は別に必要。

## 検索結果の一時保存

先に検索ツールが返した結果を `search-result.json` に保存する。サービス名、検索文、言語・地域・期間・検索APIやモデル版など結果を変える条件をキーに含める。相対期間なら基準日も含める。検索語は自動的に意味正規化しない。

```sh
python3 grokbot/collect-eumenes-knowledge/scripts/collector_tools.py cache-put \
  --cache-dir grokbot/runtime/run-001/cache \
  --provider grok-native-search --query 'retrieval evaluation' \
  --params '{"language":"en","as_of":"2026-10-15"}' \
  --input search-result.json --ttl-seconds 86400

python3 grokbot/collect-eumenes-knowledge/scripts/collector_tools.py cache-get \
  --cache-dir grokbot/runtime/run-001/cache \
  --provider grok-native-search --query 'retrieval evaluation' \
  --params '{"language":"en","as_of":"2026-10-15"}'
```

終了コード0はhit、3はmiss、4はstale、2は破損等。staleでも履歴比較用にpayloadを返すが、最新情報として利用しない。時計が保存時点より逆行した場合もstaleになる。本文の鮮度は検索結果のTTLだけでは保証できない。

検索結果payloadは内容ハッシュ別のobjects、検索条件ごとの参照はentries、取得履歴はhistoryに保存される。取得先本文とは別物である。読み出す際は検索条件、履歴に保存したメタデータ、有限な日時、payloadハッシュを照合する。更新は一時ファイルから置換し、公開に失敗した場合は前のentryを維持する。

単一writerを前提とし、ロック、容量上限、自動削除、暗号署名は実装していない。プロセス中断への原子的置換であり、停電時のディレクトリ同期による耐久性までは保証しない。履歴とpayloadを同時に書き換えられる攻撃者に対する真正性保証でもない。秘密を含む検索結果は保存対象にしない。容量を超えそうなら新規取得を止め、納品で必要な証拠を残したうえでrun単位に整理する。

## 取得・組み立ての補助

[自動取得](auto-fetch.md)の結果は取得台帳であり、知識スキーマ1.1のレコードではない。Grokが内容を読み、[組み立てツール](bookkeeping.md)へ主張・引用・メタデータを渡す。組み立てツールはこのvalidatorを出力前に実行する。旧records_specには明示的なメタデータの追加が必要で、旧スクリプトの固定値は引き継がない。
