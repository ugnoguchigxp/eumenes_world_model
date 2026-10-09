# 失効と忘却

依存閉包、消去計画、復元時の照合規則を置く。ファイル操作とjournalの耐久保存はホストが所有する。

機能実装済み: 純粋計画（`planInvalidation`、`planForget`）と、実SQLiteの同期repository（gate・墓標・forget進捗・operation受領）。journalの耐久保存はホスト所有で、試験のjournalはfixtureのため未受入。

- `index.ts`: 純粋APIの公開入口。
- `contracts/index.ts`: このドメイン固有の公開型。
- `service/`: IOを持たない意味処理。
- `sqlite.ts`: 借りた接続を使う同期APIの公開入口。
- `repository/`: このドメインが所有するSQL・migration。
- `test/`: 純粋試験と実SQLite試験。

公開境界と共通規則は[プロジェクト構造](../../../spec/project-structure.md)を参照。構造準備・機能実装・fixture・実SQL・ホスト結合・実モデル・実機受入は別の段階で、上の記述が各段階の到達点です。
