# ホスト接続契約 v1(P3-02、G2の証拠)

2026年10月9日の接続契約と証拠。2026年10月28日の補足は末尾を参照。調査対象は `../eumenes`(基点commit `0492c6bf`)。以下はその実exportの一覧と、P3-02で追加した差分である。**Worldからホスト型をimportしない。** ホストが渡すのは`bun:sqlite`の`Database`で、`WorldDb`への構造適合は`test/support/sqlite-store.ts`のキャストなし代入(`Database & WorldDb`)で確認済み。

## 調査したsource(sha256)

| ファイル | sha256 |
|---|---|
| `api/infrastructure/sqlite/index.ts`(P3-02変更後) | `5e78a001050ff84bc3ec4530ce0d0684a32db4d36e0013a1f41d18ae9d99dbf6` |
| `api/application/migrations.ts` | `2018a1f865786771f30a3eb550ceede6a02d39f407e48c284d57e615d6cbd6e2` |
| `api/domains/queue/types/index.ts` | `486724a6c94196c328d33e0739e8e5b33be2630616347a68fdeeed0edae06f19` |

変更前の`sqlite/index.ts`は`bf341370945ff6c34676686b74fd48463d365a3f6ccf0f395df02baa3e9ce088`。

## 実export

| 面 | 実体 | World側の扱い |
|---|---|---|
| Writer | `store.write(op)`: 単一writer、`w.transaction(() => op(w))()`、直列キュー(上限64で`WriterBusyError`)、closing中は`database_closing`で拒否 | 同期callback内でだけWorldを呼ぶ。transaction制御はしない |
| Reader | `store.read(op)`: 単一のreadonly接続。**transactionなし** | 複数SELECTには使わない |
| 同期read transaction | `store.readSnapshot(op)`(P3-02で追加): readonly接続上の`transaction`。非同期callbackは`async_snapshot_callback`で拒否、closingは拒否 | `readWorldSnapshot`/`readAssertionHistory`/`validateWorldUsage`はこれで呼ぶ |
| 排他 | `<db>.owner.lock`への`flock`(`WriterOwnedError`) | Worldは触れない |
| migration | `openStore(path, migrations)`: 位置で適用、checksum不一致は`MigrationChecksumError`。`schema_migrations`表 | World migrationは配列末尾へ追加(P3-06) |
| commit通知 | `store.onCommit` | 未使用 |
| queue | `HandlerDefinition`の`prepareInTransaction / execute / settleInTransaction / cancelInTransaction`、`Tx = Database`、`PrepareResult`/`SettleOutcome` | P3-07/P4-02で利用 |
| dialogue delta | `dialogue/service`内の`delta(text)`(本文逐次発行) | P3-08でbuffer制御 |

## 現況と計画の差(要対応)

1. **Memory配布物の版差（当時の記録。現在は0.3.6へ照合済み）**: 当時ホストは`eumenes-memory-0.3.6.tgz`(`vendor/eumenes-memory`、0.3.3〜0.3.6を保持)。Worldの`vendor/eumenes-memory`は`0.1.0-local.0`のローカル生成。SourceRef/AccessContextの型はP3-05/06でホストの0.3.6に合わせて再生成・照合が必要。未検証。
2. **writeの非同期ガードなし**: `store.write`は戻り値のPromiseを検査せず、callbackが非同期だとcommit後に解決される。Worldは同期APIのみで、`WorldDb`の型でPromiseを拒否する。ホスト側の実行時ガードは未追加(既存挙動を変えないため)。
3. **再入**: `readSnapshot`内の`store.write`はキューに積まれ、snapshot終了後に実行される(試験済み)。callback内で同期的に書込みは起きない。
4. **旧Continuity**: `retiredContinuityMigration`は`SELECT 1`のスロット。接続先に使わない。
5. 製品DBには何も実行していない。

## 検証(A35)

- Eumenes: `api/infrastructure/sqlite/snapshot.test.ts` 3件(snapshot中のwriter commit不可視、readonly書込み拒否・非同期拒否・closing拒否、snapshot内writeの後置)。既存`commit.test.ts`/`owner.test.ts`は変更なし。`bun run verify:all`成功(Eumenes、2026年10月9日)。
- 変更したホストファイル: `api/infrastructure/sqlite/index.ts`、`snapshot.test.ts`(新規)、`dialogue/test/dialogue.test.ts`と`voice-dialogue/test/voice.test.ts`(試験用storeフェイクへ`readSnapshot`を追加)。

## 制約

実Memory登録・queue結合・shutdown中のWorld操作は未検証(P3-05以降)。G2は「Writer同期callback・readSnapshot・migration順」を証拠付きで解決したが、Memory公開API(`registerExternalDependents`等)の接続はP3-05。

## 2026年10月28日の接続状態とAgency対応

レビュー対象のEumenesは`34eead79f22bceaa454f2042dd6ce9767299def3`。
P3が未着手という記述は古い。host fixtureの実績と残件は[進捗台帳](plan/progress.md)が正本。
WorldのMemory配布物は0.3.6へ更新済みで、元配布アーカイブのSHA-256とファイル一覧に加えて、manifest自体も固定する。
この補足で製品DBへのmigrationやAgencyへの配線を実施したことにはならない。

Agencyの参照版は`bf34e9de9e6fa5b860eb4c8a86224be36250aa54`。
参照先: `../eumenes_agency/spec/host-contract-v1.md`、`src/contracts/model.ts`のBelief、
`src/contracts/runtime.ts`のProjectionItem。WorldからAgency型へのimportは追加しない。

| Worldの状態・情報 | Agencyへ渡す場合の扱い | 所有者と制約 |
|---|---|---|
| candidate | 未採用のWorld資料。beliefのactiveへ自動変換しない | 採用は本人または登録ルール、beliefの意味判断はAgencyのLLM |
| active | 採用済み資料。真実性やconfidenceを意味しない | World revision・source manifest・receiptを保持するhostが情報源として提示 |
| disputed / causalEligible=false | 争いのある根拠として表示し、断定的な因果伝播へ使わない | Agencyのbeliefと同じID空間ではない。disputedへの更新も根拠と対象を照合 |
| superseded | 旧版を現在の根拠から外し、明示した後継版を改めて評価する | 自動的な新beliefの生成や旧本文の復活をしない |
| retracted | そのWorld根拠の利用を停止する | Agencyのretractedは別所有レコードの状態。hostが依存関係を辿り再評価を求める |
| invalidated / Source変更 / 忘却 | receiptと根拠の利用を止め、再構築・削除のhost手順を適用する | Agencyにinvalidatedというstatusはない。activeへ丸めず、情報源としての利用を閉じる |
| freshness、condition=unknown | 不確実性と不足する観測をそのまま提示する | confidenceへの数値変換や固定語句による分類をしない |

文脈の入口は、権限を確認したWorldSliceとそのmanifest・利用receiptとする。
生のassistant履歴をWorldの正本として再投入せず、必要な過去の回答は原典と帰属を保持した資料として扱う。
回答を使う直前に`validateWorldUsage`相当のhost検査を通す。Slice採用はMemoryの本人Stateを書き換えない。
AgencyとMemoryへの通知・訂正の配線はhost所有で、本リポジトリの今回の差分には含まれない。
