# WorldModel 技術品質の再評価（2026年11月5日）

技術品質 **80.3 / 100**、正式評価、根拠充足率100%、確信度Medium。
対象はローカルmain `06e9480`に作業開始時の未コミット変更と今回の改善を加えた状態。
前回と同じrubric 1.1.0、full / deep / library、全30技術項目・同じ重みで評価した。
UnknownをN/Aへ変えて分母を減らしていない。採点器の丸め前は80.25。

これは組込みライブラリの技術品質であり、APIモデルの意味的正確さや本番運用の合格を表さない。
プロジェクトの将来性は実仕事・採用・継続利用の証拠不足を維持し、総合数値を保留する。

前回は69.7点（暫定、根拠充足96.7%、範囲67.4〜70.8）。今回の権利確認で未評価項目も解消したため、
差の全てをコード改善だけの効果とは呼ばない。Expectedの80.4点は現在値の根拠へ使っていない。

## 評価の内訳

| 観点 | 重み | 今回 / 10 | 主な根拠・限界 |
|---|---:|---:|---|
| 設計 | 12 | 8.3 | 純粋層・所有domain・host writer境界。違反import/IOの負例も検出 |
| 正確性 | 20 | 9.2 | 入出力/状態/認可/版/原子性。鮮度保持、17操作、split往復、古いreceipt拒否。意味的抽出品質は別ゲート |
| 安全性 | 10 | 7.5 | 候補権限とScope/墓標、4状態の忘却、秘密非保存。hostのcandidate root指定が必要 |
| 信頼性 | 8 | 8.3 | 各DML rollback、実process終了、commit後の応答喪失、実host/Memory journal。電源断・実Memory process killは未検証 |
| 保守性 | 12 | 6.7 | 配布資料同期と局所的変更。複数evalと長い履歴の負担が残り、負債は2のまま |
| 共通部品 | 5 | 7.5 | Memory公開型・既存規則・host接続と共通API transportを再利用。独自writer/意味辞書を追加しない |
| 試験 | 15 | 8.3 | 旧不具合3失敗、3変異の検出、全DB比較、実consumer。ホストされたCI実績はなく自動化は2のまま |
| 配布・依存・権利 | 10 | 7.5 | 固定pin、実tgz/型/通知、frozen導入、MIT確認。元archive全権利履歴や供給網の網羅監査ではない |
| 性能 | 5 | 7.5 | 1k/10k/100kで固定予算内。合成・単一機・partial。高速化やhost queueの性能は主張しない |
| 導入・操作・復旧 | 3 | 7.5 | 新規導入、公開SDK操作、失敗取消、forget、process再起動、旧配布物への切戻しとjournal復元 |

Anchor4は設計境界、契約、単一writer内の並行/原子性、部分失敗、重要リスク試験、試験品質。
各項目に実行根拠・反対条件・適用限界を台帳へ記録した。4を実運用や未検証の意味品質へ拡張しない。

## 改善と残る条件

- F01: 投影の鮮度が探索へ渡ると消える問題を修正。fresh/stale/unknownが影響・関連・依存・Gap・scenarioへ残る。confirmedの意味は条件充足のまま。staleを真偽へ置換しない。
- F02: source/state rootだけではmanifestなしinboxを自動発見できない契約上の制約は維持。4状態の明示candidate rootと既存host source-event経路は検証済み。他host/新しいstate由来inboxではroot供給の確認を必要とする。既存共通機構で成立するため索引やmigrationを追加しなかった。
- F03: Memory peerDependenciesの文書を実際の型依存manifest・両tgz導入へ同期。rootと固定MemoryのMIT通知を配布し、所有者確認と出自を記録。
- sourceIdentityKeyの既存実装を公開。clean consumerで必要だったroot識別の符号化を利用側へ複製しない。
- APIは既存extraction/decisionに接続する共通transport。zprofileの参照を使い、予算予約・不明請求・失敗・source固定を記録。通常verifyはAPIを呼ばない。

未解消のMedium指摘はF02の他host向けの接続条件1件。Critical/Highの確定指摘・未解決疑義による上限はない。
API抽出の品質未達、Local正式受入、ホストされたCI、24時間運用を達成扱いにしない。

## 検証

部分→結合→全体の順で実行。最終固定コピーの`bun install --frozen-lockfile`は14パッケージを新規導入。
`bun run verify`は **1078 pass / 0 fail / 19532 assertions / 90 files**。
整形・lint・型・domain境界・SQLite・配布consumerを含む。`bun run build`成功。
実hostの使い捨てコピーと最終tgzで **62 pass / 0 fail / 796 assertions**。
稼働host・製品DB・設定・秘密は変更していない。

