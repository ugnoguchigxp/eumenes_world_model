# 判断用の探索

関連、因果、依存の探索とResearchGapを扱う。検索の上限と不完全性を返す。

機能実装済み（純粋層のみ）: `explainRelevance`、`traceInfluence`、`checkDependencies`、`findResearchGaps`。永続tableは持たず、repositoryはありません。実モデル・ホスト結合は対象外。

- `index.ts`: 純粋APIの公開入口。
- `contracts/index.ts`: このドメイン固有の公開型。
- `service/`: IOを持たない意味処理。
- `sqlite.ts`: 借りた接続を使う同期APIの公開入口。
- `repository/`: このドメインが所有するSQL・migration。
- `test/`: 純粋試験と実SQLite試験。

公開境界と共通規則は[プロジェクト構造](../../../spec/project-structure.md)を参照。構造準備・機能実装・fixture・実SQL・ホスト結合・実モデル・実機受入は別の段階で、上の記述が各段階の到達点です。
