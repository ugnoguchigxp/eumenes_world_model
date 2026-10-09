# P3からP6の実装作業票

全票が未着手。Eumenesの変更を含む票は、後続依頼の対象にEumenesが含まれる場合に実施する。ソースの現況は着手時に再確認し、ここに記す新設APIを既存と取り違えない。[実装契約](contracts.md)と[受入ケース](acceptance.md)を併読する。

パスの`H`は`../eumenes`、`W`はこのリポジトリ。World本体の検証は計画本体のF/D/S。`HF(domain)`はH内の`bun run verify -- --domain <domain>`、`HA`はH内の`bun run verify:all`。world/goalsのHFはdomainを登録した後にだけ実行できる。認可済みのホスト作業中も製品DBの初期化や既存設定のリセットは行わない。

## P3-01 正式配布物と独立consumer

- 先行条件: P2-10、G1解決済み。
- 変更先: Wの`scripts/pack.ts`、packageの`pack:local`、`test/consumer/{package,types}.test.ts`、`spec/distribution.md`。
- 作業: build出力と公開型だけから配布manifestを作る。rootと/sqliteのimport/types export、契約版、schema版、migration hash、source revisionまたは追跡可能なsource digest、Memory型依存版を記録。tgzを作りSHA-256を記録する。Git未初期化ならcommit SHAを創作せずsource digest方式を使う。
- 契約: dev用TS exportsは保持し、配布用package.jsonだけJS/d.tsへ向ける。test/scripts/spec/隣接sourceをtarballへ含めない。world_source_filesのhashリストで生成元を追えるようにする。packは公開registryへ送信しない。
- 試験/検証: A34。使い捨てconsumerへtgzと固定Memory配布物だけを入れ、ESM import、tsc、実SQLiteの1操作を実行。隣接checkoutを解決できない環境で確認。F、`bun run pack:local`、consumer試験。
- 完了条件: World srcの再コンパイルをconsumerに要求せず、JSと型のexportが同じAPIを持つ。生成物だけから依存が閉じる。

## P3-02 現行ホストとの境界固定

- 先行条件: P3-01、H変更を含む依頼。
- 変更先: Wの`spec/host-contract-v1.md`、HのSQLite基盤・domain定義を調査。read snapshot用APIが不足する場合のみHの`api/infrastructure/sqlite/index.ts`と対応試験を変更。
- 作業: Writerの同期callback、queue prepare/execute/settle、migration順、readonly reader、dialogue deltaの実exportを一覧化し、ソースhashを記録。単一Writerは既存のまま利用。複数SELECT用に既存reader上の同期read transactionを提供する`readSnapshot`相当を追加する。
- 契約: readSnapshotはwriterを新設しない。Worldからhost型をimportしない。ホストのwriteがWorldDbへ構造的に適合することをキャストなしの型試験で確認する。現況が計画と異なるときは接続文書を直してから実装する。
- 試験/検証: A35。host SQLiteの既存commit/owner試験、readonly snapshot中のwrite、shutdown時の拒否、再入writeなし、同期callbackの確認。HA。
- 完了条件: G2を証拠付きで解決。旧Continuityを接続先に使わない。read/writeの同一性とsnapshot範囲が文書化される。

## P3-03 SourceAdapterと通常変更のoutbox

- 先行条件: P3-02。
- 変更先: Hの`api/domains/world/{contracts,service,test}`、source所有domainの公開契約とrepository/test、scripts/domains.ts、application組立て。通常会話はconversation公開口へ追加し、Worldからconversation表を読まない。
- 作業: SourceAdapterにresolveCurrent、readAuthorizedContent、listChangesを定義。確定発言の追加/訂正/撤回をsource書込みと同一transactionのoutboxへ記録。namespace/kind/id/representationで原典を指定し、版・digest・Scope・発言者・確定状態を返す。
- 契約: Memory change feedで通常会話イベントを代用しない。source本文取得はaccess検査後。未確定ASR、draft、権限外はWorld入力にしない。cursor欠番を許し、削除を先に適用できるよう種別を持つ。outboxはイベント所有domainがSQLを持つ。
- 試験/検証: A36。会話保存とoutboxの一体rollback、訂正のsource revision変化、再送、消えたsource、別principal/scope、Unicode引用範囲。HF(conversation)、HF(world)、HA。
- 完了条件: G3のsource部分を解決し、Worldが必要とするsource currentを同じwriter transactionから渡せる。

