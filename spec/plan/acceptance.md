# WorldModel 受入ケース

各IDを試験名またはfixtureのcaseIdに含める。1行は最低限の受入であり、複数の入力がある場合はtable testで全入力を確認する。試験が存在しない段階では、この文書の存在を合格扱いにしない。実装箇所と実行結果は[進捗表](progress.md)へ記録する。

## 共通fixture

- principalは`p-a`と`p-b`、Scopeは`scope-a`と`scope-b`。同じ表示名「音声サービス」を別Scopeに置く。全IDはfixtureから供給し、実在ユーザーのデータを使わない。
- 時刻は`now=1791500000000`など固定した整数。時間依存試験は引数だけを進める。sourceは`src-1/rev-1`と`src-1/rev-2`、digestは本文UTF-8から算出する。
- 台帳の初期主張は`claim-1/revision=1`、Scope epochは7、operationKeyは`op-1`。各ケースが異なる値を要する場合はfixture内で明示する。
- SQL試験はtest/supportの新規temp DBを使い、file/WALを受入基準にする。finally/afterEachで閉じる。DB driverのmockだけでSQLを合格にしない。
- hostを含む原子性試験では`host_probe`へ1行追加した後にWorldを更新する。失敗後に各表を別transactionで読み、件数・revision・epochを更新前と比較する。

## P1 純粋規則

| ID | 入力と操作 | 必須の期待値 | 禁止する結果 |
|---|---|---|---|
| A01 | version=1/2、revision=0/1/1.5、number=NaN/Infinity、ID空文字 | 有効な1のみ受理。不正は対応codeを返す | 型assertionで通す |
| A02 | object key順だけ違う2入力、配列順が違う入力、日本語文字列のbyte境界 | key順だけなら同bytes/digest。意味配列順が違えば別digest。上限超過を拒否 | 文字数でbyte予算判定、undefinedの黙殺 |
| A03 | 固定Memory配布物だけを置いたconsumer、SourceRefの日本語byte range | 公開型から型検査可能。引用は元bytesと一致 | 手書きSourceRef、隣接checkout依存 |
| A04 | notの3入力、all/anyの3×3入力、空配列、未記述条件 | C5の全真理値表と一致。空/未記述はunknown | 空ANDを自動trueにする |
| A05 | msとs、stale観測、同順位のtrue/false、深さ9、ノード65 | 比較不能はunknown、AST上限超過は拒否 | 暗黙単位変換、矛盾の都合よい選択 |
| A06 | 月精度「9月から」、時刻より未来の観測、明示無条件＋採用根拠あり/なし | 精度保持。不確定期間と未来観測はunknown。無根拠の無条件拒否 | 架空の日付、期間検査省略 |
| A07 | 同名別Scope、同Scope2候補、明示ID、merge後split、古いrevision | 別Scope漏洩0、2候補ambiguous、明示IDresolved、元alias対応へ復帰、旧版拒否 | 同名だけの統合、不可逆な履歴破壊 |
| A08 | user_report、document_claim、runtime_observation、model_hypothesisの同じ内容 | originを保持。modelはcandidate。active化に採用根拠必須 | 報告を実測、confidenceを採用許可にする |
| A09 | 同rootの要約10件と異なるroot2件、引用範囲外/異digest | root系列数は1と2。全入力依存は残す。不正引用拒否 | 独立性や確率を件数から作る |
| A10 | C4の全許可遷移と全非許可遷移、訂正rev2後に古いrev1を適用 | 許可辺のみ新revision計画。rev1再適用拒否。旧版停止と新版参照が一緒 | 終端を同revisionで再活性化 |
| A11 | s1→a→b、s2→b、b→aのcycle、引用されなかったs2をforget、budget=1 | a/bの閉包が有限で得られ、継続batchの合計が期待集合と一致 | 入力依存の欠落、未走査でcomplete |
| A12 | fresh/stale/disputed/invalidatedを含むsnapshot、complete=false、World OFF | 状態を区分。必須不足blocked、OFF disabled、invalidatedは利用対象外 | activeを真実の証明とする |
| A13 | 日本語の説明単位で8192bytes以下/超過、必須1単位が超過 | 単位ごと省略しpartial。必須不収容はoverflow。条件と反証を残す | 結論だけ残す、文字切断で意味を壊す |
| A14 | A→B因果、B↔C相関、B part_of D、逆探索、feedback | 因果伝播はA→Bのみ。逆探索でも向きを保持。cycle有限 | 相関や逆向きを効果として伝播 |
| A15 | 501候補、501展開、深さ/経路数超過、高分岐 | 上限で停止してpartial/reason。実カウンタが予算以下 | 全件取得後のslice、打切りを影響なしとする |
| A16 | 必須資源unavailable/unknown/available、Goal撤回、費用unknown | 未充足/不明を区分。availableだけで成功確定しない。Gap順はC5通り | 未承認Goal採用、架空の効用値 |
| A17 | domain private/static re-export/import type、型のruntime import、cycle、domain→application | 各禁止辺を境界検査が拒否、公開宣言依存は受理 | allowlist全面開放で試験を通す |
| A18 | 同baselineのoverlay A/B、同条件100ms±2msに対する90/110/99ms、平均対p95、ms対s、入力長違い | 入力変更0。条件一致時だけsupported/refuted。条件不一致と分解能不足incomparable、支持反証混在mixed | edgeから数値効果、比較不能を支持にする |
| A19 | 否定/仮定/伝聞/質問、他Scope、未知ID、未確定ASR、9候補、不正JSON | 型/意味ごとの却下か保留。最大8候補。host割当値だけ採用 | 未確定発言を事実化、モデルIDを直採用 |
| A20 | 32/33unique依存、12/13発言、32KiB超の1発言、非引用入力source | 上限内の窓のみprepare。33依存と分割不能な発言は保留。全入力依存をmanifestへ | 切捨て、引用だけの登録 |

