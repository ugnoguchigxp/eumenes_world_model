# Eumenes WorldModel

SAAAのPersonal Worldを継承する、独立開発用のWorldModelプロジェクト。P0（構造準備）に加えて、P1（純粋規則）とP2（本体のSQLite永続化）を実装済みです。P3のhost結合とP4/P5の一部はfixtureで検証済みです。実Memoryの復元、journalの実process耐久性、実モデルの正式受入・実運用には残件があります。票別の証拠と制約は実装進捗を参照してください。Codex SDKのLunaを使う独立Exampleでは、実資料から候補を抽出して保存する試験ができます。

推奨構成は、TypeScriptの独立パッケージをEumenesへ組み込み、EumenesのSQLite単一Writer・queue・推論接続を使う方式です。対象・状態・条件・因果・相関・依存を根拠付きで管理し、目標との関係、変更の影響、判断に足りない証拠をエージェントへ返します。

- [実モデル受入から先の統合計画](spec/plan/next-stage.md) — LFM2.5/Lunaの抽出比較、判断品質、実物の一巡、Agency・運用への順序
- [先行研究を取り入れる比較実験](spec/plan/research-experiments.md) — 日本語抽出、引用支持、履歴/Slice比較、条件付き規則の測定と採否
- [実装計画書](spec/implementation-plan.md) — 43作業票・契約・54受入ケース（進捗は[実装進捗](spec/plan/progress.md)）
- [SQLite公開API](spec/world-sqlite-public-api.md) — 実装済みの操作と未受入の範囲
- [プロジェクト構造](spec/project-structure.md) — 配置と依存方向
- [SQLite単体試験と単一Writerへの接続](spec/sqlite-testing.md) — 本体が借りる接続と試験用DBの区別
- [準備状況と検証結果](spec/preparation-status.md)
- [実資料984件のseedとローカル試験](eval/seed/README.md) — `bun run seed:world`で投入・再投入・抽出準備を確認
- [Codex SDK / Lunaでseedを抽出するExample](examples/seed-luna/README.md) — `bun run example:seed-luna`で実モデルから候補保存までを試験
- [WorldModelの実験場](examples/README.md) — seedの有無とWorldModelの整理結果による回答の比較など
- [WorldModelの構造とEumenesへの接続設計](spec/world-model-design.md)
- [591b066レビューへの対応と検証](spec/review-591b066-remediation.md)
- [現行ソースとの対応と調査上の制約](spec/source-inspection.md)
- [SAAAの全体コンセプト](https://chatgpt.com/space/page_9fc5877949748191b556705128f6a2f5)

製品コンセプトの正本は上記Pageです。このディレクトリでは実現方式と公開契約を管理します。独立consumerの配布試験とEumenes側の接続fixtureは実施済みです。製品への導入・実運用受入とは区別しています。Memoryの型は`vendor/eumenes-memory`（ローカル生成、公式リリースではない）に固定しています。

## 開発準備の確認

```sh
bun install --frozen-lockfile
bun run verify
bun run build
```

`verify`は整形、lint、型、domainの公開・依存境界、検証ツールとSQLite基盤の試験を実行します。`build`はこの小さな本体だけからJSと型宣言を`dist/`へ生成します。Bun 1.4.4を使用し、型・整形等の開発依存は隣接Memoryと同じ版へ固定しています。SAAA・Eumenes・Memoryのcheckoutや実モデルは実行に不要です。

DB基盤だけを確認する場合は`bun run test:sqlite`を使います。既定は一時ファイル＋WAL＋単一writer＋readonly readerで、軽い試験用の`:memory:`モードもあります。本体はDBを開かず、ホストが渡す同期接続を利用する想定です。接続を開く処理は`test/support`に限定しています。

純粋API入口（`src/index.ts`）は8domainの純粋規則、SQLite入口（`src/sqlite.ts`）は調整済みの同期操作とmigrationを公開します。試験は一時SQLite上でWorldの保存・再送・忘却・復元を確認するもので、Eumenes結合・実Memory・実モデルの成功を示すものではありません。

## 本家Eumenesとの構造・規約の統一

`src/domains/<name>`に公開入口・contracts・service・repository・testをまとめます。業務SQLは各domainが所有し、`src/infrastructure/sqlite`は接続型とmigration集約を担当します。純粋APIと同期SQLite APIの公開入口を分け、ホストの単一Writerから同じ接続を渡せる構造です。

oxfmtは本家と同じタブ・80桁、oxlintはTypeScript向けの共通ルールを適用しています。domains.tsの依存宣言、別domainの公開入口、循環を検査します。

領域別入口は`bun run verify -- --domain assertions`と`bun run test:domain assertions`です。各domainに試験があり、実行できます（試験0件の領域は未実装として失敗します）。領域別指定でも型検査等は全体へ適用します。

## Memory配布物の固定と更新

`vendor/eumenes-memory/dist/`はリポジトリに含める型・JS配布物です。
0.3.6を元アーカイブのSHA-256とファイル一覧で固定し、さらに
`vendor/eumenes-memory.pin.json`でmanifest自体を固定しています。
verifyは型検査前に、出自・ファイル集合・全ハッシュを検査します。
新しいcheckoutで隣接Memoryを生成する必要はありません。

既存0.3.6はアーカイブ由来の固定を保持します。今後の再生成はcleanなGit checkoutと完全なcommit IDを必須とします。現在の固定と異なる内容なら拒否します。
契約更新として差分を確認した場合だけ`--update-pin`を指定します。

```sh
bun scripts/vendor-memory.ts <clean-memory-checkout> --commit <40桁commit>
```

## 収集キットと実験結果

[grokbot](grokbot/README.md)は、984件の評価資料を集めた際の手順を再現するために同梱した独立した収集キットです。
製品コードからの依存はありません。配布用tarはソースと重複するため管理せず、必要時に次で生成します。

```sh
mkdir -p artifacts
tar -czf artifacts/grokbot.tar.gz --exclude='__pycache__' --exclude='.DS_Store' grokbot
```

通常の受入と探索実験の使い分けは[実験場](examples/README.md)を参照してください。
固定実験の要約と再採点用の圧縮証拠は[fixtures/experiments](fixtures/experiments/README.md)へ分離しています。
新規実行の生出力はGit対象外です。