## P3-04 GoalSnapshotの公開口

- 先行条件: P3-02。P3-03と独立に着手可能。
- 変更先: Hの`api/domains/goals/{index.ts,contracts,service,repository,test}`、domain登録、application組立て、migration。既存Goal所有者ができていれば新設せずその公開口に合わせる。
- 作業: Goalのid/principal/scope/desiredState/priority/status/source/revisionを所有する最小台帳を作る。明示採用/更新/撤回の公開操作と、同一txのGoalSnapshot取得を作る。
- 契約: WorldはGoalRefを受け取るだけ。推定目標はproposal扱いで、Goal採用・Task実行・委任権限の更新をしない。Goalがないときはgoal absentを明示し、適当な目標を生成しない。
- 試験/検証: A37。Scope越境、古いrevision、明示撤回、目標なし、Worldによる自動採用がないこと。HF(goals)、HF(world)、HA。
- 完了条件: G3のGoal部分を解決し、Goal更新でそのGoalに依存する利用receiptを失効できる。

## P3-05 Memory依存登録と忘却復元の結合

- 先行条件: P3-02、03、P2-08。現行Memory配布物の公開sqlite APIを再確認する。
- 変更先: Hの`api/domains/world/service/{memory-adapter,lifecycle-adapter}.ts`相当、host journal所有層、world/test、applicationの起動gate。Memoryにadapterが既存なら再利用する。
- 作業: MemoryのregisterExternalDependents/listMemoryChanges/recordExternalDeletionを公開API経由で接続。providerRefを`eumenes-world`に固定し、externalIdは主張版とmanifest版ごとの不透明IDとする。全入力依存をScope検査して登録する。
- 復元手順: 同じforgetIdの受付をpending化→必要なMemory/World journalをdurable化→同一writerでforget適用→削除が確認できたexternalIdごとにconfirmed→受付complete。crash後は未完了段階を再実行。起動gateは全再照合まで閉じる。
- 契約: 32依存超過は分割または保留、切捨てない。外部登録は置換なので旧版の依存を新版で上書きしない。sourceのScopeはSourceAdapterで検査。externalId省略のprovider全体confirmedを使わない。Memory内部journal schemaへ勝手にWorld情報を追加しない。
- 試験/検証: A25、A30〜A32、A38。World保存後のMemory登録拒否で両者rollback、journalの各耐久化境界でprocess crash、古いDB＋新journal、TOMBSTONED再登録、World/Memory OFFを検査。HF(world)、関連Memory adapterのHF、HA。
- 完了条件: G4解決。fixtureだけのjournalから実hostの耐久性試験へ到達し、削除未確認の外部登録をcompleteにしない。

## P3-06 migration登録と手動入力の縦断

- 先行条件: P3-01〜05。
- 変更先: Hのvendor/world配布物、dependency lock、application/serverのmigration集約、worldの公開操作、`world/test/manual-world.test.ts`。
- 作業: 固定tgzとmanifestをHへ導入し、World migrationを既存配列の末尾へ追加する。新規fixture DBと既存schema fixture DBの両方を移行。source/Memory current→World operation→Memory外部登録を同じwriter callbackで呼ぶ。
- 契約: 自動抽出の完成を待たず、合成sourceと明示構造化主張で接続を検証する。schema不一致時はWorldを利用停止にし、migration履歴を並べ替えない。hostにworld_表の業務SQLを複製しない。
- 試験/検証: A22、A25、A39。対象登録→明示主張→Slice→訂正→旧Slice拒否→forget→再起動。Memoryの拒否、WriterBusy、終了中を注入。HF(world)、HA、Wのconsumer試験。
- 完了条件: 実host Writer上で一連の更新が成立。製品DBへの実migration実行は後続の運用手順に従い、この試験で代用しない。

