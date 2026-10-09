# 条件と時間

三値条件、期間、単位、鮮度を扱う。時刻は引数で受け取る。

P1-03実装済み（純粋層のみ）: `evaluateConditions`（三値条件評価）と`compareValidity`（validTime判定）。SQL・repositoryは未実装。

- `index.ts`: 純粋APIの公開入口。
- `contracts/index.ts`: このドメイン固有の公開型。
- `service/`: IOを持たない意味処理。
- `sqlite.ts`: 借りた接続を使う同期APIの公開入口。
- `repository/`: このドメインが所有するSQL・migration。
- `test/`: 純粋試験と実SQLite試験。

公開境界と共通規則は[プロジェクト構造](../../../spec/project-structure.md)を参照。予約場所は実装完了を示さない。
