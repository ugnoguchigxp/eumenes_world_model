# Eumenes WorldModel

SAAAのPersonal Worldを継承する、独立開発用のWorldModelプロジェクト。現在はP0の事前準備までです。業務機能と製品schemaは未実装です。

推奨構成は、TypeScriptの独立パッケージをEumenesへ組み込み、EumenesのSQLite単一Writer・queue・推論接続を使う方式です。対象・状態・条件・因果・相関・依存を根拠付きで管理し、目標との関係、変更の影響、判断に足りない証拠をエージェントへ返します。

- [実装計画書](spec/implementation-plan.md) — P0の完了範囲と、43作業票・契約・54受入ケース
- [プロジェクト構造](spec/project-structure.md) — 配置と依存方向
- [SQLite単体試験と単一Writerへの接続](spec/sqlite-testing.md) — 本体が借りる接続と試験用DBの区別
- [準備状況と検証結果](spec/preparation-status.md)
- [WorldModelの構造とEumenesへの接続設計](spec/world-model-design.md)
- [現行ソースとの対応と調査上の制約](spec/source-inspection.md)
- [SAAAの全体コンセプト](https://chatgpt.com/space/page_9fc5877949748191b556705128f6a2f5)

製品コンセプトの正本は上記Pageです。このディレクトリでは実現方式と公開契約を管理します。正式パッケージ配布、Eumenesへの接続はまだ行っていません。

## 開発準備の確認

```sh
bun install --frozen-lockfile
bun run verify
bun run build
```

`verify`は整形、lint、型、domainの公開・依存境界、検証ツールとSQLite基盤の試験を実行します。`build`はこの小さな本体だけからJSと型宣言を`dist/`へ生成します。Bun 1.4.2で確認し、型・整形等の開発依存は隣接Memoryと同じ版へ固定しています。SAAA・Eumenes・Memoryのcheckoutや実モデルは実行に不要です。

DB基盤だけを確認する場合は`bun run test:sqlite`を使います。既定は一時ファイル＋WAL＋単一writer＋readonly readerで、軽い試験用の`:memory:`モードもあります。本体はDBを開かず、ホストが渡す同期接続を利用する想定です。接続を開く処理は`test/support`に限定しています。

現在の純粋API入口は空、SQLite入口は接続型と空のmigration一覧だけです。試験はcommit/rollbackや接続分離を確認するもので、Worldの保存・検索・忘却やEumenes結合の完成を示すものではありません。

## 本家Eumenesとの構造・規約の統一

`src/domains/<name>`に公開入口・contracts・service・repository・testをまとめます。業務SQLは各domainが所有し、`src/infrastructure/sqlite`は接続型とmigration集約を担当します。純粋APIと同期SQLite APIの公開入口を分け、ホストの単一Writerから同じ接続を渡せる構造です。

oxfmtは本家と同じタブ・80桁、oxlintはTypeScript向けの共通ルールを適用しています。domains.tsの依存宣言、別domainの公開入口、循環を検査します。

領域別入口は`bun run verify -- --domain assertions`と`bun run test:domain assertions`です。現在は予約した8domainすべてが試験0件のため失敗します。機能実装後に利用する入口であり、今の準備確認には全体verifyとtest:sqliteを使ってください。領域別指定でも型検査等は全体へ適用します。