## P3-07 Context Brokerと回答採用

- 先行条件: P3-06。
- 変更先: Hのapplication/Broker組立て、world公開service、dialogue/contracts/service/test、queue利用側test。
- 作業: prepare内でMemory/World/Goal snapshotを同一txから読む。共通予算を分配し、WorldSliceと依存manifestを不変化して入力依存登録。executeの送信直前にsource/policy/forgetを再確認する。settle内で同じwriterから全依存版、scope epoch、Goal revision、attempt/lease/取消、推論receiptを再確認する。
- 契約: 初期はScope単位epochの保守的失効を許す。単なるclaimの再読取りだけで追加反証を見落とさない。採用した回答とUsageReceiptは同一transactionで保存する。receiptにslice digest/版/package/run/attempt/providerを結ぶ。World textは参照データとして渡す。
- 試験/検証: A24、A40。prepare後/送信直前/生成中/settle直前に訂正、forget、policy変更、Goal撤回、attempt更新を差し込む。HF(world)、HF(dialogue)、HF(queue)、HA。
- 完了条件: 無効な結果は回答にも使用記録にも残らない。送信済み情報の回収は保証せず、取消と遅着結果拒否の保証を分ける。

## P3-08 World回答の本文とTTS公開制御

- 先行条件: P3-07。
- 変更先: Hのdialogue/service、voice-dialogue/service、delivery公開経路、Webイベントconsumerと関連試験。
- 作業: World利用runは本文deltaとTTS素材を採用までbufferする。処理中の状態イベントは送信可能だが本文を含めない。settle成功後だけ完成本文を発行し、取消/失効時は未公開bufferを破棄する。
- 契約: World利用有無を明示flagで伝え、blockedをWorldなし成功へ自動変換しない。SSE/reconnect/再送でも同じ採用receiptに基づく。一般会話の既存経路は既存試験で維持する。
- 試験/検証: A41。ブラウザの本文イベントとTTS呼出しspyを両方観測し、採用前0件、失効時0件、採用後1完成回答、再接続で重複発話なしを確認。HF(dialogue)、HF(voice-dialogue)、HF(delivery)、HA。
- 完了条件: UIだけを隠すのではなく音声/イベントにも未採用本文が流れない。先行公開の再解禁は別契約・別票とする。

## P3-09 最初の製品接続の受入

- 先行条件: P3-01〜08。
- 変更先: Hのworld/dialogue/voice横断試験と受入記録、Wの進捗。
- 作業: 一つのScopeで明示登録→質問→訂正→再質問→生成中forget→再起動→質問を実施する。通常のfixture providerで決定的に全経路を検査し、別欄で実Local Providerの同じ操作も実施する。
- 試験/検証: A34〜A41。WのF/consumer、HF(world/dialogue/voice-dialogue/queue)、HA。World OFF、Memory OFF、モデル停止でもforgetを実施。
- 完了条件: host結合と公開制御の全ケースが成功。実Local Providerが未接続なら結合完了と実モデル未受入を別に記し、後者をP4-05へ引き継ぐ。自動抽出を完成と扱わない。

## P4-01 継続入力の受領と進捗

- 先行条件: P3-09、P2-06。
- 変更先: Hのworld/serviceのchange consumer、world/test/change-feed.test.ts、applicationの起動/停止処理。
- 作業: source outboxとMemory公開change feedを別cursorで読む。World inboxへ受領とcursor保存を同じwriterで行い、その後の意味適用を別checkpointで追う。起動時は未適用inboxを再開する。
- 契約: pending抽出より訂正/forgetを先に適用する。feed種類を混ぜてseq比較しない。scope集合変更とrestoreEpoch変更はcursorを破棄して再同期。無イベント時は新たな推論jobを作らない。
- 試験/検証: A28、A29、A42。欠番、重複、受領後crash、処理途中crash、Scope追加、削除追越し、空feedを検査。HF(world)、HF(queue)、HA。
- 完了条件: source所有者からWorld適用までの各checkpointを照会でき、未適用を適用済みにしない。

## P4-02 Local抽出のqueue handler

