# WorldModelの実験場

このディレクトリは、WorldModelをこのプロジェクト内で試す実験を置く。
本体の公開契約やEumenesとの結合の完了を意味しない。

| 実験 | 内容 | 実行 |
|---|---|---|
| [seed-luna](seed-luna/README.md) | 実資料5件と攻撃用合成1件から、Lunaが引用付き候補を抽出して保存 | `bun run example:seed-luna` |
| [seed-answer-comparison](seed-answer-comparison/README.md) | 資料なし／資料全文／同じ資料＋WorldModelの整理結果を比較 | `bun run example:seed-compare --extraction-run <抽出Exampleの実行先>` |
| [multi-source-comparison](multi-source-comparison/README.md) | 複数資料の矛盾・訂正・施行日・三値条件を、全文／全文＋WorldModelで比較 | `bun run example:multi-source` |
| [linked-answer-holdout](linked-answer-holdout/README.md) | 新規8資料群・32問で、規程と計算を分離した回答／対応付けた回答を比較 | 固定コードから実行する手順は実験READMEを参照 |
| [source-role-comparison](source-role-comparison/README.md) | v5／資料の役割を明示する形式を比較。新形式は悪化したため不採用 | 固定コードから実行する手順は実験READMEを参照 |

モデル不要の984件の投入・再投入試験は、[eval/seed](../eval/seed/README.md) が担当する。
`bun run seed:world` で実行できる。

## 実験を追加するとき

- 何を比較し、何を一定にするか、対象データ、期待する内容、判定方法を実行前に定義する。
  採点基準や提示順を結果に合わせて書き換えず、変更したら別版として残す。
- 意味の判断はモデルが行い、プログラムは入出力、ハッシュ・契約の検査、実行と保存、
  条件式など既存の決定的な計算を担当する。質問の語句で回答や分類を固定しない。
- 既存の純粋API・同期SQLite公開API・test/supportの接続生成を再利用する。
  実験用の都合で製品コードや契約の検査を緩めない。
- 実資料・モデル出力・採点・合成fixtureを区別する。採用状態も実験の条件として明記する。
  実験用の一時DBで成功したことを、製品への投入や原典の真実性の保証としない。
- モデル・指示・実行条件・資料digest・生出力・失敗・使用量をローカルの `artifacts/` に残す。
  小標本、手で選んだ資料、同じモデルによる採点など、結果の適用限界も記録する。
- 通常のverifyはモデルを呼ばない。モデル不要の部分と、実モデルの実行を分けて検証する。

SDKの接続・隔離・時間上限は、現時点では `seed-luna/luna.ts` の実装を共有する。
実験固有の指示は引数で渡し、新しい回答・採点のスレッドごとに文脈を分ける。

- [抽出拒否の回復比較](extraction-fallback-comparison/README.md): 原文切替と1回の再抽出を計測。再抽出で44停止回答を回復・判定56/56。ただし適用資料集合の誤りが5件あり、既定v5は維持。
- [適用資料集合と履歴参照の比較](operative-sources-comparison/README.md): 指示の補足だけで撤回済み資料の混入4件→0件、主指標44/48→48/48。未見群は双方32/32で優位差は未確認。既存v5を維持し、独立候補として保存。
