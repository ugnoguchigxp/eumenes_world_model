# 運用手順(P6-04、W側の骨子)

2026年10月9日。手順の定義であり、**いずれも使い捨て運用環境で未実施**(A54)。製品DBの初期化や既存設定のリセットで不整合を隠さない。旧SAAAデータの一括移行は本計画に含まない。

| 手順 | 内容 | 期待 | 状態 |
|---|---|---|---|
| clean install | `bun run pack:local`のtgzとMemory固定tgzだけをinstall。migrationをhostの配列末尾へ追加 | schema互換検査がcurrent | consumer試験(A34)で配布物とmigration適用のみ確認。host未実施 |
| 固定版upgrade | 新tgz導入後、未適用migrationだけ追加。適用済みhashの変更はblocked | `SCHEMA_INCOMPATIBLE`なら利用停止 | migration試験(A22)で純粋/SQL部分のみ。host未実施 |
| World停止 | World OFFでもforget受付と処理を継続 | 忘却が停止しない | 未実施 |
| schema不一致 | 公開操作がblocked/SCHEMA_INCOMPATIBLEを返し、world_表に触れない | 利用停止 | SQL試験で確認。host未実施 |
| journal復元 | 古いDB＋新journalから再照合まで起動gateを閉じる | 最新忘却を維持 | fixture journalのみ(A32)。実journalは未実施 |
| 墓標を維持したrollback | 旧DB復元後も墓標・権限撤回を再適用 | 復活0 | 未実施 |
| Provider停止 | 抽出を止めても会話とforgetは継続、Cloud fallbackなし | 継続 | 未実施 |
| 再同期 | Scope集合/restoreEpoch変更でcursor破棄し再同期 | 欠落0 | 未実施 |

## 到達状態の読み方

実装/fixture/実SQL/host結合/実モデル/実運用を[進捗表](plan/progress.md)で別々に追う。限定・未受入を隠して「全体完成」としない。