- 先行条件: P4-01、P1-10。
- 変更先: Hのworld/service/extraction-handler、queue handler登録、inference/LARM公開接続、world/test/extraction-handler.test.ts。
- 作業: prepareで入力snapshot固定とMemory外部依存登録、executeでLocalモデル呼出し、settleで候補の再検査とWorld operationを行う。登録rejectedならexecuteへ進まない。
- 契約: queue/lease/attemptは既存hostを使う。初期同時推論1。1段階の実行budgetは30秒を初期上限とし、期限超過はcancel→確認→再試行方針へ移す。LANアドレスだけでLocal適格にせず登録区分と転送契約を確認する。Cloud fallback禁止。
- 試験/検証: A19、A20、A43。fixture providerで成功、不正JSON、候補超過、timeout、入力版変更、外部登録拒否、provider利用不可を検査。HF(world)、HF(inference)、HF(queue)、HA。
- 完了条件: すべての採用は型/意味/版検査を通り、モデルが直接ID・active・実行成功を確定できない。

## P4-03 前景優先と取消と再開

- 先行条件: P4-02。
- 変更先: Hのworld/queue/scheduler公開接続、foreground通知経路、world/test/scheduling.test.ts。
- 作業: 会話/ASR/TTSが資源を要したら背景抽出を取消または未実行待機にする。取消未確認の推論slotを再利用しない。元attemptの遅着結果はsettleで拒否し、入力がまだ有効なら別attemptへ再開する。
- 契約: sleepで前景開始を遮らない。clock/foreground/キャンセル応答はhost試験へ注入する。無入力状態の定期実行でLLM呼出しを生成しない。
- 試験/検証: A44。cancel即応/遅延/無応答、foreground開始/終了、再起動、旧attempt遅着。HF(world/queue/scheduler/voice-dialogue)、HA。
- 完了条件: 同時Local抽出は上限1を超えず、取消未確認時に新slotを作らない。checkpointがある未完了入力を失わない。

## P4-04 Runtime結果の観測化

- 先行条件: P4-01、P1-09、P3-07。
- 変更先: Hの実行台帳所有domainの公開RuntimeSnapshot、world/service/runtime-adapter、world/test/outcomes.test.ts。
- 作業: 検証済み実行結果からcomparisonId/metric/unit/config/baseline/期間を取り出し、Worldの予測と照合する。元台帳のrevisionと検証状態をinput dependencyへ含める。
- 契約: LLMの「完了しました」をruntime_observationにしない。Tool実行の成否は元台帳が所有し、Worldは支持/反証の意味評価だけを追加する。公開実行台帳がなければその接続票を待機し、fixture部分だけ完了として区別する。
- 試験/検証: A18、A45。成功報告と実測不一致、比較条件不足、元結果の訂正/forget、重複通知を検査。HF(world)、該当所有domainのHF、HA。
- 完了条件: 観測が検証済み元台帳の版へ追跡でき、Worldによる実行成功の捏造がない。

## P4-05 日本語抽出の実モデル評価

- 先行条件: P4-02、03、G5。結果照合を評価するケースはP4-04も必要。
- 変更先: Wの`eval/extraction/{dataset,runner,scoring}`、packageの`eval:extraction`、`spec/evaluation-baseline.md`。
- 作業: 否定/仮定/伝聞/別人/同名/期間/条件違い/多根拠/訂正/通常例の10群各20件、計200件を合成し、各群10件を開発用、10件をholdoutに固定する。正解をモデル実行前に保存し、group/sample/versionを固定する。
- 契約: holdoutをprompt調整へ使わない。閾値は初期受入として採用precision>=0.95、不明の適切な保留recall>=0.95、否定/仮定/伝聞の区分正解率>=0.95。Scope漏洩、引用捏造、忘却後復活、hypothesisの実測化は1件でも失敗。品質率は分子分母とケースIDを示す。
- 試験/検証: A46。明示的なevalコマンドだけがLocal Providerを呼ぶ。通常verifyではrunnerとscoringをfixtureで検査。モデルID/版/設定、入力bytes、p50/p95、timeout率、可能なら推論費用を保存する。成功したサンプルだけで集計しない。
- 完了条件: deterministicと実モデルの結果が別表にあり、100件holdoutで閾値を満たす。実行環境や正解が不足する場合は未受入。閾値を結果を見て緩める場合は新しい評価版と理由が必要。

