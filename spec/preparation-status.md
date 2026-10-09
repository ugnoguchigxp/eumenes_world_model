# 開発準備の状況

2026年10月9日。この文書はP0（構造準備）時点の記録で、後半は当時の状態を残す。現在はP1（純粋規則）とP2（本体のSQLite永続化）まで実装済みで、証拠は[実装進捗](plan/progress.md)を正本とする。Eumenesとの接続（P3以降）、実Memory登録、journalの耐久性、実モデルは未着手・未受入。

## 作成したもの

- 本家Eumenesに合わせた8domainの配置と責務、P0からP6までの作業票と受入条件。
- 各domainの公開入口・contracts・service・repository・test、依存宣言と公開境界検査。
- 本家と揃えたoxfmt/oxlint設定、domain指定の検証入口（0件試験は失敗）。
- TypeScriptの純粋入口、SQLite入口、ホストから借りるWorldDb型、空のmigration一覧。
- 一時ファイル/WAL/readonly readerとin-memoryに対応する試験host。
- 型、lint、整形、ソース境界、試験を順に実行するverifyと、本体のみのJS・型宣言生成。
- 固定した開発依存とlockfile。runtime依存なし。

## 検証結果

環境はmacOS、Bun 1.4.2、TypeScript 5.9.3。

| 検証 | 結果 |
|---|---|
| `bun install` | 成功、bun.lock作成 |
| `bun install --frozen-lockfile` | 成功、変更なし |
| `bun run verify` / `bun run verify:all` | 成功、整形・lint・型・境界・試験すべて通過 |
| SQLite基盤試験 | 12件成功、失敗0件、31 assertions |
| 公開境界・検証ツール試験 | 10件成功、失敗0件。合計22件・62 assertions |
| domain指定と不正引数 | 0件試験、未知domain、未対応--areaを非0終了で拒否 |
| `bun run build` | 成功、JSと型宣言を生成 |
| 生成したESMのimport | 成功、純粋入口は空、migrationは空、DB接続なし |
| 文書リンク | 46文書のローカルリンク49件を確認、欠落なし |
| build範囲 | 試験ディレクトリ・test/specファイル・旧store生成物の混入なし |

SQLite試験はfileとmemoryそれぞれのcommit・rollback・async callback拒否、fileでのWAL・readonly・snapshot分離、DB間の分離、終了後と初期化失敗時の回収、製品テーブルが存在しないことを検査した。

初回検査でverifyスクリプトのmodule指定不足を修正した。また空のWAL DBからreadonly接続を使うケースが失敗したため、試験用hostの初期化で新規DBのヘッダーを実体化してからreaderを開くよう修正した。その後のverifyとbuildは成功した。

## 未実装と保証範囲

以下はP0時点の記述で、P1・P2の実装により公開面は拡大している（現状は[実装進捗](plan/progress.md)と[公開API](world-sqlite-public-api.md)）。P0時点では、本体の公開面は型と空のmigrationだけであり、Worldの保存・検索・条件推論・忘却・モデル抽出が動作したという意味ではない。Eumenes側のWriter queue・OS lock・queue/Memoryとの結合、製品migration、復元と忘却journal、先行TTSの公開制御、実モデル・実機受入は後続段階で確認する。

試験は本体ソースの公開入口をself-referenceしている。build出力の正式tarball配布とconsumer試験は未実施。領域選択は本家と同じ`--domain`を採用。現在の8domainは業務試験0件のため失敗し、型検査等の共通検証は全体のまま。`--area`や未知引数は拒否する。

SAAA、Eumenes、Memoryのファイル・製品DB・設定は変更していない。Gitリポジトリ初期化、commit、push、公開・配布は行っていない。

本家への整合前はSQLite基盤12件、整合後は同じ12件と境界検査10件の計22件が成功した。ビルド速度の比較測定は行っておらず、速度改善率は主張しない。

## 実装計画の詳細化

P1〜P6を43作業票（P2-03には4子票）へ分解し、実装契約、54受入ケース、全票未着手の進捗表を追加した。各票は先行条件・変更先・作業手順・検証・完了条件を持つ。計画上のapplication層やAPIはまだ実装していない。

改訂時に票IDと進捗IDの一致、54ケースの対応、先行票の参照、51文書のローカルリンク64件を確認した。verify:allは引き続き22件成功。今回は文書だけを変更し、本体コード・schema・隣接リポジトリには変更していない。
