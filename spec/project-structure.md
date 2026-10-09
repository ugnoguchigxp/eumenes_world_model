# WorldModelのプロジェクト構造

現在はP0の開発準備。Worldの業務API・製品schemaは未実装で、SQLite接続ポートと試験用hostだけが実行可能である。本家Eumenesに合わせ、意味処理・SQL・固有試験をドメインごとに所有する構造へ整理した。

```text
eumenes_world_model/
  AGENTS.md / README.md
  package.json / bun.lock         Bun、固定した開発依存、runtime依存なし
  .oxfmtrc.json / .oxlintrc.json   本家と共通の整形・lint規約
  tsconfig.json                   本体・試験・ツールのstrict型検査
  tsconfig.build.json             本体のみJS・型宣言生成
  src/
    index.ts                      パッケージの純粋API入口、現在は空
    sqlite.ts                     同期SQLite API入口、接続型と空のmigrations
    contracts/index.ts            ドメインを跨ぐ最小の共通型、現在は空
    domains/
      identity/                   対象解決、alias、統合・分離
      assertions/                 主張、採用、訂正、競合、遷移
      conditions/                 条件、期間、三値、単位、鮮度
      projection/                 現在状態、WorldSlice
      reasoning/                  関連・因果・依存の探索、ResearchGap
      scenarios/                  仮定比較、予測と観測の照合
      extraction/                 入力manifest、候補検査、採否
      lifecycle/                  失効、忘却、再構築
        # 全domainに同じ構造を用意
        index.ts                  純粋APIの公開入口
        sqlite.ts                 同期永続APIの公開入口
        contracts/index.ts        domain固有の公開型
        service/                  純粋な意味処理
        repository/               所有するworld_表のSQL・migration
        test/                     純粋試験・実SQLite試験
    infrastructure/sqlite/
      db.ts                       借りた接続の構造型
      migrations/index.ts         domainのmigration順序を集約、現在は空
  test/
    support/sqlite-store.ts        接続を開く試験用host
    sqlite/store.test.ts           host基盤の原子性・分離・回収
    tooling/boundaries.test.ts     公開境界・依存宣言・検証ツールの回帰試験
    scenario/                     domain横断シナリオの予約場所
    consumer/                     正式配布物試験の予約場所
  fixtures/ / eval/                固定fixtureと実モデル評価を分離
  scripts/
    domains.ts                    所有範囲・直接依存の正本
    boundaries.ts                 公開境界・層・IO規則
    check-boundaries.ts            本体全体へ境界検査を適用
    test-domain.ts                指定domainの試験を実行、0件は失敗
    verify.ts                     全体またはdomain指定の検証入口
    files.ts                      ファイル列挙
  spec/                           設計・実装計画・準備記録
  dist/                           生成物、保存対象外
```

予約場所には責務のREADMEと空のexportだけを置く。空のexportはimport境界を予約するもので、成功を返す仮の業務APIではない。

## 本家と合わせた規則

| 本家Eumenes | このライブラリ |
|---|---|
| api/domains/<name>が業務・SQL・試験を所有 | src/domains/<name>が同じ責務を所有 |
| index.tsとcontractsの公開面 | index.ts・contracts/index.ts。DBを純粋APIから分離するためsqlite.tsを追加 |
| scripts/domains.tsでdependsを宣言 | 同じ方式。未宣言の参照・循環・未知domainを拒否 |
| --domain指定で日常試験 | test:domain、verify -- --domain。0件は未実装として失敗 |
| oxfmtのタブ・80桁・二重引用符等 | 同じ設定と版。Markdownと生成物は整形対象外 |
| oxlintのcorrectness error、deny-warnings | 同じ設定と版。typescript/unicorn/oxcを採用 |

本家の[domain定義](../../eumenes/scripts/domains.ts)、[整形設定](../../eumenes/.oxfmtrc.json)、[lint設定](../../eumenes/.oxlintrc.json)を参照した。HTTP/controller・React/JSX用lint・ブラウザ試験・OS lockはこの独立ライブラリの準備には導入しない。本家のWriterはEumenesが所有する。

