# 抽出の契約

入力manifest、候補検査、prepareとsettleの意味規則を置く。モデル呼出しとqueueはホストが所有する。

現在は構造準備のみ。公開入口のexportは空で、業務APIは未実装。

- `index.ts`: 純粋APIの公開入口。
- `contracts/index.ts`: このドメイン固有の公開型。
- `service/`: IOを持たない意味処理。
- `sqlite.ts`: 借りた接続を使う同期APIの公開入口。
- `repository/`: このドメインが所有するSQL・migration。
- `test/`: 純粋試験と実SQLite試験。

公開境界と共通規則は[プロジェクト構造](../../../spec/project-structure.md)を参照。予約場所は実装完了を示さない。