## P2 SQLiteと再送と失効

| ID | 入力と操作 | 必須の期待値 | 禁止する結果 |
|---|---|---|---|
| A21 | 新規schemaでNULL Scope、不正enum、重複PK、別Scopeの参照、tx外write | 制約または事前検査で拒否。tx外はWorldTransactionRequiredError | SQL bind省略、無条件UPSERTで上書き |
| A22 | 空DB、適用済みDB、hash改変、未来schema、途中DDL例外 | 新規/upgrade一致。hash/未来版拒否。例外後は当該migration全体rollback | 履歴SQL変更、途中schemaで利用再開 |
| A23 | host_probe追加後、主張/根拠/投影/epoch/receiptの各DML段階で例外 | 別readで全件数・revision・epochが更新前と一致。正常時は全更新commit | rejectedを返すだけで部分commit |
| A24 | rev1/epoch7からSlice作成後、rev2訂正または新反証追加でepoch8 | validateWorldUsageが旧Sliceを拒否。無関係な別Scope更新は無効化しない | 参照したclaimだけ一致すれば採用 |
| A25 | World更新の後にMemory登録rejected/blocked/例外 | World/Memory/host_probe/queue checkpointが全rollback | Worldだけ確定、queue完了 |
| A26 | op-1成功→応答喪失→同内容再送、異内容再送、forget後再送 | 同内容no_opで件数/版/epoch不変。異内容競合。forget後はpayload返却0 | 再送で復活、古いreceipt本文を返す |
| A27 | WAL readerの一つのtransaction中にwriterが更新、次read開始 | 同じreadは旧snapshot一貫、次readで新版。tx外複数SELECT拒否 | 混在snapshot、別readerで採用検査 |
| A28 | seq=100→105、同event再送、受付後に意味処理保留、cursor保存前失敗 | 欠番を許容。重複0。受付と適用位置が別。失敗した受付cursorは進まない | seq+1推測、受付済みを意味適用済みとする |
| A29 | 保留抽出eventの後に訂正/forget、World OFF/モデル不在 | 抽出完了を待たず旧主張停止/消去。OFFでもforget進行 | 後続削除が待ち行列に塞がれる |
| A30 | 501以上の依存閉包、2chunk目失敗、再開 | 最初にgate closed。最大500/回。再開可能。残件0と再構築までpending | 初chunkでforget complete、処理中公開 |
| A31 | source忘却後に旧attemptの候補、全履歴/予測/引用/manifestを照会 | 遅着拒否。管理payload本文0。墓標/最小IDメタデータのみ残る | sourceが非引用だから派生を残す |
| A32 | 古いDBと最新journal、restoreEpoch変更、seq巻戻り、辺再登録TOMBSTONED | gate閉→cursor破棄→依存再登録/照合→消去/再構築。不明なら閉のまま | 旧DBに辺がないので確認完了 |
| A33 | 同一機材で1千/1万/10万主張、高分岐/cycle | 取得/展開/出力上限厳守、索引使用確認、1万件のp95を記録 | 未計測を0扱い、全件JSロード |

## P3 ホスト結合

