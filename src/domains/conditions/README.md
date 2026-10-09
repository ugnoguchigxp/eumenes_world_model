# 条件と時間

三値条件、期間、単位、鮮度を扱う。時刻は引数で受け取る。

機能実装済み（純粋層のみ）: `evaluateConditions`、`compareValidity`と三値の`and3`/`or3`/`not3`。このドメインはworld_表を所有せず、SQL・repositoryはありません（条件ASTは主張のpayloadとして保持）。実モデル・ホスト結合は対象外。

- `index.ts`: 純粋APIの公開入口。
- `contracts/index.ts`: このドメイン固有の公開型。
- `service/`: IOを持たない意味処理。
- `sqlite.ts`: 借りた接続を使う同期APIの公開入口。
- `repository/`: このドメインが所有するSQL・migration。
- `test/`: 純粋試験と実SQLite試験。

公開境界と共通規則は[プロジェクト構造](../../../spec/project-structure.md)を参照。構造準備・機能実装・fixture・実SQL・ホスト結合・実モデル・実機受入は別の段階で、上の記述が各段階の到達点です。
