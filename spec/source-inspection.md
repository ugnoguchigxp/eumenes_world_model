# WorldModel設計の現行ソース対応

2026年10月9日。ソースと公開文書の読取りによる設計調査。ビルド、製品DB、実モデル、実機の受入は実施していない。設計案は[WorldModelの構造と接続設計](world-model-design.md)にまとめた。

## 1 参照の優先順位

製品の目標は[SAAAの全体コンセプト](https://chatgpt.com/space/page_9fc5877949748191b556705128f6a2f5)の現行本文を参照した。取得時のcurrent sequenceは34、更新日は2026年10月7日。末尾の旧原資料を現行方針へ戻していない。Sitesの一覧では該当名は見つからず、Pagesで同名資料を確認した。

実装の現在地は作業ツリーのソースを優先し、計画だけに存在する部品と区別した。参照時のHEADは次のとおりだが、すべてに未コミット変更があり、HEADのみでは読取り内容を再現できない。主要ファイルのSHA-256を[source-manifest.json](source-manifest.json)へ記録した。

| リポジトリ | 参照時HEAD | 未コミットのstatus行数 |
|---|---|---:|
| SAAA | `28616e61ce5fe853383d4af6ec14e5b5d542c076` | 25 |
| eumenes | `dc86e98bec92f1f60862b10573ae2e98cb1ba102` | 20 |
| eumenes_memory | `66768feb9ee1741f0f9298cc70068d2e044e0743` | 1 |

件数は調査時の`git status --porcelain`の行数であり、変更量や他作業の完了状況を表さない。参照先は変更していない。

## 2 ビルド負荷に関する確認

[desktopのlib.rs](../../SAAA/src-tauri/src/lib.rs)はMemory、Runtime、Tool Selection、Provider、音声、Stewardなどを同じcrateに組み込む。[Cargo.toml](../../SAAA/src-tauri/Cargo.toml)はTauri・audio・network等の依存を持ち、releaseはfat LTOとcodegen-units=1。rlib化とdev/test debug=1は既に入っている。

[build.rs](../../SAAA/src-tauri/build.rs)にはmacOS音声のCコンパイル、Codexの配置、Role Routing sidecar、プラットフォームによってWebFetch sidecar、Tauri処理がある。rerun条件があるため、すべてが毎回走るという意味ではない。

作業ツリーにあるRustファイルの物理行数を数えた。テスト・未登録ファイルを含み、実際のコンパイル量ではない。

| src-tauri/srcの領域 | Rustファイル | 物理行数 |
|---|---:|---:|
| runtime | 154 | 29,952 |
| memory | 158 | 30,592 |
| tool_selection | 86 | 24,474 |
| providers | 98 | 16,636 |
| generated_capabilities | 77 | 15,976 |

[既存crate分割計画](../../SAAA/docs/plans/rust-domain-crate-migration.md)も、moduleのtest filterではコンパイル境界が縮まらない点を扱っている。今回支持できる結論は「日常のWorld検証をdesktop全体から切り離すべき」という構造上の判断までであり、ビルド時間の何割がRust、LTO、リンク、sidecarに由来するかは未計測。

## 3 SAAAから継承する意味論

| 参照先 | 確認した内容 | 新設計への反映 |
|---|---|---|
| [model_v2.rs](../../SAAA/crates/personal-state-core/src/world/model_v2.rs) | entity、relation、Focus、出典区分、相関強度、予測・結果の型。新規Supportedの保存は拒否 | 五要素と根拠の区分を継承。単なるactiveやconfidenceで実証済みにしない |
| [conditions_v2.rs](../../SAAA/crates/personal-state-core/src/world/conditions_v2.rs) | 条件三値、観測競合と未観測はunknown、空条件もunknown | 空条件の扱いを明示。複合条件の型を拡張候補にする |
| [traversal_v2.rs](../../SAAA/crates/personal-state-core/src/world/traversal_v2.rs) | 関連と因果、探索深さ・行数・展開上限、同条件の増減方向 | bounded探索を継承。path rankと確率を分離 |
| [validation_v2.rs](../../SAAA/crates/personal-state-core/src/world/validation_v2.rs) | v2固有のScope・Objective・参照検証をv1のvalidationへ追加 | 自由なグラフ更新を避け、意味検証と台帳更新を公開操作に限定 |
| [coreのREADME](../../SAAA/crates/personal-state-core/README.md) | IO・clock・ID生成を持たないcore、hostがSQLite・認可を所有 | 本体の純粋性とホストAdapterの分担 |

古い実装を機械的に全移植する案ではない。条件式、対象型、scenario比較は追加提案であり、旧Rustとの互換を主張するには共通fixtureで差異を明示する必要がある。

## 4 Eumenesの実際の接続点

| 参照先 | 現行の確認 | 設計上の扱い |
|---|---|---|
| [dialogue service](../../eumenes/api/domains/dialogue/service/index.ts) | prepare・execute・settle、推論receiptの採用検査、確定回答保存 | WorldSlice固定と再検証を同じ境界に追加 |
| 同上のdeltaとpublish | 回答生成中の本文をprogressへ流す | World利用時の先行公開・TTSは別の受入が必要 |
| [SQLite基盤](../../eumenes/api/infrastructure/sqlite/index.ts) | OS lock、単一writer、WAL、readonly接続、同期transactionのwrite queue | World/Memoryの公開同期操作を同じwriter transactionへ載せる |
| [server組立て](../../eumenes/api/application/server.ts) | Continuity削除を明記し、migration位置をno-opで維持 | 旧Continuityを既存接続先にしない。Goal公開口が必要 |
| [domains定義](../../eumenes/scripts/domains.ts) | 現在memory、world、goals、continuityのdomain登録なし | 新しいホスト接続は未実装と明示 |
| [Memory接続計画](../../eumenes/spec/memory-system-incremental-adoption-concept.md) | tarball方式、単一writer、利用記録、採用前検証 | 配布・採用の原則を継承。Continuity前提部分は現行に合わせる必要あり |

READMEの将来計画や過去の受入記録だけから、現在のWorld・Memory接続済みとは認定していない。

## 5 Memoryとの境界で確認したこと

[Memory README](../../eumenes_memory/README.md)と[検証状況第6節](../../eumenes_memory/spec/verification-status.md)は、WorldとConsolidationを別ドメイン・別リポジトリとし、本体には接続口だけを持つと明記する。full-system-designの初期記述や古いM4計画よりこの範囲変更を優先する。ホスト結合と実モデル評価は、文書上も未到達。

[external契約](../../eumenes_memory/src/contracts/external.ts)、[changes実装](../../eumenes_memory/src/infrastructure/sqlite/changes.ts)、[lifecycle実装](../../eumenes_memory/src/domains/lifecycle/repository/index.ts)から確認した境界は次のとおり。

| 現行の仕様または制約 | 接続に必要な対処 |
|---|---|
| feedはrecord・state_item・忘却されたhost_sourceを対象にする | 会話の通常追加・訂正はEumenesのSourceAdapter/outboxで扱う |
| feedは本文を返さず、seqは連続を保証しない | 公開APIで本文を取得し、返されたcursorを使う |
| source依存は墓標を検査するが、存在・所有Scopeを検査しない | ホストが出典の所有とScopeを検証する |
| 外部派生物の再登録は依存の置換 | immutableな主張版・入力manifest単位で登録する |
| 依存は1派生物32件まで | 入力を分割または保留し、切り捨てない |
| external依存辺は忘却journalに載らない | 復元時にWorld manifestから再登録し、全依存を再照合する |
| 外部削除確認でexternalIdを省くとprovider単位へ広がる | World専用providerRefを使いexternalIdを必須にする |
| 復元でseqが巻き戻る。検知できない復元ケースもある | ホストの復元処理でcursorを必ず破棄する |
| ID単位の墓標は、同じ意味の新しいIDへの再抽出を全面禁止しない | 忘却対象の意味と範囲を明示し、必要な抑止を別契約にする |

これらはWorldを独立サービスにすべき理由ではなく、現在の公開契約を使うAdapterとホスト結合試験で埋めるべき条件である。

## 6 調査の限界

今回確認したのは関連する文書、公開型、主要な検証・保存・採用経路であり、SAAA全体の網羅的コード監査ではない。既存試験の合格履歴は参考にしたが再実行しておらず、現行ツリーのbuild-readyを認定していない。設計書のAPI・表・コマンド・性能予算は提案で、実装済みではない。

最初の接続前に、参照した3リポジトリの更新、公開exports、配布物、Goalの所有、回答の公開境界、忘却journalのホスト実装を再確認する。関連ソースの保存時hashは調査の参照点であり、製品データや秘密は含めない。

実装計画の詳細化時にMemoryの配置変更を確認し、changes/lifecycleのリンクを現行パスへ更新した。source-manifest.jsonは初回調査時の記録として保持する。公開接続の再検証はP1-02とP3-05で行う。