## P5-01 判断APIを製品で使う入口

- 先行条件: P3-09、P1-08、09。自動抽出入力を使う場合はP4も完了。
- 変更先: Hのworld/contracts/service/controller/test、Broker、model tool選択の公開接続。
- 作業: query modeをsnapshot/relevance/influence/dependencies/scenarios/gapsから列挙選択し、Scope・Goal・予算・起点を検査して純粋APIへ渡す。LLMの自由SQLや汎用graph mutationを受け付けない。
- 契約: Gapは調査候補で実行許可ではない。Taskへの連携はhostが委任と予算を確認し、安定キーで重複排除する。既存Task公開口が未完成ならGap表示までに留め、実行結合を未受入とする。
- 試験/検証: A14〜A18、A47。全modeの上限/不正入力、権限外、同じGapの重複、許可なしのTask作成0を検査。HF(world)、利用側domainのHF、HA。
- 完了条件: 利用者は根拠・条件・不足を受け取り、推論結果から権限を拡張しない。

## P5-02 根拠付き一覧と訂正画面

- 先行条件: P5-01。
- 変更先: Hのweb側world domainとAPI controller、worldのUI/ブラウザ試験。
- 作業: 一覧に対象/主張/採用状態/根拠種別/鮮度を分けて表示。詳細に条件、支持と反証、source版、履歴を表示。明示訂正/撤回/forget操作をrevision付きで送信し、競合時は再読込みを促す。
- 契約: グラフ可視化やUIから直接edgeを書換える機能を先行しない。candidateと実測を同じ確定表示にしない。UIはbackendの認可失敗を「存在するが見せない」と明かさない。pending forgetは完了表示しない。
- 試験/検証: A48。競合訂正、曖昧対象、Scope切替、forget pending/complete、再起動後、読み上げ対象なしをブラウザで確認。HF(world)、HA。
- 完了条件: 利用者が根拠と条件を確認して訂正でき、表示だけの変更で台帳を偽装しない。

## P5-03 一つの改善仕事を閉じる

- 先行条件: P5-01、02、P4-04。
- 変更先: Hの受入シナリオ、Wの`eval/scenarios/cache-latency`と評価記録。
- 作業: 声の応答遅延改善を例に、明示Goal→cache候補→成立条件/依存→測定計画→許可された実測→assessOutcome→再評価を一巡させる。model/prefix/input長/warm状態/metric/単位/期間を固定する。
- 契約: 比較用の構成が揃わなければincomparable。評価器は事前に固定した実測値で採点し、Worldの予測を正解にしない。Tool実行権限がない場合に自動測定を開始しない。
- 試験/検証: A45、A49。支持/反証/比較不能の3系列、途中訂正、Goal撤回を実施。HF(world/関連実行domain)、HA。
- 完了条件: 採用判断と測定結果が版で結び付き、「作業完了」と「仮説支持」を別々に報告できる。

## P5-04 Worldを使う意味品質の比較

- 先行条件: P5-03、G5。
- 変更先: Wの`eval/decision/`、packageの`eval:decision`、結果レポート。
- 作業: 20個の固定仕事をMemoryのみ/Memory+関連/Memory+条件付きWorldの3条件で同じモデル・入力予算・seed設定により比較する。各仕事に根拠・必要条件・適切な保留・禁止断定の事前rubricを持つ。
- 契約: 4軸を各0/1で採点し、主観的な総合印象だけで比較しない。World条件がMemoryのみより改善した仕事数と悪化した仕事数を報告。初期受入は安全上の失敗0、悪化0、少なくとも5仕事で改善とする。達成しなければP5未受入。
- 試験/検証: A50。評価入力をprompt調整用から分け、出力、引用、採点根拠、token/latency、訂正回数を保存。通常verifyに実モデル実行を含めない。
- 完了条件: 有用性の主張が比較結果へ追跡できる。平均点でScope漏洩や因果誤認を相殺しない。

