# 簡単な取得をPythonに任せる

Python 3.10以上の標準ライブラリだけを使う。追加パッケージ、ブラウザ、検索APIの設定は不要。Grokが公開資料のURLを選び、コードが取得・保存し、Grokが本文を読んで主張を抽出する。取得成功は内容の正しさや採用を意味しない。

## 実行

以下はプロジェクト直下からの例。キットだけを渡された環境ではスクリプトのパスを配置に合わせる。
Grokは最初にPython実行・保存・外向き通信・子プロセスが使えるか、公開URL1件で確認する。実行不可なら既存の閲覧ツールへ引き継ぐ。通信環境を変更したり認証情報を追加したりして解決しようとしない。

Grokが選んだ候補を `grokbot/runtime/run-001/urls.jsonl` に保存する。例は形式説明用の架空URLであり、実際の資料を選んで置き換える。

```json
{"candidate_id":"candidate-001","url":"https://example.org/document","domain":"AI"}
```

```sh
python3 grokbot/collect-eumenes-knowledge/scripts/fetch_sources.py run \
  --input grokbot/runtime/run-001/urls.jsonl \
  --output grokbot/runtime/run-001/fetch \
  --limit 20 --timeout 20 --max-seconds 180 --max-bytes 2097152 --interval 1
```

入力は1〜500候補、2 MiB以下。candidate_idと完全一致するURLは重複不可。同じ資料から複数主張を得る場合、取得は一度にして同じ保存本文を使う。分類や資料の選定はGrokが行う。

## 出力と引継ぎ

| ファイル・状態 | 意味とGrokの次の作業 |
|---|---|
| `results.jsonl` の `fetched` | 原本とUTF-8本文を保存。目的の本文か確認し、条件・例外を読んで抽出する |
| `handoff.jsonl` | 自動取得で扱えない候補と理由。別の閲覧手段、適切な移転先、PDF抽出等をGrokが検討する |
| `pending.jsonl` の `deferred` | 回数・時間の上限でまだ試していない。全体の残予算内で同じコマンドを再開する。上限を回避するためGrokに全件取り直させない |
| `sources/<hash>.bin` | HTTP応答本文の保存バイト列。PDF等はこの原本だけ保存できる場合もある |
| `sources/<hash>.txt` | 引用位置の基準になるUTF-8テキスト |
| `tasks/*.json`, `plan.json` | 再開用の取得台帳と固定した入力・取得設定 |
| `summary.json` | 取得・引継ぎ・未処理の件数。知識レコードの採用数ではない |

終了コードは0＝全件取得、1＝引継ぎまたは未処理あり、2＝入力・保存等の問題。1を全件失敗として再取得しない。2は原因を確認し、既存成果を削除してやり直さない。

成功・失敗とも同じ出力先では再試行しない。処理中に中断した候補も `interrupted_attempt` としてGrokへ渡す。台帳を残した後で通信したかどうか確定できないためである。中断直後の集計ファイルは古い場合があるが、再開で候補別台帳から再生成する。単一実行者で使い、同じ出力先で同時実行しない。

入力・timeout・max-bytesは計画内で固定する。別の取得時点や設定で再取得するなら、変更理由と旧計画への参照を記録して新しい出力先を使う。既存本文の欠落・改変はエラーにし、新しく取得して古い証拠を置き換えない。取得結果は時点の記録であり、再開しても最新化されない。ETag等は記録だけで自動更新には使わない。

## 対応範囲と諦める条件

- 公開HTTP(S)、標準ポート、HTTP 200の通常のHTML・テキスト・JSON・XMLを対象にする。HTMLはscript/style/head/templateを除いた機械的なテキスト化。本文領域の選択や、ログイン画面・エラーページ・JavaScript依存の判定はGrokが行う。XMLはテキスト保存だけでリンクを巡回しない。
- リダイレクトは追わず移転先を記録する。PDFの文字抽出、画像OCR、JavaScript実行、文字コードの推測、圧縮応答の展開はしない。難しい形式は引き継ぐ。
- 403・429等は再試行しない。Retry-Afterがあれば記録し、Grokも待機条件・全体の試行上限を守る。ログイン、課金、アクセス制限の迂回はしない。
- 標準は1候補につき1試行、1回20試行、取得間隔1秒、応答本文2 MiB、1試行20秒、通信作業の予算180秒。子プロセスでDNS・読み込み・変換を含む試行を打ち切る。起動・保存・検証の時間は別途かかるため、コマンド全体が厳密に180秒以内に終了するという保証ではない。
- `urllib` のソケットtimeoutだけでは全体時間を制限できないため、標準の子プロセス機構を使う。[urllib.request](https://docs.python.org/3/library/urllib.request.html)、[subprocess.run](https://docs.python.org/3/library/subprocess.html)。子プロセスが禁止された環境では `worker_unavailable` 等で引き継ぐ。
- 認証・Cookie・環境プロキシは使わない。私設IP等の誤取得を事前に拒否するが、DNSの再解決を含むネットワーク隔離機構ではない。信頼できる操作者が選んだURLのローカル取得用であり、任意の第三者へ公開する取得サーバーとして使わない。
- 日次費用・全計画の総容量・全体予算は実行ホストとGrokの台帳で管理する。計画を作り直して上限をリセットしない。

## 記録への接続

`--source-root` を取得出力先にする場合、`provenance.source.path` には結果の `text_path`、`content_sha256` には `text_sha256` を使う。runディレクトリをsource-rootにする場合は `fetch/` 等の実際の相対位置を付ける。原本は `raw_path` と `raw_sha256`、抽出方法は `extraction_method`、取得時点は `attempted_at` を引き継ぐ。URLと本文・取得範囲の対応はGrokが確認する。

取得結果を知識JSONLとして納品しない。取得不能を最終的に保留する場合も、Grokが理由・候補IDを確認して未充足slotを作る。本文から引用と意味の判断を選んだ後、[組み立てツール](bookkeeping.md)と既存validatorを使う。
