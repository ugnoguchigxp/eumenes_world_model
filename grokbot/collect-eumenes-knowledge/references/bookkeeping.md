# Grokが選んだ引用からJSONLを組み立てる

`assemble_bookkeeping.py` は、受領した同名スクリプトを基に用途を一般化したもの。標準ライブラリのみで動き、意味の判断はしない。Grokが書いた日本語主張・条件・採否・点検結果を保持し、保存本文との位置照合、ハッシュ計算、3種類のJSONL出力、既存validatorによる検査を行う。入力不足を推測で埋めない。

## 使い方

```sh
python3 grokbot/collect-eumenes-knowledge/scripts/assemble_bookkeeping.py \
  --spec grokbot/runtime/run-001/work/records_spec.json \
  --source-root grokbot/runtime/run-001 \
  --output grokbot/runtime/run-001/batches/batch-001
```

成功時は `raw.jsonl`、`first_output.jsonl`、`excluded_held.jsonl`、`validation.json` が揃ったディレクトリを公開する。終了コード0は機械検査成功、2は入力・照合・保存の問題。検査で止まった場合、エラーをGrokが確認し、元の出典を読んで入力を直す。引用の空白を勝手に正規化したり本文側を変更したりしない。既存の出力先には上書きしない。単一実行者で使う。

これは初回抽出用であり、納品済みのrawを再生成して訂正履歴を消すツールではない。既存バッチの訂正は[データ契約](data-contract.md)と改訂手順に従う。

## 入力

旧 `records_spec.json` の短いキーは維持し、ルートを `{"records": [...], "slots": [...]}` にする。旧スクリプトの固定値を廃止したため、以前の配列をそのまま渡しても動かない。追加情報は実際の保存記録・Grokの点検結果から埋める。分からない日時や権利情報は `unknown` 等と明示し、現在時刻を過去の取得時刻として使わない。

以下は**形式説明用**の架空記録。本文・引用・点検文をそのまま収集見本として使わない。

```json
{
  "records": [{
    "cid": "candidate-001", "rid": "record-001", "d": "AI",
    "url": "https://example.org/document",
    "source": {
      "source_id": "source-001", "path": "sources/text/document.txt",
      "raw_path": "sources/raw/document.html",
      "text_extraction": "html-visible-text-v1"
    },
    "quotes": ["対象は日本語。"],
    "ja": "この資料で扱う対象は日本語である。",
    "type": "definition", "mod": "defined", "as": "source_asserted",
    "st": "verified", "ss": "full_page", "ver": "unknown",
    "retrieved_at": "unknown",
    "conds": [], "cstat": "unconditional_with_justification",
    "justification": "当該資料の対象の定義であり、追加の条件は記述されていない。",
    "justification_quote_ref": 0,
    "review": {
      "self_check": {"by": "Grok Bot", "method": "保存本文と主張の範囲を照合", "result": "pass"},
      "independent_review": "not_performed"
    },
    "license": {"storage": "unknown", "redistribution": "not_confirmed", "basis": "未確認", "checked_at": "unknown"},
    "extraction": {"method": "Grokによる本文抽出", "version": "実際の指示版を記載", "first_output": true}
  }],
  "slots": []
}
```

- `source.path` はsource-root内のUTF-8本文。`f` から拡張子やパスを推測しない。`raw_path` は別原本がある場合に指定する。取得ツールの `text_sha256` を `content_sha256`、`raw_sha256` を同名の欄にも渡すと、入力時のハッシュと保存物を照合できる。ハッシュ値は接頭辞なし。
- 引用が一箇所なら文字列でよい。複数ある場合は `{"text":"引用", "byte_start":123}` としてGrokが該当箇所を指定する。先頭を自動採用しない。byte_startは保存本文のUTF-8バイト位置。
- `conds` は `{"text":"日本語", "role":"scope", "qref":0}` の配列。qrefは引用番号、省略時0。引用内で同じ条件文字列が複数ある場合は `start` にUnicodeコードポイント位置を指定する。単一の連続した引用部分を扱う。複数箇所を接合した条件や推論による条件は、この補助ツールで無理に作らずGrokが正式形式を作りvalidatorに渡す。
- 条件が複数なら `combinator_status` と `comb` を必ず明示する。例：`"combinator_status":"resolved", "comb":"all"`。関係が未解決なら `"combinator_status":"unresolved", "comb":null`。複数だからANDと決めつけない。未解決の採否はGrokが判断する。
- 無条件と判断するなら `justification` と `justification_quote_ref` を明示する。定義だから無条件という固定文をコードが生成しない。
- `st` は `verified` / `source_reported` / `on_hold` / `excluded`。後二つには `raw_status`（原抽出のstatus）、`reason`、`detail` が必要。原抽出を保ち、最終行にheld_classと理由を付ける。reviewの結果はGrokが記入し、採用候補には明示的な `pass` が必要。
- `review`, `license`, `extraction`, `retrieved_at` は各記録に明示する。`published_at`, `valid_time` は省略すると `unknown`。`note` は取得時の事情として保存する。自己点検や権利確認をコードが実施したとは報告しない。
- 本文がなく主張を作れない候補は `records` に架空の行を作らず、`slots` に正式なslot行を入れる。`candidate_id`, `domain`, `slots:1`, `reason_code`, `detail` 等は[データ契約](data-contract.md)に従う。特定候補の失敗をプログラムへ埋め込まない。

従来スクリプトの `AT`、`f == 'c03'`、固定した点検文・権利文・未充足2行、`comb` 未指定時のall、assertによる検査を廃止した。引用位置と条件位置の単位を分け、明示的な例外で検査するため、Pythonの最適化実行でも検査を省略しない。出力前に全件を照合し、失敗時に途中までのバッチを納品しない。

機械検査はreviewやlicenseの主張の真実性、無条件という判断、引用が日本語主張を支持するかを保証しない。Grokの自己点検と独立評価は引き続き必要。
