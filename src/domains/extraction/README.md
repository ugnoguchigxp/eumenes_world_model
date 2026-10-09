# 抽出の契約

入力manifest、候補検査、prepareとsettleの意味規則を置く。モデル呼出しとqueueはホストが所有する。

機能実装済み: 純粋層（`prepareExtraction`、`validateCandidates`）と、実SQLiteの同期repository（inbox・manifest・checkpoint）。Local推論の呼出しとqueueはホスト所有で、未実装・未受入。fixture・一時SQLiteで検証済み。

- `index.ts`: 純粋APIの公開入口。
- `contracts/index.ts`: このドメイン固有の公開型。
- `service/`: IOを持たない意味処理。
- `sqlite.ts`: 借りた接続を使う同期APIの公開入口。
- `repository/`: このドメインが所有するSQL・migration。
- `test/`: 純粋試験と実SQLite試験。

公開境界と共通規則は[プロジェクト構造](../../../spec/project-structure.md)を参照。構造準備・機能実装・fixture・実SQL・ホスト結合・実モデル・実機受入は別の段階で、上の記述が各段階の到達点です。
