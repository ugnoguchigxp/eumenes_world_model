# 予測と結果の照合

仮定のoverlay、比較条件、予測と観測の照合を扱う。保存済みの世界を直接変更しない。

現在は構造準備のみ。公開入口のexportは空で、業務APIは未実装。

- `index.ts`: 純粋APIの公開入口。
- `contracts/index.ts`: このドメイン固有の公開型。
- `service/`: IOを持たない意味処理。
- `sqlite.ts`: 借りた接続を使う同期APIの公開入口。
- `repository/`: このドメインが所有するSQL・migration。
- `test/`: 純粋試験と実SQLite試験。

公開境界と共通規則は[プロジェクト構造](../../../spec/project-structure.md)を参照。予約場所は実装完了を示さない。