固定ソースの前後digestは一致：`4a826c7737b196ddc96a8ef94560257b9684a1a34a9972a8715237f674e9b5f7`。
これはM0定義のsrc/eval/scripts/fixtures/performance/test/support/vendorとconfigのdigest。
全ファイルをcommit番号だけで識別せず、試験・文書を含む作業差分も別のhash一覧で照合する。

性能はSlice p95 10.67 / 9.57 / 12.19ms、通常writer p95 1.03 / 0.80 / 0.81ms（1k/10k/100k）。
最大取得500行、無索引0、100k再構築2954ms。10kの50ms/20ms予算内だが、原典よりの優位や本番値ではない。

## API比較

モデルは`gpt-6-luna`と`claude-haiku-5-5`。抽出は対照400件・追補2が400件・追補3のdev200件を実行した。
各行100件。4率とも95%以上、範囲漏洩・引用不整合・忘却後復活・仮説の実測化は0許容を維持した。全版で未達。

| 指示 | モデル | 集合 | 採用precision | 採用recall | 保留recall | 区分正解 | 違反数* |
|---|---|---|---:|---:|---:|---:|---|
| 原指示 | Luna | dev | 90.0% | 13.6% | 100% | 100% | 0/0/0/0 |
| 原指示 | Luna | holdout | 100% | 13.6% | 100% | 90.0% | 0/0/0/0 |
| 原指示 | Claude | dev | 100% | 15.2% | 100% | 93.3% | 0/0/0/0 |
| 原指示 | Claude | holdout | 88.9% | 12.1% | 100% | 90.0% | 0/0/0/0 |
| 型形式追補2 | Luna | dev | 62.9% | 33.3% | 100% | 100% | 0/0/0/0 |
| 型形式追補2 | Luna | holdout | 51.4% | 27.3% | 91.2% | 86.7% | 0/3/0/0 |
| 型形式追補2 | Claude | dev | 92.7% | 54.5% | 97.1% | 96.7% | 0/2/0/0 |
| 型形式追補2 | Claude | holdout | 81.8% | 50.0% | 91.2% | 93.3% | 0/3/0/0 |
| 関係/条件追補3 | Luna | dev | 52.5% | 47.0% | 94.1% | 100% | 0/5/2/0 |
| 関係/条件追補3 | Claude | dev | 86.2% | 77.3% | 94.1% | 93.3% | 0/5/1/0 |

*違反数は範囲/引用/忘却後復活/仮説の順。原指示Luna devの無効出力1件も分母へ残した。
recallを上げてもprecision・保留・0許容項目が悪化したため、品質改善として採用しない。
追補3はdevで停止し、その版のholdoutは未実行。既存holdoutは既知集合であり未見の一般化証拠とは呼ばない。

引用違反には既存検証器が拒否した引用不整合も含む。忘却後復活は評価上のforgotten発話/主張からの再候補化であり、
runnerは全sourceをavailableとして渡す。永続化済みforget/journalの試験とは区別する。
実SQLでは忘却後の再登録・settle・再送拒否と本文0を別に確認した。この区別でAPIの0許容を緩めてはいない。

既存の判断20仕事（評価用15・調整用5）×4条件×両社も直接APIで実行した。World対Memory-onlyの自動判定ではLunaが評価用4件改善・全仕事5件悪化・比較不能4件、
Claudeが評価用11件改善・全仕事1件悪化・比較不能2件。両社とも受入未達。
従来のplain-facts対照は条件等のmetadataを落とす方式で、要判定も残り、表示構造の寄与は判定不能。語句採点の曖昧な例を人が確定していない。
手書きWorldを使う従来の診断であり、自動抽出した本体pipelineの効果へ転用しない。
元のremote注記は旧評価器由来の説明を含むため、直接HTTP実行のprovenanceを別記した。元レポートは変更していない。

