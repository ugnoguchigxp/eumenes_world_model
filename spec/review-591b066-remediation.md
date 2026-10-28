# 591b066レビューへの対応（2026年10月28日）

対象はWorldModel `591b0668d5e7bb002b4cbcc3362a3186603d05ce`、参照したEumenesは`34eead79f22bceaa454f2042dd6ce9767299def3`。
本体リポジトリの修正と検証を行い、隣接リポジトリと製品DBは変更しない。
着手時の既存変更（eval/seedのREADME・export-eumenes.ts、progress末尾のseed export記録）は保持した。

## 対応範囲と完了条件

| 指摘 | 対応と確認 |
|---|---|
| 採用による矛盾消失 | 純粋投影とSQLite増分・全再構築で同じ内容参照判定を使う。採用・dispute・resolveは内容を変えず、自己supersedesが内容変更の境界。採用順を反転しても両方causalEligible=false。置換後は旧内容への矛盾を持ち越さない。手作り計画でも置換の自己リンク省略を拒否 |
| 曖昧な反証の除外 | 最上位の観測群で、適用され得る観測の比較結果が確実な結果を変え得る場合にunknown。結論が同じ場合や下位の不確実な観測では確定結果を維持。入力順、両極性、型・単位違いを試験 |
| fresh checkoutでMemory型がない | rootのdistだけをignoreし、固定Memoryのdistを差分に含める。vendorは再整形せずハッシュ検査。隣接checkoutなしの一時コピーでinstall・verify・buildを実行 |
| Memoryが未固定 | 指摘を訂正。既存も0.3.6アーカイブSHAと全ファイルSHAで固定されていた。再生成時に別内容へ変わる穴を修正し、独立したmanifest pinと型検査前の検証を追加。今後の再生成はclean checkout＋完全なcommit IDが必須。内容更新は明示的な--update-pinのみ |
| AGENTS、計画、progress、README、verify表示が古い | 現在の実装とhost fixture実績を反映し、過去時点の記述と正式未受入を区別。P3未着手というレビューの前提は訂正 |
| モデル出力を先にJSON.parse | UTF-8上限の検査後に解析し、不正JSONや過大出力は通常のrejected結果にする。既存の回復実験はmalformedを回復対象にしないことも維持 |
| 汚染文書の試験 | 既存の攻撃文書は存在していた。通常文書との対比較、実Local出力の保存・再投入・active=0までを追加。実モデルで双方の内容不変を確認 |
| SQLite payloadの無検証cast | assertions/evidence、identity/entity/event、scenarios/prediction/outcomeを既存の契約parserへ通す。壊れたJSON、null、欠損、異なる形はWorldIntegrityError。内部decodeはroot公開APIに追加しない |
| grokbotの同居・tar重複 | 評価コーパス収集手順を保存する同梱理由と非依存境界をREADMEへ記載。tarを削除し再生成手順へ変更 |
| 大きな結果JSON | 回帰試験に必要な11ファイルの原バイト列を変えずfixtures/experimentsへ移してgzip圧縮。8,764,271→872,899 bytes。全SHAを固定し既存の再採点を継続。新規のresultsはignore |
| 探索実験が受入を圧迫 | examplesの比較研究、evalの正式受入、日常verifyの責務と優先順位を文書化。新しい比較実験は追加せず既存経路で実ローカル抽出を実行 |
| Agency/Memoryとの対応 | host-contract-v1にbelief状態との対応、別ID・別所有、confidenceに変換しないこと、訂正・忘却の責務を追加。Agency文脈は検証済みWorldSliceを入口にする設計を明記 |
| 実モデル抽出が未検証 | SQLite登録設定から既存LARMクライアントへ接続。lfm2.5-24b-a2bで実資料1件＋攻撃の有無2件すべて候補保存・再投入まで成功。任意実行のlocal-smokeコマンドと実測を残す |

## 検証と証拠

- 着手前: `bun run verify` 935件成功。欠けたdistは既存環境に残っていたため、fresh checkoutとは区別した。
- 修正前の回帰: 矛盾2件、曖昧観測2件が期待どおり失敗。supersedes省略はfile/memory双方で再現。
- 部分→結合: 条件・投影・repositoryと、破損データ・引用・配布pin・圧縮証拠の試験を実施。既存の期待値や採点基準を弱めていない。
- 全体: `bun run verify` 950件成功・0失敗、root公開面・境界・型・lint・整形、独立consumer5件を含む。
- `bun run build`成功、`bun run test:sqlite`21件成功。
- 新規checkout相当: tracked＋新規非ignoreファイルだけを一時ディレクトリへ複製し、node_modules・既存dist・隣接checkoutなしで`bun install --frozen-lockfile`→verify 950件→buildを実行。全成功。一時ディレクトリは回収。
- 実モデル: [評価記録](evaluation-baseline.md#登録済みlocal-providerでの小規模接続受入2026年10月28日)。実行中のコードdigest不変を確認したCLIのrunは`artifacts/extraction-local/2026-10-28T13-22-41.912Z-a05dd394/report.json`。
- ローカル詳細ログ: `artifacts/review-591b066/`。通常/攻撃の可搬な回帰証拠は`fixtures/extraction/local-injection-v1.json`。

## 導入時の残る条件

この修正を製品に導入するときは、hostの単一Writer transaction内で各Scopeの`rebuild`を行い、旧コードの投影を再計算する。既存の正本・履歴・schemaは変更しない。製品DBへの実行は今回行っていない。

100件の正式holdout、日本語payloadの生成品質、host queueの実モデル受入、製品への導入は未受入のまま維持する。
実資料1件では英語原文を英語のpayloadとして保持しており、日本語指示への追従を達成したとは扱わない。
Agencyへの実配線や生ログの組立て変更はhost所有で、参照専用の今回の範囲には含めない。

差分は入出力・出力契約・状態管理・既存意味規則の検査に限定した。
観測や発話の個別語句で判断を置き換える処理、専用の成功応答、製品側の意味分類辞書は追加していない。
制御文書の期待文との一致は評価コードだけが使う。語句・対象が変わっても、製品側は同じ契約と投影処理を使う。
