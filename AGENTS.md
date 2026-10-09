# WorldModelの作業規則

- 作業開始時に`initial_instructions`を会話内で一度だけ実行する。ユーザーの明示依頼なしに別Codexチャットへ送信しない。
- 実装の入口は`spec/implementation-plan.md`。現在の完了範囲はP0の構造準備のみ。計画の存在を後続段階の実装指示として扱わない。
- `../SAAA`、`../eumenes`、`../eumenes_memory`は参照専用。製品DB・設定・秘密をコピーしない。
- 純粋層はDB、時計、乱数、ネットワーク、モデル、ホストに依存しない。共通のSourceRef等は契約確定後にMemoryの公開型を使い、仮の複製を作らない。
- `src/domains/*/repository`はホストから借りる同期接続だけを使う。DBのopen/close、transaction制御、PRAGMA、独自writer、queueを持たない。書込みはホストのtransaction内で行う。
- 実SQLiteの接続生成は`test/support`に限定する。標準は一時ファイル＋WAL＋単一writer＋readonly reader。終了・初期化失敗時に一時ディレクトリを回収する。
- 日常検証は`bun run verify`。DB基盤だけの試験は`bun run test:sqlite`。配布形確認は`bun run build`。領域別は`bun run verify -- --domain <name>`。未実装の0件試験は失敗扱い。正式配布consumer試験は後続で追加する。
- 構造準備、機能実装、fixture、実SQL、ホスト結合、実モデル、実機受入を区別する。未実装APIに成功を返す仮実装を作らない。

- ドメインは`src/domains/<name>`がcontracts/service/repository/testを所有する。別domainは公開index.ts・contracts/index.ts・sqlite.tsだけを参照し、scripts/domains.tsに直接依存を宣言する。共通src/contractsはdomainを参照しない。
- index.ts/service/contractsは純粋、sqlite.ts/repositoryは同期永続化の入口。src/infrastructure/sqliteには接続型とmigration集約だけを置く。HTTP/controllerやWriterを追加しない。
- oxfmt/oxlintは本家eumenesの共通設定に準拠。タブ・80桁・correctness error・deny-warningsを維持する。

- 後続実装ではspec/plan/contracts.mdの契約、core-tasks.md/integration-tasks.mdの作業票、acceptance.mdのケースを読み、一票ずつ検証する。完了証拠はspec/plan/progress.mdへ記録する。計画上のAPI・application層・追加コマンドを既存と扱わない。