合計**1167 POST要求**。報告usageを高めの入力単価で計上した額0.656022 USDと、400応答2件の未確定予約0.013605 USDを合わせ、
**保守的上限0.669627 USD（約0.67ドル）**。10ドル以内。これは請求明細の実額ではない。
台帳lockは解放済み、再試行・追加呼出しなし。標準単価の参照は[OpenAI料金](https://developers.openai.com/api/docs/pricing)と
[Claude料金](https://platform.claude.com/docs/en/about-claude/pricing)。割引を仮定せず、キャッシュ分も保守的に計上した。

全runはremoteでLocal/P5正式受入はfalse。追補を既存製品providerや自動採用経路へ採用していない。
独立60件、新規40仕事の2×2交差、盲検judge、ホストされたCIは未実施。
既存抽出ゲートを満たさない結果で後続の品質受入・Worldの優位を主張しない。**計画全体の完了は技術80点と区別する。**

dataset・採点器・runner・候補検証器とdev可視入力のhashは各版で一致。指示・実行順等の複合差を含む記述比較であり、因果効果の推定ではない。
初回抽出400件のrequest IDは未保存。後続は台帳に記録した。元レポート・各版のsource前後一致と比較条件を`api-comparability.json`へ残す。

最終再検証で、ファイルを変更して元へ戻すとOS通知が欠けるケースを検出した。
計測器へ更新時刻・inodeの実行前後照合を追加し、portableなsource/protocol digestには混ぜない。
通知を無効にした隔離コピーでも既存試験が成功し、更新時刻の照合も取り除くと失敗することを確認。
待ち時間や期待値を緩めず、最後の固定全体検証は1078件成功した。

## 証拠と再確認

証拠ディレクトリは`artifacts/quality-80/2026-11-05/`。
`review-current.json`が全30項目の台帳、`score-current.json`が採点器の計算結果。
`final-source*.json`、`diff-scope.json`、`final-clean-verify.log`、`host-final-verify.log`、
`package-rollback.json`、`negative-controls.json`、`api-budget.jsonl`と各runのmanifest/reportを保持する。
[検証の範囲](quality-80-evidence.md)と[進捗の正本](progress.md)も参照。

次の確認は、devで残った契約/意味の失敗を分け、未見の追加群と実モデル通し評価の条件を固定すること。
外部API結果を正式Localモデル、実仕事や24時間の受入へ置き換えない。


## API品質追補後の技術再評価（2026年11月5日）

同じ30項目・同じlibrary profileと重みで再計算し、**80.3点、正式、根拠充足100%、確信度Medium**を維持した。除外重み0、アンカー値の変更0。製品srcは前回評価対象と同一で、新しい評価経路を含む固定コピーのverifyは1086 pass/0 fail、build成功。API品質と技術評点の適用範囲を変更していない。CIの点数も増やしていない。

[API品質の原因・全結果・未達条件](api-quality.md)を記録した。既存800抽出・独立240抽出・通し320比較/1280回答枠と追加の順序均等採点を実行し、累積費用上限は2.93 USD以内。引用の構造的な不整合は改善したが、別集合での率・読取りの過剰保留・補助採点不一致などが残る。API受入、Local/P5、本番受入の合格とはしない。兄弟repo・本流への取り込みは行っていない。

対象M0：`c3823ad6659ecc078d6a226a9ccb4d53dd4612d52be0b385d1f636e59ba9891a`。全ソースarchive SHA256：`68bccd5eb8a7e57fbd005a97d9666f42d516626d455b07baba656edb955bb2c5`。今回の再評価台帳・計算結果は`artifacts/api-quality/2026-11-05/review-final.json`と`score-final.json`。前節の数値・実行記録は過去snapshotの記録として保持する。


## 2026年11月6日の再評価

同じrubric1.1.0/full/deep/library、全30項目・同じ重み・適用範囲で**技術品質80.3/100、正式、根拠充足100%、確信度Medium、除外0**を維持した。アンカーの変更0、Expected80.4の流用なし。src143ファイルは前回評価対象と同一で、現在の評価adapter/回帰試験を含む全verifyは1094 pass/0 fail/19635 assertions/93 files、build成功。CIの実績を加点していない。将来性の正式数値は保留する。

全40仕事の候補Worldは4組合せすべて40/40、原文より評価用12〜13件改善・悪化0。新規確認60例も両API合格。共通selectorへの述語定義供給と、reader/judge間の実metadata共有で保留・誤判定を改善した。ただし既存native holdout、旧独立Luna意味56/60、旧対照の安全性は未達のまま。**API全基準の合格、計画全体の達成、Local/P5・実運用の受入とはしない。** 詳細・全失敗・次票は[最新のAPI品質記録](api-quality.md)に保持した。

累積上限9.3576366 USD（過去分・未確定予約を含む）、10 USD以内。CI、本流/兄弟repoへの統合は実施していない。台帳の旧記録を減額せず、回答の再生成や判定の良い部分だけの採用は行わない。

現在M0：`df0d414fc74194a67b3ccb16ffa0c6ff70055a2a3218fc410a9fc67413fb851d`。固定archiveはsource-context83.tgz、SHA256 `4c6f22fa50519a32204d91c1a61e86d8c5f09f8b72def187010052e52e7ea2a2`。全403 M0ファイルの一致を確認。正式再計算は`artifacts/api-quality-next/2026-11-05/review-technical83.json`と`score-technical83.json`、元評価との143src同一性はtechnical-comparability83.json。各時点の以前の数値・ソース・試験記録は、そのsnapshotの履歴として維持する。