## P6-01 ContextStillの知識参照

- 先行条件: P5-04、G6の知識契約。
- 変更先: Hのworld/service/context-source-adapter、契約試験、Wの接続仕様。
- 作業: 公開APIで取得できる知識ID/不変版/digest/Scope/削除通知/再照合の可否を実験して記録する。条件を満たす場合だけSourceAdapterに永続参照として登録する。
- 契約: 欠ける要件がある場合は一回の要求の一時参考に限定し、永続World主張の根拠にしない。取得した文面をsystem命令へ昇格させない。外部へ書込みやメッセージ送信をしない。
- 試験/検証: A51。版変更、削除、Scope拒否、timeout、不変版なしをadapter contract testで検査。HF(world)、HA、実接続のread-only受入。
- 完了条件: 実際に確認した機能範囲で接続が動く。要件不足時の一時参考動作も正式な限定結果として記録し、永続接続完了とは分ける。

## P6-02 CapabilityとToolchainと自己改善への証拠

- 先行条件: P5-03、G6の実行/Registry契約。
- 変更先: HのCapability/Task/評価台帳の公開接続、world/service/outcome-adapter、横断試験。
- 作業: capability ID/版/依存、実行台帳の検証結果、事前予測と差をWorldへ参照として渡す。自己改善には失敗条件・比較可能な観測・不足根拠を出す。
- 契約: 能力の登録/許可/実行直前の適格判定は元Registry/Taskに残す。Worldはコード生成・導入・権限付与の主体にならない。候補の版、評価器の版、採否の版を分離し、評価器更新で過去採点を黙って書換えない。
- 試験/検証: A52。未登録能力、版失効、無許可実行、検証失敗、自己評価だけの成功報告、評価器の版違いを検査。関連HFとHA。
- 完了条件: World仮説をそのまま正解にする閉路がなく、公開契約未完成の接続は未受入とする。

## P6-03 複数Scopeと長期運用

- 先行条件: P4、P5と採用するP6外部接続の受入。
- 変更先: Hの長期受入runner、Wの`spec/operational-acceptance.md`。
- 作業: 2 principal×3 Scopeで24時間以上、会話/音声/背景抽出/訂正/forget/再起動/一時Provider断を組み合わせる。合成source中心にし、秘密を通常ログへ出さない。queue oldest age、pending件数、cancel時間、LLM要求数、RSS、前景p95を採る。
- 契約: 初版の通常queryは一度に単一Scope。複数Scope表示はホストで許可済み結果を組み合わせ、他Scopeの推論edgeを作らない。World ON/OFFに関わらずforgetを処理する。foreground性能は同じ負荷fixtureの背景OFFをbaselineにする。
- 試験/検証: A53。無入力期間のLLM要求0、削除後復活0、Scope漏洩0、取消未確認slot再利用0。背景ONの会話p95悪化<=5%を初期閾値にする。設定・測定窓・負荷・失敗ログを保存。
- 完了条件: 24時間の実測があり、固定fixture成功で長期運用の代用をしない。未達時は原因/再測定条件を残して未受入とする。

## P6-04 運用手順と最終受入

- 先行条件: P6-01〜03。限定接続を採る場合はその制約が製品仕様に明記済み。
- 変更先: W/Hの運用手順、配布manifest、進捗表、受入レポート。
- 作業: clean install、固定版upgrade、World停止、schema不一致、journal復元、墓標を維持したrollback、Provider停止、再同期を手順書にし、使い捨て運用環境で実施する。
- 契約: 旧SAAAデータの一括移行はこの計画に含まない。別工程で原典/版/Scope/墓標を再現できるデータだけ取り込む。旧DBの復元で最新忘却を消さない。
- 試験/検証: A54、全体F/consumer/HA、採用する実モデル・外部接続・長期レポートを紐付ける。手順ごとに成功/未実施/失敗を記録する。
- 完了条件: すべての採用機能について実装/fixture/SQL/host/実モデル/実運用の到達状態が追える。限定・未受入を隠して「全体完成」としない。
