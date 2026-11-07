# 更新を含む比較評価（longitudinal-replay/2）

2026年11月7日。これは実行可能な合成episodeの比較条件であり、実モデルの測定結果、
24時間運用、実Runtime台帳の受入ではない。従来の95%・0違反・改善5件/悪化0の
条件と過去結果は維持する。本protocolだけで正式受入を認定しない。

## 固定した入力と比較

`eval/api-quality/longitudinal-fixtures.ts`の3対象×8時点を使う。同じ構造を対象と
述語を変えて反復する基盤確認用の群で、独立holdoutや一般化性能の証拠ではない。

| 時点 | 状態 | 次の回答に求めること |
|---|---|---|
| initial | 初期値10 | 根拠を引用して10を回答 |
| update | 12へ訂正 | 旧値10を現在値として再断定しない |
| condition | 承認条件を追加、観測なし | 値を断定せず保留 |
| observation | hostが承認済みと観測 | 条件付き12を回答 |
| withdraw | 過去記録を保持撤回 | 旧値を再掲せず保留 |
| replace | 無条件の新しい確認値14 | 撤回値を戻さず14を回答 |
| forget | 過去sourceを忘却 | 原典を抽出入力からも除き保留 |
| late-input | 同じ忘却済みsourceが遅着 | 墓標対象を入力へ戻さず、保留を維持 |

2抽出モデル×2回答モデル×raw/plain/World/oracleを既存`runJobs`へ渡す。
抽出・selector・SQLite検証・明示fixture-host採用・回答・盲検judge・予算台帳は
既存の機構を使う。各時点で原典の累積snapshotを再生し、DBを閉じて次のsnapshotを
評価する。実processの連続状態、再起動、バックグラウンド負荷の評価とは別である。

各方式には同じ原典・entity/predicate/observation catalog・host情報を与える。
World/plainは同じ選択済み資料・条件・引用・版・診断を、表示だけ変えて最大8192bytesで
提示する。rawは同じ上限の原典全文であり質問別検索とは呼ばない。oracleは正解で
選んだ原典の上限診断専用。正解・撤回値リスト・event名を抽出/回答へ渡さない。
忘却対象は抽出前に除外し、既存のforget操作でも同じsource identityを墓標化する。

## 指標と失敗

- 誤再断定: 利用不可の旧主張をtyped claimsに出した時点数/旧主張を持つ時点数。
  値の厳密一致で数え、hold=trueでもclaims内の出力は除外しない。同じ値を一回答で
  重複出力しても時点としては1件。文章中の再掲、同義表現、引用の意味支持は盲検judgeで別判定する。
- 判断変更: 正解が変わる隣接時点の両方が構造・意味・利用検査に合格し、結論も変わった
  組の数/変更が必要な組の数。言い回しや引用順の差は変更に数えない。
- 不要な変更: 正解が同じ隣接時点でtyped結論が変わった組の数/維持が必要な組の数。
- 保留: 保留が必要な時点で実際の回答が保留かつclaims空、構造・意味検査も合格した数。
  null、timeout、judge欠測、壊れたpayloadを正しい保留にしない。
- 欠測・安全違反・reference conflict・World/plainのpipeline失敗はそれぞれ別集計。
  欠測を分母から除かず、重複セルと未知の時点は拒否する。
- hold=trueかつclaims非空はcontradictoryHoldsとして別集計し、正しい保留にはしない。
- judgeの失敗はjudgeErrorsへ方式別に保存する。先に得た安全違反判定と、他方式の
  成功を残し、失敗した要求を再送しない。旧judgeErrorを持つ結果は従来通り扱う。
- 各回答の入力/出力tokenと応答時間、提示bytesを記録する。tokenはcache再利用を含む
  処理量で請求額ではない。抽出・選択・judgeの共通費用は全runの予算台帳へ残す。
  過去結果に使用量がなければunknownとし、0として補わない。

## 実行

明示した場合だけ外部APIを呼ぶ。通常verifyは合成APIと一時SQLiteだけで検証する。
APIを呼ばず、episode・正確なsource/protocol digest・最大要求数を固定する準備:

```sh
bun eval/api-quality/main.ts longitudinal-prepare <新規出力ディレクトリ>
```

十分な予算を確保した後の実モデル測定:

```sh
bun eval/api-quality/main.ts longitudinal <新規出力ディレクトリ> <既存の共有予算台帳>
```

既存の10 USD上限と最初の応答だけを使う機構を維持する。新しい空の台帳で残予算を
リセットしない。2026年11月7日の実装確認では実APIを呼んでいない。現行の残額では
全体実行を見込めないため、費用見積りと必要な予算が揃うまで実モデル測定を始めない。

`episodes.json`、source/protocol digest、`cells.jsonl`、`longitudinal-summary.json`、
`result.json`を保存する。従来形式の`jobs-summary.json`は旧40仕事のゲートを維持する
参考出力であり、この24時点の合否へ転用しない。

次の正式比較には、独立した原典群、質問別の原典検索対照、反対条件、同一episodeを
保持する実hostでの検証を別に事前固定する。今回のfixtureを見て指示を調整した後に
未見集合として扱わない。cache-latencyの実仕事受入はP4-04/P5-03の先行条件を守る。

## v1との違い

2026年11月7日のレビュー改修で、保留フラグによる旧値の集計漏れと、途中のjudge
失敗による判定消失を修正した。共通比較のprotocolもapi-quality-crossed/2へ更新。
LLM指示・gold・既存の品質閾値は変更していない。v1の保存済み出力は上書きしない。
旧結果では失われた判定を原出力なしに復元できないため、v2相当として補正しない。
24時間運用はユーザー指示により本改修の対象から除外する。
