# 借りたSQLite接続による永続化

`WorldDb`の型、トランザクション必須などの共通ガード、migrationのdescriptor集約・hash固定・互換性検査を置く。業務SQLは各domainのrepositoryと`src/application/sqlite`が所有する。

- 接続はEumenesのwriter transaction、または試験用hostから借りる。open、close、transaction、PRAGMA、接続cacheを本体に置かない。
- `WorldDb.inTransaction`は必須。将来の書込みAPIは入口で`=== true`を検査し、それ以外は拒否する。readonlyかどうかはこの値では分からず、実際のSQLiteのreadonly制約も必要になる。
- 公開操作は同期。モデル・network・ファイル・awaitを呼ばない。接続を呼出し後まで保持しない。
- 更新結果がrejected等なら、ホストは同じtransactionの他変更も確定してよいか判断する。複数domainの一体操作であれば例外へ変換してrollbackする。
- 各domainのrepositoryが自身の`world_`表・SQL・migrationを所有する。この共通基盤は接続型とmigrationの順序集約だけを持つ。他domainの表を直接更新せず、同じ接続と公開操作を使う。Eumenes側の表へのSQL・外部キーを作らない。
- migrationは不変descriptor（`{id, sql, sha256}`）と、ホスト互換のSQL文字列配列の両方を公開する。ホストが起動時に順番・適用済み記録・transactionを管理し、`checkSchemaCompatibility`で既適用のhash不一致や未来版を検出する。

使い方と保証範囲は[SQLite試験とホスト接続](../../../spec/sqlite-testing.md)を参照する。
