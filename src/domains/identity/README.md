# 対象の識別

安定ID、Scope内のalias解決、統合と分離を扱う。名前一致だけで対象を統合しない。

機能実装済み: 純粋層（`resolveEntity`、`planMerge`、`planSplit`）と、実SQLiteの同期repository（entity/alias/履歴、merge・split適用、forget用削除）。fixture・一時SQLite（file/WAL・memory）で検証済み。Eumenesのホスト結合・実Memory登録は未受入。

- `index.ts`: 純粋APIの公開入口。
- `contracts/index.ts`: このドメイン固有の公開型。
- `service/`: IOを持たない意味処理。
- `sqlite.ts`: 借りた接続を使う同期APIの公開入口。
- `repository/`: このドメインが所有するSQL・migration。
- `test/`: 純粋試験と実SQLite試験。

公開境界と共通規則は[プロジェクト構造](../../../spec/project-structure.md)を参照。構造準備・機能実装・fixture・実SQL・ホスト結合・実モデル・実機受入は別の段階で、上の記述が各段階の到達点です。
