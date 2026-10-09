# 配布物(P3-01)

2026年10月9日。`bun run pack:local`が、World本体の配布tgzと固定Memory型配布物のtgzを`artifacts/pack/`(gitignore対象)へ作る。公開registryへは送信しない。

## 生成物

| ファイル | 内容 |
|---|---|
| `eumenes-world-model-<version>.tgz` | `dist/`(JSと型宣言)、`distribution-manifest.json`、配布用`package.json`だけ |
| `eumenes-memory-<version>.tgz` | `vendor/eumenes-memory`(ローカル生成・非公式、G1) |
| `*.tgz.sha256` / `pack-result.json` | 各tgzのSHA-256、ソースdigest |

配布用`package.json`だけがJS/d.tsを指す。開発用のTS exportsはルートの`package.json`に残る。`exports`は`.`、`./sqlite`、manifestとpackage.jsonのみ。Memoryは`peerDependencies`に固定版で宣言する(consumerが固定tgzを`overrides`で解決する)。

## distribution-manifest.json

- `contract`: `worldContractVersion`、`canonicalVersion`。
- `schema`: migration数と、固定順のid/sha256(build出力のmanifestから読む)。
- `exports`: build後のJSから列挙した`.`と`./sqlite`の値export名。型だけのexportはd.tsが正本。
- `source`: gitのcommit(取得できない場合はnull、創作しない)、`src`の未コミット変更数、`sourceDigest`、`world_source_files`(testを除く全ソースのpath/sha256)。
- `memoryTypeDependency`: Memory配布物の名前・版・種別(`local-generated-not-official-release`)・`sourceTreeSha256`。

## 検証(A34)

`test/consumer/package.test.ts`が、使い捨てディレクトリへtgz二つだけをinstallして次を確認する。

1. tarballにtest/scripts/spec/vendor/生`.ts`/SQLiteファイルがない。
2. SHA-256ファイルがtgzと一致し、manifestに契約版・schema・source digestがある。
3. 隣接checkout(`src`)が解決対象にならない。
4. ESM importのexport名がmanifestと一致し、実SQLite(bun:sqlite)でmigration適用後に`readAssertionHistory`が成功する。
5. d.tsだけを使うTypeScript consumerが`skipLibCheck: false`でtscを通る。

## 制約

- Memory配布物は公式リリースではなくローカル生成。公式版が出たらmanifestの種別とtgzを差し替える。
- 配布tgzのバイト列は`src`の内容とコンパイラ版に依存し、環境間の同一性は未検証。
- 本節はP3-01(配布)の証拠であり、Eumenes Writerとの結合(P3-02以降)ではない。
