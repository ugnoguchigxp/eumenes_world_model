# SQLite単体試験とEumenes単一Writerへの接続

同じ`WorldDb`型を、単独試験では使い捨てSQLiteが、本番ではEumenesが所有する接続が満たす。本体は接続を開かず、呼出し元の同期transactionへ参加する。P0で用意したのはこの接続境界と試験基盤であり、Worldの保存APIは未実装である。

## 二つの試験モード

| モード | 構成 | 確認できること |
|---|---|---|
| file 既定 | OSの一時ディレクトリ、WAL、writer 1本、readonly reader 1本 | commit、rollback、別接続のsnapshot、readonly、後片付け |
| memory | `:memory:`接続1本をread/writeで共用 | 小さなSQL試験とrollback。別接続分離・readonlyの保証には使わない |

```sh
bun install --frozen-lockfile
bun run test:sqlite
bun run verify
```

`openTestStore()`はDBパスを受け取らない。試験が製品DBを誤って開かないよう、必ず新しい一時DBを作る。接続は公開せず、同期の`read`と`write`callbackへ`WorldDb`として貸す。`close()`は複数回呼べ、接続を閉じて一時ディレクトリをWAL/SHMごと削除する。初期化失敗時も回収する。

```ts
import { openTestStore } from "../support/sqlite-store.ts";

const store = openTestStore({
  migrations: ["CREATE TABLE probe (id TEXT PRIMARY KEY)"],
});
try {
  store.write((db) => {
    db.query("INSERT INTO probe VALUES (?)").run("example");
    // 将来のWorld同期APIもこのdbを引数で受け取る。
  });
  const rows = store.read((db) => db.query("SELECT * FROM probe").all());
} finally {
  store.close();
}
```

各試験はtry/finallyまたはafterEachで必ずcloseする。callbackはPromiseを返せず、宣言されたasync関数は実行前に拒否する。通常関数がPromiseを返した場合もtransaction内で検出しrollbackする。ただし既に起動した非同期処理の取消まで保証するものではない。接続をcallbackの外へ保持せず、非同期処理を開始しないという呼出し契約を守る。

BunのSQLite driverは同期APIを持つ。ファイルDBのreadonly接続とWALを試験に使用する。[Bun公式SQLite資料](https://bun.sh/docs/runtime/sqlite)

## Eumenesのホストへ接続する場合

以下は将来の接続順序であり、現在のAPI名ではない。

```text
Eumenes store.write(tx => {
  sourceとMemoryとGoalの現行版を公開操作で読む
  Worldの同期API(tx, 検証済み入力)を呼ぶ
  Memoryの外部依存登録を公開操作で行う
  queueの採用条件を検査する
  すべて成功した場合だけ回答・利用記録を保存する
  rejected / stale / 保存未適用なら例外で全体をrollbackする
})
```

Worldが`store.write`を内側から再度呼ぶことはない。DBのopen/close、OS lock、WAL/PRAGMA、writer queue、transactionの開始・確定、migration適用はEumenesの責任である。Worldは借りた接続で自分の表だけを操作する。

`WorldDb`はBun Databaseと構造的に互換な型で、Eumenes固有クラスには依存しない。`inTransaction`は必須とする。P2の書込み入口はtrueを検査し、falseやruntimeでの欠落を拒否する。型は認可を代行しない。SQL権限・Scope・sourceの検査はそれぞれの責任として実装する。

採用の再検証では、writer transaction内の同じtxを使う。別readerへ戻ると異なるsnapshotを読むため、再検証と確定の一体性が崩れる。複数SELECTから構成する通常snapshotにもホストのread transactionが必要。現行Eumenesの`store.read`はcallback全体を明示transactionで包んでいないので、結合時に公開snapshot操作の範囲を決める。

## migrationと復元

現時点の`migrations`は空。probe表は試験ファイルだけにあり、製品用の`world_`schemaではない。

P2では本体がmigration SQLとschema互換検査を所有する。Eumenesは既存migration配列の末尾へ固定版のWorld migrationを追加し、適用済み記録と実行を所有する。履歴の並べ替え・既適用SQLの上書きをしない。試験hostは毎回新しいDBへ適用するだけで、製品のmigration管理を複製しない。

P0ではsnapshot複製、復元、forget journalを実装しない。P2の復元シナリオで、全依存の再登録・最新墓標・restore epoch・cursor破棄を追加する。バックアップの物理copyだけで忘却受入としない。

## 現在の検証範囲

probeを通じて、ホスト側書込みと借りた接続による書込みが同時にcommit/rollbackされることを検査する。これは本体のSQLite利用方法の準備確認であり、Worldの保存・検索・忘却が動作した証拠ではない。

試験hostのwriteは同期で、一つの試験内で順に呼ばれる。Eumenesの非同期writer queue、OS lock、満杯、shutdown、実際のMemory/queue/domainとの原子性は再実装していない。それらはP3のEumenes側結合試験で確認する。