| ID | 入力と操作 | 必須の期待値 | 禁止する結果 |
|---|---|---|---|
| A34 | clean consumerにWorld/Memory固定tgzのみをinstall | ESM・型検査・SQLite1操作成功。試験host/ソースの混入0 | sibling symlinkで不足を補う |
| A35 | 実host writerへ同期World操作、readonly readSnapshot、WriterBusy/shutdown | 同じdbを使用、snapshot一貫、busy/終了拒否を伝播 | World独自writer、nested write queue |
| A36 | 会話確定/訂正/撤回とoutbox、保存途中例外、Scope外read | sourceとevent同時commit/rollback、版一致、権限外の本文/件数0 | Memoryのforget feedを通常会話feedとみなす |
| A37 | 明示Goal採用/撤回/古い版、Goalなし、モデルの推定目標 | hostだけがGoal状態を更新。無Goalはabsent。旧版receipt失効 | WorldがGoalや委任を自動作成 |
| A38 | 外部依存登録32超、誤Scope、旧版externalId再利用、削除pending | 超過/誤Scope拒否。版別IDで保持。confirmedは確認済み対象IDのみ | provider単位一括confirmed、依存切捨て |
| A39 | 実hostで登録→Slice→訂正→forget→再起動 | 更新の一体性、旧Slice拒否、再起動後本文復活0 | fixtureの単一writerだけで実host成功扱い |
| A40 | prepare/送信直前/生成中/settle直前の訂正・forget・policy/Goal/attempt変更 | 送信前なら送信停止、送信後なら取消と採用拒否。回答/receiptは一体 | 古いwriter snapshot以外で最終検査 |
| A41 | World回答stream中に失効、正常採用、reconnect | 採用前の本文イベント/TTS 0、失効時0、採用後完成本文1回 | UIだけ隠して音声へ送る |

## P4からP6 継続構築と実利用

| ID | 入力と操作 | 必須の期待値 | 禁止する結果 |
|---|---|---|---|
| A42 | 受領直後crash、適用中crash、空feed、Scope追加 | 未適用を再開。空feedの新LLM要求0。Scope追加は再同期 | checkpoint飛越し、無入力の定期推論 |
| A43 | 不正候補、Local unavailable、30秒timeout、prepare登録拒否 | 不正採用0、Cloud要求0、timeout取消、登録拒否時execute0 | 自動Cloud fallback、leaseの独自再実装 |
| A44 | 前景開始、cancel遅延、旧attempt遅着、前景終了 | 取消未確認slot再利用0、同時背景推論<=1、遅着採用0、有効入力再開 | 未完了を成功扱い、前景をsleepで遮断 |
| A45 | Toolの成功文面と失敗した実測、比較不能結果、元結果訂正 | 実行台帳の検証済み版だけを観測化。不足はincomparable | LLM文面だけでruntime成功 |
| A46 | 固定100件holdout、全件の完了/失敗/保留を集計 | P4-05の閾値と0許容違反を満たす。分子分母と失敗ID記録 | 成功例だけの集計、holdoutでprompt調整 |
| A47 | Gap重複、未知mode、不正Scope、委任権限なし | 不正要求拒否。Gap安定キーで重複排除。無許可Task作成0 | Gapを実行許可と解釈 |
| A48 | UIの競合訂正、forget pending/complete、Scope切替 | 版競合を表示して再読込。pendingを完了と表示しない。越境表示0 | frontendだけの状態変更、他Scope件数表示 |
| A49 | cache改善仕事で同条件改善/悪化/入力長違いの3系列 | supported/refuted/incomparableを区分し再評価。原典版へ追跡可能 | 比較条件違いを改善実績にする |
| A50 | 20仕事×3条件、事前rubricの4軸採点 | 安全違反0、Worldの悪化0、5仕事以上改善、全出力と採点理由保存 | 平均点で漏洩・誤因果を相殺 |
| A51 | ContextStillの版変更/削除/Scope拒否/不変版なし | 要件不足なら一時参考のみ。削除版は再利用しない | 公開契約未確認の永続根拠化 |
| A52 | 未登録能力、検証失敗、評価器版違い、Worldの自己採点 | 実行権限を拡大せず元台帳へ従う。候補/評価/採否版を分離 | World仮説を正解として成功認定 |
| A53 | 2principal×3Scope、24時間以上、会話/音声/背景/忘却/再起動 | 漏洩/復活/slot再利用0、無入力LLM0。背景ON会話p95悪化<=5% | 短いfixtureを長期運用の証拠にする |
| A54 | clean install、upgrade、停止、旧DB復元、墓標維持rollback | 手順通り再現。最新忘却・権限撤回を維持。不明時World利用停止 | 製品DB初期化で不整合を隠す |

## 結果の残し方

試験名、caseId、実行コマンド、source/package版、環境、成功/失敗/未実施を記録する。caseの一部だけを実装したら未完了であり、親IDを合格にしない。複数票が同じcaseを参照する場合、純粋/SQL/host/実モデルのどの証拠かを分ける。

通常ログへsource本文・秘密を出さない。失敗再現用の合成fixtureと、不透明ID/版/理由codeを基本にする。実データの採取が必要になった場合はその作業の対象・保存先・保持条件を別途定める。
