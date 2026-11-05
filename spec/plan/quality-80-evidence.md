# 品質改善の検証範囲（2026年11月5日）

対象はローカルmain `06e9480`と作業開始時の未コミット変更。開始時ファイルhashは
`artifacts/quality-80/2026-11-05/initial-files.json`へ保存。開始後に変更したファイルは
最終差分記録で識別する。兄弟repoの製品DB・設定・秘密は対象外。

## 契約と失敗の行列

全17種について、principal/Scope不一致、契約版不正、access欠落を内容読取・DMLより前に拒否することを
`test/scenario/operation-boundaries.test.ts`で確認。列挙と実際のoperation unionの一致も検査する。
各操作の正常系と固有の境界は次に対応する。同一transaction・単一writerが前提。

| 更新種別 | 正常・固有境界の主な試験 |
|---|---|
| entity.register | atomicity / list-entities / persistence-review |
| entity.merge | persistence-review / review-fixes / review-fixes-2 |
| entity.split | identity-roundtrip（公開application正常・再送・全DML rollback）/ identity domain SQL |
| assertion.register | atomicity / replay / stored-payload |
| assertion.transition | correction / contradiction-lifecycle / world-lifecycle |
| prediction.register | atomicity / forget / persistence-review |
| outcome.register | forget |
| candidate.settle | settle / correction / review-fixes-3 |
| inbox.receive | settle / correction / restore |
| invalidate | correction / review-fixes-2 |
| forget.chunk | forget / review-fixes-2 / operation-boundaries |
| forget.reopen | forget / review-fixes-2 / review-fixes-3 |
| restore.begin | restore / world-lifecycle |
| restore.register | restore / world-lifecycle |
| restore.reconcile | restore / world-lifecycle |
| restore.finish | restore / world-lifecycle |
| rebuild | incremental / restore / budgets |

readWorldSnapshot / readAssertionHistory / listEntities / validateWorldUsageは
schema不整合拒否を新規横断試験で確認。既存のscope / snapshot / list-entities / stored-payloadは
内容漏洩、policy/epoch/source版、墓標、破損payload、読取transaction必須、上限を検査する。

通常登録・採用・予測と訂正・forgetは各DML例外で全DB/host行のrollbackを検査。
restoreは各段階失敗、閉gate、journal巻戻り、未知依存、再送を検査。
全17種×全DML×全並行窓の直積を実行したという主張はしない。

実process終了の追加試験は登録とforgetの2代表操作に限定する。各DML直後、commit直前、
commit後で子processを終了し、別processでファイル/WALを再オープンする。
commit前は完全rollback、commit後の応答喪失は同一操作のno_op、再送後DB不変を確認。
電源断・媒体破損・複数writerの耐久性は未検証。

WAL readonly reader中のwriter commitはsnapshotで不可視、次のtransactionから可視。
訂正・失効・forget・restore後は古いreceiptを拒否する。
非同期のモデル取消は同期ライブラリ内に持たず、既存hostのchange-feed試験で別に確認する。

## 負の対照

製品ソースと別の一時コピーに3変異を入れ、試験失敗を確認してコピーを廃棄した。

| 変異 | 失敗した試験数 | 結果 |
|---|---:|---|
| 投影からedgeへのfreshness継承を削除 | 3 | fresh/stale/unknownの伝搬を検出 |
| principal/Scope照合を省略 | 1 | 全17操作の共通境界試験が検出 |
| 墓標照合を省略 | 2 | 忘却後登録・再送試験が検出 |

ログは`negative-*.log`、条件と終了codeは`negative-controls.json`。
変更前の鮮度試験も3 fail / 1 pass、修正後4 pass。語句に依存する製品分岐は追加していない。

## 導入先・host・権利

空のconsumerへ両tgzを導入し、ソースなしのESM/d.ts/manifest/checksumを照合。
追加の実操作はentity登録→主張登録→明示採用→Slice→receipt検証→越権拒否→
host例外rollback→forget→旧receipt/再送拒否→別process再起動。
source root識別のため既存sourceIdentityKeyを公開し、呼出側の符号化複製を避けた。
consumerは独立ファイル/WAL。追加の配布物切戻しでは、新版で採用・忘却した同じDBを既存hostの旧配布物へ戻し、別processで本文0・gate closedを確認した（package-rollback.json）。媒体の物理消去は保証しない。

hostソースを使い捨て環境へコピーし、製品DB・設定・秘密をコピーせず、候補World tgzと
既存Memory実装を使ってchange-feed / lifecycle-forget / lifecycle-restore /
lifecycle-hardening / world-evidence-integrationの62件を実行した。
実Memory/World journalの接続・pending受信中forget・古いDB復元・外部削除確認を含む。
hostの例外hookによるcrash再現とWorldの実process終了試験は区別する。
稼働hostの更新・24時間運用・実仕事の正式受入は実施していない。

未settle本文はsourceだけのforgetでは到達できず、hostのcandidate root指定が必要という契約を維持。
received/held/rejected/appliedの4状態を明示rootで確認し、hostのsource由来event mirrorを追跡した。
任意の外部hostやstate→inbox対応をWorldが自動発見する保証は追加しない。

所有者がWorldと固定MemoryをMIT公開OSSと確認。LICENSE、Memory通知、THIRD_PARTY_NOTICESを追加し、
両tarballに通知が入ることを試験。固定vendorの元バイト列・pinは変更しない。
開発依存の版/ライセンスとruntimeの外部import不在を確認。bun audit --jsonはexit0・空結果だが、
脆弱性なしの証明や全供給網の監査とは扱わない。
CIはSHA固定・最小権限のverify/buildを追加したが、ホストされたrun成功は未確認。

## API・追加実験の判定

全runは同じ10 USD台帳へ合算し、未確定請求の予約を残す。失敗・未達も分母と記録へ残す。
抽出200件×両社の対照と候補、既存判断20仕事×4条件×両社を別々に判定する。
外部比較はremoteのまま、A46/A50・M4のLocal正式受入を代替しない。

独立60件・新規40仕事の交差pipeline・盲検judgeは、既存抽出の受入結果と次の固定条件を見て
後続の比較票として扱う。既存抽出ゲート未達の結果で新しい通し仕事の品質・優位を主張しない。
未実行の項目をQ05完了や技術スコアの加点根拠にしない。


## API品質追補の証拠

Q12: final-verify.log/final-build.log/final-source.json/source-final.tgz（固定コピーの検証、src同一性）。Q13: acceptance/legacy-matrix/acceptance-replay（初回の全行列と再生）。Q14: balanced-judge/acceptance-summary-balanced.json（回答固定・順序均等の追加採点）。各実行・台帳・source監査・最終整合性/非保存検査をartifacts/api-quality/2026-11-05へ保持。技術点は同じ30アンカーのまま再計算し、API未達を合格へ変換していない。