## 依存方向と公開境界

共通contractsは最下位。各domainのcontractsは共通型と宣言済み依存先のcontractsを参照できる。serviceは純粋処理を所有し、repositoryはserviceと接続型を利用できる。serviceからrepository、sqlite.ts、SQLite基盤への参照は禁止する。

別domainを利用するときは、そのindex.ts、contracts/index.ts、sqlite.tsだけを使う。実装のservice/repositoryへ直接入らない。製品コードはdomains.tsに直接依存を宣言し、domain内試験はその推移的な依存先の公開面まで利用できる。内部からパッケージ最上位のbarrelを参照しない。現在は実処理間の参照がないためdependsはすべて空で、P1以降に実際の参照を追加するときに宣言する。

各repositoryは自分の表を所有する。複数domainの更新には同一の借りた接続と公開sqlite操作を使い、transactionの開始・commit・rollbackはホストが担当する。共通SQLite基盤はDB接続型とmigrationの順序集約のみを担当し、業務SQLの集積場所にはしない。migrationの定義は各repository、安定した適用順・版の集約はinfrastructure、実際の適用と記録はホストが所有する。

境界検査はstatic import・re-export・import型、domain依存と循環、純粋/永続の方向、主要なIO global、同期性、文字列で直接書いたtransaction/PRAGMA SQLを検査する。任意の別名・計算されたSQL・間接呼出しまで検出するsandboxではない。domain内部のファイル間循環と表のSQL所有権はレビュー・実装試験で補う。

本体の外部importは現在禁止。Memory共通型の採用時に、公開された型だけのallowlistへ拡張する。隣接sourceへのimportとruntime依存は引き続き禁止する。

## 試験と検証の粒度

固有試験は各domain/testの*.test.ts（または*.spec.ts）へ置く。純粋試験と、そのdomainのrepositoryを実SQLiteで動かす試験を同じ所有範囲に含める。接続生成はtest/supportだけに置き、domainのSQLite試験はそれを利用する。test/sqliteは共通hostの試験、test/scenarioはdomain横断の受入を所有する。

```sh
bun run verify                         # 全体の整形・lint・型・境界・試験
bun run verify:all                     # 同じ全体検証の明示入口
bun run test:sqlite                    # 実SQLite host基盤
bun run test:domain assertions         # 現在は試験0件のため失敗
bun run verify -- --domain assertions  # 同上。実装後の領域別入口
bun run build                         # 本体のみJS・型宣言生成
```

domain指定では所有パスと宣言上の依存閉包を表示する。現段階では試験選択だけを絞り、format/lint/type/boundaryは小さいパッケージ全体を確認する。型検査までdomain単位に分離したとは扱わない。将来、検査時間を計測して必要なら型検査の依存閉包に限定する。0件試験は失敗し、未知domainや未対応引数も拒否する。全体検証の成功は、予約した8domainの業務機能の完成を示さない。

## 配布境界

buildはdomainのtestディレクトリ・test/specファイル・試験hostを除外する。package exportsはP0のローカル開発用TS入口のままで、正式配布manifest・tarball・consumer試験はP3で追加する。Eumenesへ本依存としてまだ登録しない。

単独checkoutとbun install --frozen-lockfileで検証可能。隣接リポジトリへのリンクは調査資料だけで、ソース・検証・lockfileは隣接checkoutを必要としない。

## 後続計画で追加する構造

[詳細実装計画](implementation-plan.md)のP2-04で`src/application/sqlite/`を追加する予定。複数domainの公開操作を同じ借りた接続で組み合わせ、訂正・投影・墓標・再送receiptの整合を取る。domainからこの上位層へ依存しない。transactionとWriterは引き続きホストが所有する。

現時点でこのディレクトリや業務APIは存在しない。P2ではSQLite基盤へschema版/hashメタデータも追加するが、業務SQLは各repositoryに残す。詳細契約は[実装契約](plan/contracts.md)、進捗は[実装進捗](plan/progress.md)を参照する。
