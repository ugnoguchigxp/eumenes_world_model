# 予測と結果の照合

仮定のoverlay、比較条件、予測と観測の照合を扱う。保存済みの世界を直接変更しない。

機能実装済み: 純粋層（`compareScenarios`、`assessOutcome`）と、実SQLiteの同期repository（予測・結果の版保存）。overlayは保存しません。fixture・一時SQLiteで検証済み。実運用の実測との接続は未受入。

- `index.ts`: 純粋APIの公開入口。
- `contracts/index.ts`: このドメイン固有の公開型。
- `service/`: IOを持たない意味処理。
- `sqlite.ts`: 借りた接続を使う同期APIの公開入口。
- `repository/`: このドメインが所有するSQL・migration。
- `test/`: 純粋試験と実SQLite試験。

公開境界と共通規則は[プロジェクト構造](../../../spec/project-structure.md)を参照。構造準備・機能実装・fixture・実SQL・ホスト結合・実モデル・実機受入は別の段階で、上の記述が各段階の到達点です。
