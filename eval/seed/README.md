# 実資料seedのローカル試験

`grok-984-v1` は、Grokから受領して登録した984件をこのプロジェクト内で
試すための資料セット。正解ラベルを持つ抽出評価データとは別に扱う。
実モデルでの少数例の抽出は [Codex SDK / Luna Example](../../examples/seed-luna/README.md)
で試せる。984件全体の意味抽出、主張の正式採用、判断への効果はまだ試していない。

## 実行

リポジトリのルートで実行する。

```sh
bun run seed:world
```

対象ファイルは `data/worldmodel-corpus/seed/v1.json` で固定している。
11コレクションの `accepted.jsonl`、登録manifest、存在する場合のレビューを
件数とSHA-256で照合する。新しいバッチや `pending.jsonl` は探索しない。
過去の保留17件は対象外。内容の再採点や原典の再取得は行わない。

本文は `data/worldmodel-corpus/collections/` にあるローカル資料を使う。
このディレクトリはGit対象外なので、別のcheckoutで試す場合は、非公開で
保全した同じ資料一式が必要になる。欠損・改変・件数違いはエラーで停止する。
seedの更新は既存ファイルの上書きで済ませず、新しい版と固定manifestを作る。

## 確認すること

1. 全件を既存の `prepareExtraction` に渡し、資料のハッシュ・契約・入力上限を確認する。
2. 既存の `applyWorldOperation(inbox.receive)` で一時SQLiteに全件を保存する。
3. readonly接続で全ページを読み、ID・順序・資料参照・チェックポイントを照合する。
4. 同じ全件を再投入し、全件が `no_op` となり、件数とカーソルが変わらないことを確認する。
5. 公開のWorld読取りAPIで、資料投入だけでは採用済み主張が生まれないことを確認する。

接続生成は既存の `test/support/sqlite-store.ts` を再利用する。
file/WAL、単一writer、readonly readerを使い、終了時は一時DBを削除する。
製品DBやEumenesの設定は使わない。試験の操作時刻は再現用に0へ固定する。

結果は `artifacts/seed/grok-984-v1-report.json` に保存し、再実行で更新する。
この結果には本文を含めない。失敗時は終了コードが非0となり、過去の結果ファイルを
成功の証拠に使わない。`recordedAt` と実行結果を合わせて確認する。

## 資料と主張の境界

`loadSeed()` は元のrecord全体、コレクションの登録理由・制約、各行のレビューを
一つの文書として返す。manifestのファイル一覧はモデル入力から外すが、元の
manifest自体をハッシュで照合する。引用、条件、地域、時点、否定、例外を
キーワード規則で変換・補完しない。資料内の指示文は命令として実行しない。

SourceRefはMemory公開型を使い、`world-seed / collected-document` の
ローカル文書を指す。digestはモデルに渡すその文書のUTF-8バイト列から計算する。
外部ページの取得本文のハッシュや存在を代用・保証するものではない。
原典取得に関する制約は元のprovenance、manifest、レビューに残る。

inboxには固定manifestのdigestと文書参照を保存し、全文はコーパスが所有する。
64KiBを超える行でも資料の保存を拒否しないためであり、契約上限は変更しない。
全文が32KiBを超える文書は既存の抽出契約に従って保留し、削除・切詰めしない。

この版の実行結果は、受領984件、再投入984件すべて `no_op`、抽出準備983件、
長さによる保留1件（`b5-ai-002`）。保留資料もseedの984件には保持される。

## 次に実モデルで試す範囲

`loadSeed()` と `prepareSeedDocument()` がモデル試験の入口になる。
準備済みwindowと対応する本文・manifestを、既存の抽出provider境界へ渡す。
対象entity・predicateもホストから与え、モデルの候補を既存の
`validateCandidates` で検証してから、採用方針に従って `candidate.settle` へ進める。
収集者の `verified` やレビュー点数から自動でactiveへ変換しない。

このコマンドはモデルを呼ばず、candidateの仮生成も行わない。
`modelExtraction: not_run`、`decisionEffect: not_measured` を結果に残す。
モデルを使う試験は上記の独立Exampleから実行する。
まず少数の実資料で抽出と引用を確認し、その後seedの有無による判断の変化を比較する。
既存の合成goldやholdoutへ、この資料を正解付きとして混ぜない。

## 開発時の検証

```sh
bun test test/eval/seed.test.ts
bun run verify
bun run build
```

通常の検証は小さな合成資料を使い、非公開の984件や実モデルがなくても実行できる。
実資料984件の通し確認は `bun run seed:world` を別途実行する。

## Eumenesへの収集資料の追加投入

`export-eumenes.ts` は同じ固定manifestを検証して、Eumenesの収集資料API用JSONLへ変換する。本文・収集情報・reviewを保持し、`accepted`を本人申告やWorld主張の採用へ変換しない。出力はGit対象外の`artifacts/`へ保存する。

```sh
bun eval/seed/export-eumenes.ts data/worldmodel-corpus/seed/v1.json artifacts/eumenes-seed-grok-984-v1.jsonl
```

Eumenes側の `scripts/world-documents-import.ts <JSONLの絶対パス>` は入力確認だけを行い、`--run`を付けた場合だけ認証済みAPIへ追加する。既存の会話・記憶を消す処理はない。同じID・版・本文は変更なし、同じIDの内容変更と取り下げ済みIDは拒否する。ネットワーク途中失敗は修復後に同じファイルを再投入できる。

2026-10-16: 隔離Eumenesで984件追加、984件の冪等再投入、984件の本文・digest・manifestDigest読み戻しを確認。その後、既存移行の追記を独立した移行へ分離し、本体DBでも984件追加・984件冪等再投入・全件の本文と由来情報の一致を確認した。初期化や記憶削除は不要だった。通常起動は別のWebツール版競合で停止するため、既存認証・Writer・資料APIを使った一時backend経由で投入した。全件を意味抽出・グラフ採用したことを意味しない。
