# P1とP2の実装作業票

全票が未着手。パスの`D/<name>`は`src/domains/<name>`を表す。検証記号F/D/Sと共通完了条件は[計画本体](../implementation-plan.md)、契約C1〜C9は[実装契約](contracts.md)、試験IDは[受入ケース](acceptance.md)を参照する。以下のファイル名は作成先の指定であり、既存APIの説明ではない。

## P1-01 共通値と検査の基盤

- 先行条件: P0。G1のMemory配布物は不要。
- 変更先: `src/contracts/{ids,values,versions,limits,result,canonical}.ts`、同index、`test/contracts/common.test.ts`。domain固有payloadは置かない。
- 作業: C2のsafe integer、有限値、文字列byte数、Scope、契約版のruntime検査を実装する。canonical JSONはobject key昇順、意味配列の順を保持、集合は呼出し側でsort、undefinedと非有限値を拒否する。UTF-8のbyte列を返す。
- hash: `CanonicalHasher = (bytes: Uint8Array) => string`を注入する。runtime依存を追加しない。試験側は`node:crypto`のSHA-256を利用し、空文字と既知ASCII/日本語fixtureのdigestを固定する。製品hostは同じ方式の同期関数を供給する。identity hashや常に同じ値のstubは禁止。
- 契約: 公開失敗型にINVALID_INPUT、UNSUPPORTED_CONTRACT_VERSION、LIMIT_EXCEEDED、SCOPE_NOT_PERMITTEDを用意。未知フィールドを捨てて受理せず、公開更新入力はstrictに検査する。
- 試験/検証: A01、A02。`bun test ./test/contracts`とF。byte長の閾値ちょうど/超過、revision 0/小数/上限超過、key順の差、配列順の差を検査。
- 完了条件: 型だけでなくunknownからの検査が通り、同じ意味のcanonical値のbytes/digestが一致する。srcの時計・乱数・hash driver依存は0。

## P1-02 Memory共有型の配布境界

- 先行条件: P1-01。G1の公開配布物を確認する。
- 変更先: `vendor/eumenes-memory/`の固定配布物とmanifest、`scripts/vendor-memory.ts`、package.json/bun.lock、`src/contracts/source.ts`、`scripts/boundaries.ts`、`test/tooling/boundaries.test.ts`、`test/contracts/source.test.ts`。Memoryリポジトリは読取りのみ。
- 作業: 公開SourceRef/AccessContext/SourceStateを含む固定版を確認し、version・SHA-256・取得元・公開exportをmanifestへ記録する。生成元が追跡できる配布物をローカルfile依存に固定する。既存配布物がなければ、読取り専用のMemory公開packageとsrcから一時stagingへTypeScriptでJS/d.tsを生成し、同じ公開exportsを持つローカル配布物を作る。Memory自身のファイルやpackage設定は変更しない。source hashと生成コマンドをmanifestへ記録し、公式リリースとは呼ばない。公開型を生成できない場合にだけ、不足export/依存と生成エラーを記録してG1待機にする。
- 契約: import typeだけをsource.tsから許可し、値import・private subpath・隣接source import・他ファイルからのMemory importは境界試験で拒否。SourceSnapshotは共有SourceStateを使用して現行版とScopeを表す。
- 試験/検証: A03、A17。隣接checkoutを参照できない一時consumerでfrozen install/typecheck。F。型定義の参照先がvendor配布物内で閉じることをlistFilesで確認する。
- 完了条件: G1の証拠が保存され、公開型が手書き複製なしで使える。外部型境界の試験が負例を拒否する。配布物待ちを完了にしない。

## P1-03 条件と時間の三値評価

- 先行条件: P1-01。P1-02待ちでも着手できる。
- 変更先: `D/conditions/contracts/{condition,time}.ts`、`service/{evaluate,validity}.ts`、index/契約index、`test/{conditions,time}.test.ts`、`fixtures/conditions/*.json`。
- 作業: C5のASTと深さ/件数上限を検査する。compare→not→all/anyの順に実装する。観測の鮮度、validTimeの精度、単位不一致、同順位の矛盾を先に判定し、比較不能はunknownにする。
- 契約: 空条件=unknown。無条件はexplicitly_unconditionalと採用根拠IDの組のみ許す。複合式は短絡可能だが決定的な理由順を維持する。時刻を内部発行しない。
- 試験/検証: A04〜A06。三値のNOT3通り、AND/OR各9通りを表形式で全列挙。D(conditions)、F。
- 完了条件: 条件不明をsatisfiedへ変えるmutationで試験が失敗し、月精度を日付へ捏造しない。

## P1-04 対象の識別と可逆な統合

- 先行条件: P1-01。aliasの根拠は共通EvidenceId参照とし、SourceRef取得はしない。
- 変更先: `D/identity/contracts/entity.ts`、`service/{resolve,merge,split}.ts`、公開index、`test/identity.test.ts`、`fixtures/identity/*.json`。
- 作業: 明示ID・外部参照の完全一致を先に解決する。aliasはScope内の候補集合として扱い、0件missing/1件resolved/複数ambiguous。大文字小文字や同義語の推測による統合をしない。初版aliasはtrimとUnicode NFCのみ、元表記も保持する。
- 契約: mergeは対象ID集合、代表ID、操作ID、expected revision、明示根拠を要し、元ID/alias対応の履歴計画を返す。splitはそのmerge操作IDを指し、元対応を復元する。履歴外の再推測はしない。
- 試験/検証: A07。同名別Scope、同Scope複数候補、外部ID違い、merge→split、古いexpected revision、代表への循環mergeを検査。D(identity)、F。
- 完了条件: 他Scopeの名称/件数を返さず、merge/splitで入力集合を変更しない。DB処理はまだ作らない。

## P1-05 主張の検査と状態遷移

- 先行条件: P1-02、03、04。
- 変更先: `D/assertions/contracts/{assertion,evidence,transition}.ts`、`service/{validate,transition,evidence-roots}.ts`、公開index、`test/{assertion,transition,evidence}.test.ts`。
- 作業: C4の全フィールドとorigin/lifecycle/freshnessを分離する。主張のsubject・typedValue/relationの排他、Scopeと参照版、引用byte rangeとdigest、根拠の種別を検査する。遷移表を一箇所に実装し、新revisionの計画を返す。
- 契約: model_hypothesisはcandidateから開始。active化は採用規則IDまたは明示操作が必要。根拠数はunique root系列を数えるが確率へ変換しない。assertionsからidentity/conditionsの公開口を参照する時点でdependsを追加。
- 試験/検証: A08〜A10。遷移表の全許可辺と全禁止辺をtable testにする。source本文の日本語byte範囲、assistant要約、同root10件、古い版の訂正を検査。D(assertions)、F。
- 完了条件: 訂正計画が旧版停止と新版の関連を同時に含む。根拠にないconfidence・runtime成功を作らない。

## P1-06 失効と忘却の純粋計画

- 先行条件: P1-01。G1待ちでもIDと辺だけの処理は着手できる。
- 変更先: `src/contracts/dependent.ts`、`D/lifecycle/contracts/plan.ts`、`service/{invalidation,forget}.ts`、index、`test/plans.test.ts`。
- 作業: 型付きDependentRefの有向辺から逆依存閉包を辿る。支持根拠の辺とは独立した入力依存辺を使う。cycleをvisitedで止め、走査budgetまでの削除計画と残りcursorを返す。
- 契約: payloadをこのdomainへ持ち込まない。別domainをimportしない。planForgetはScope外IDを出力しない。budget超過は完了falseとrequiresClosedGateを返す。安定したkind/id/revision順で続行する。
- 試験/検証: A11。引用していない入力sourceからの派生、循環、多段、複数root、Scope越境、batch境界を検査。D(lifecycle)、F。
- 完了条件: 全batchを連結した集合が上限なしの小規模期待集合と一致し、未走査を削除済みと報告しない。

## P1-07 投影とWorldSlice

- 先行条件: P1-03、04、05。
- 変更先: `D/projection/contracts/{snapshot,slice}.ts`、`service/{project,slice,validate-usage}.ts`、index、`test/{projection,slice}.test.ts`。
- 作業: 台帳からactive/disputedの扱いを分けた現在投影を作る。disputedは反証付き表示素材として残すが確定的な因果伝播には使わない。C6のepoch/版/認可/完全性を含むSliceを構築する。serialize後のUTF-8 byte数を確認し説明単位を落とす。
- 契約: projectionはreasoningをimportしない。探索結果が必要ならホスト/上位組立てが後から渡す構造とする。原典本文の取得は行わない。入力snapshotのcomplete=falseか必須検査不足ならblocked。
- 試験/検証: A12、A13、A24の純粋部分。日本語8KiB境界、条件だけ消えるケース、新反証によるepoch変更、認可失敗時の存在情報非公開を検査。D(projection)、F。
- 完了条件: ready/partial/blocked/overflow/disabledを区別し、Slice入力順を入れ替えても意味集合とdigestが安定する。

## P1-08 関連と因果と依存の探索

- 先行条件: P1-03、05、07。
- 変更先: `D/reasoning/contracts/query.ts`、`service/{relevance,influence,dependencies,gaps}.ts`、index、`test/reasoning.test.ts`。
- 作業: APIを関連/因果/依存の三経路に分ける。候補・展開・深さ・経路数の各budgetをループ内で消費し、取得済みsnapshotを超えて外部取得しない。Gapは不足理由と確認候補を返す。
- 契約: C5を適用。Gap順位は「明示Goalの阻害あり→期限が近い→確認費用が低い→ID」の辞書順。期限/費用がunknownなら既知値の後へ置く。費用を架空の数値にしない。Goalは参照入力のみ。
- 試験/検証: A14〜A16。相関・逆向き・条件不明・metric不一致・循環・打切りを含むグラフで各APIの期待経路を固定。D(reasoning)、F。
- 完了条件: path scoreを確率として返さない。partial/no_pathをno_effectへ言い換えない。

## P1-09 仮定比較と予測照合

- 先行条件: P1-03、05、07、08。
- 変更先: `D/scenarios/contracts/{scenario,prediction,outcome}.ts`、`service/{compare,assess}.ts`、index、`test/scenarios.test.ts`。
- 作業: 同じbaselineへoverlay A/Bを別々に適用し、定性的影響を比較する。元snapshotのdeep freezeで変更を検出する。assessOutcomeはcomparisonId・対象・metric・unit・構成・期間・baselineを照合してから比較する。
- 契約: 一致比較ができない場合はincomparable。複数の比較可能な観測が支持と反証に分かれた場合のみmixed。事前予測と観測を取り違えない。定量効果は入力された実測だけを保持し、edgeから生成しない。
- 試験/検証: A18。入力長違い、平均とp95、msとs、期間違い、同条件支持/反証、混在を固定。baseline=100ms/tolerance=2msに対する90/110/99msの3例も固定する。D(scenarios)、F。
- 完了条件: 仮定比較が台帳を更新せず、incomparableをsupportedにしない。

## P1-10 抽出の入出力検査

- 先行条件: P1-02、03、04、05。
- 変更先: `D/extraction/contracts/{manifest,candidate}.ts`、`service/{prepare,validate}.ts`、index、`test/extraction.test.ts`。
- 作業: source/stateの全入力をmanifestへ列挙し、source本文と引用byte範囲から候補を検査する。モデル出力はunknownからparseし、型・数・Scope・引用・subject解決・conditionを確認する。
- 契約: 初期上限は12確定発言または32KiBの先に達した方、候補8、unique入力依存32。1発言だけで上限超過なら保留理由を返し、勝手に意味を分断しない。モデルが出すID/時刻/認可/activeは採用しない。採用に必要な値はhost割当と規則で補う。
- 試験/検証: A19、A20。32/33依存、8/9候補、未確定ASR、存在しない引用、別Scope、reported/hypothetical/negated、不明対象。D(extraction)、F。
- 完了条件: Local推論自体をまだ呼ばず、候補と決定的な検査結果だけを返す。

## P1-11 純粋規則の固定fixtureと公開面

- 先行条件: P1-01〜10完了。G1未解決ならP1完了とはしない。
- 変更先: `fixtures/world-v1/`、`test/contracts/public-api.test.ts`、src/index.ts、各domain index/README、`spec/plan/progress.md`。
- 作業: A01〜A20を入力/期待値/理由のJSON fixtureにし、SAAA継承ケースと意図的変更をメタデータに記す。SAAAを実行依存にしない。公開APIをindexから明示exportし、private helperをexportしない。
- 契約: 外部ネットワークと隣接checkoutなしで全fixtureを実行できること。SAAA互換は共通fixtureで一致を確認した意味規則に限る。
- 試験/検証: 全8domainのDとF。型の公開面、入力immutable、未知版拒否を確認。空条件・相関伝播・同root重複の各ルールを一時的に壊し対応試験が失敗することを確認したら必ず元に戻す。
- 完了条件: 全8domainに実ケースがあり、0件/skipによる成功なし。実モデルやSQLの完成は主張しない。

## P2-01 物理schemaとAPIの仕様固定

- 先行条件: P1-11。
- 変更先: `spec/schema-v1.md`、`spec/sqlite-api-v1.md`、`test/sqlite/schema-design.test.ts`、各domainのrepository/README。まだ業務DMLを実装しない。
- 作業: C7の全表について列名/SQLite型/NULL可否/PK/UNIQUE/FK/CHECK/索引/保持・消去区分をDDLまで書く。C8のoperation unionについて入力型、読み書きする表、正常result、拒否理由、更新順を操作ごとに記載する。
- 決める値: 全表のprincipal/scope_keyはNOT NULL。revision>=1。lifecycle/origin/kindはCHECK。source/state逆引きはScopeを先頭に置く。canonical payloadは再送判定のdigestだけをoperationへ保持する。本文は所有表以外へ複製しない。
- 試験/検証: 各DDLを新規一時SQLiteへ適用し、必須制約の違反を試験案へ対応付ける。sqlファイルを実行する製品migrationはP2-02で作る。A21〜A28の各検査対象列が存在するか文書レビュー。
- 完了条件: C7の全表と全更新operationにDDL/手順/削除方針があり、SQL所有の未決定箇所がない。パッケージ間契約変更が必要なら差分を先に記録する。

## P2-02 migrationとschema互換検査

- 先行条件: P2-01。
- 変更先: 各domain`repository/migrations/001.ts`とsqlite.ts、`src/infrastructure/sqlite/migrations/{index,manifest}.ts`、`test/sqlite/{migrations,schema}.test.ts`、試験hostのmigration選択。
- 作業: descriptorを固定順に集約する。world_schema_infoを最初に作り、同じhost transactionで適用版/hashを記録するSQLを用意する。Worldに独自のmigration実行loop/transactionを作らず、試験hostと製品hostが実行する。
- 契約: P0のmigrations文字列配列との互換を保つ。既存probe基盤試験は`migrations: []`を明示してschemaなしの試験を維持し、製品migrationの試験と区別する。実装後に「製品schemaなし」というP0専用期待値を製品DBへ当てない。
- 試験/検証: A21、A22。空DB、適用済み、途中失敗、hash不一致、未来版、古い版から追加migrationを検査。`bun run test:sqlite`、F。
- 完了条件: 既適用migrationの変更を検出でき、新規とupgradeの両方で同じschemaになる。失敗後の部分schemaをhost rollbackで残さない。

## P2-03 所有domainごとの同期repository

- 先行条件: P2-02。
- 変更先: 下記子票のrepository/sqlite.ts/test。sqlite公開口からだけ他domainへ接続する。各子票の完了を進捗へ別記する。
- P2-03.a identity: `repository/entities.ts`と`test/identity-sqlite.test.ts`。entity/alias/eventの登録、限定照会、merge/split計画の適用を実装。A07、A21、A23を実DBで確認。D(identity)。
- P2-03.b assertions: `repository/{assertions,evidence,dependencies}.ts`と`test/assertions-sqlite.test.ts`。版付き主張/根拠/遷移/入力依存を登録。expectedRevision付きUPDATEが対象1件か確認し、0件を成功にしない。A08〜A10、A23。D(assertions)。
- P2-03.c projection: `repository/{current,edges,epoch}.ts`と`test/projection-sqlite.test.ts`。同Scopeの投影を置換しepochを進め、両端から上限付きedgeを読む。A12、A14、A24。D(projection)。
- P2-03.d scenarios: `repository/{predictions,outcomes}.ts`と`test/scenarios-sqlite.test.ts`。予測/観測版を保存し条件とcomparisonIdを保持。overlayの保存APIは作らない。A18、A23。D(scenarios)。
- 共通手順: inTransaction検査→Scope検査→事前検査→bindされたDML→件数確認。domainのreadは同じdbから限定取得する。各domainに型付きdelete/invalidate公開口も用意し、他domainのSQLは書かない。
- 完了条件: 各子票がfile/WALとmemoryで正常更新/途中例外rollbackを通る。共通World operationの原子性は次票で確認し、repository単体成功で代用しない。最後にF。

## P2-04 複数domainの更新調整と再送

- 先行条件: P2-03.a〜d。
- 変更先: 計画追加の`src/application/sqlite/{index,apply,read,validate-usage}.ts`、`D/lifecycle/repository/{gate,operations,tombstones}.ts`、src/sqlite.ts、scripts/boundaries.ts、test/tooling、`test/scenario/{atomicity,replay}.test.ts`。
- 作業: C8のapplyWorldOperationを作る。lifecycleでgate/墓標/operationのメタデータを読む→各domainで事前検査→各公開sqlite操作→投影とepoch→receiptの順に更新する。source currentを同じhost transactionから引数で渡す契約を型にする。
- 境界: application/sqliteを同期永続層として認識し、domain→applicationを拒否、application→domain privateを拒否する負例を追加。src/sqlite.tsは調整済みAPIだけをexport。他domainに業務SQLを移さない。
- 試験/検証: A23〜A26。各DML段階で試験用接続wrapperが例外を投げ、台帳/投影/epoch/receipt/host_probeのすべてが戻ることを照会する。F、S。
- 完了条件: txなし拒否、同key同内容no_op、同key異内容拒否、commit直後の応答喪失再送、expectedRevision競合が同じ公開APIで成立する。接続を保持せず新規Writerを作らない。

## P2-05 一貫したsnapshotと限定照会

- 先行条件: P2-04。
- 変更先: `src/application/sqlite/{read,validate-usage}.ts`、各domain公開read、`test/scenario/{snapshot,scope}.test.ts`。
- 作業: readWorldSnapshotはホストのread/write transaction内で複数SELECTを行う。transaction外はWorldTransactionRequiredError。accessに許された単一Scopeを要求し、SQL WHEREへ必ずprincipal/scopeを含める。候補500などのbudgetを各取得段階へ配分する。
- 契約: 純粋buildWorldSliceへ必要素材だけを渡す。認可外を取得して後でfilterする方式は禁止。履歴照会も現在の認可/墓標を検査する。再検証はwriter上のscope epoch/source版まで確認する。
- 試験/検証: A24、A27。WAL reader snapshot中にwriterが更新し、同じreadの前後で旧snapshotが一貫し、次readで新版が見えること。D(projection)、F、S。
- 完了条件: 読取りもborrowed dbだけを使い、複数SELECTの混在snapshotを返さない。LIMITだけで取得済みの巨大集合を隠さない。

## P2-06 inboxとmanifestとcheckpoint

- 先行条件: P2-04。
- 変更先: `D/extraction/repository/{inbox,manifests,checkpoint}.ts`、sqlite.ts、`test/extraction-sqlite.test.ts`、`src/application/sqlite/apply.ts`。
- 作業: durable inboxのeventIdで重複受領を防ぐ。受付cursorと意味適用checkpointを別列にする。manifestは不変ID/版、全入力依存、処理状態を持つ。job/lease/attemptの所有表は作らない。
- 契約: フィードキーはprincipal・Scope集合をsortしたキー・restoreEpoch・feed種類。seqに欠番を許し、+1を推測せずフィードのnext cursorを保存。保留イベントはreceivedのままでも後続forgetの処理を止めない。
- 試験/検証: A20、A28、A29。100→105の欠番、重複受領、cursor保存失敗、保留の後の削除、旧epoch cursor拒否。D(extraction)、F、S。
- 完了条件: crash後に受領済みと未適用が区別でき、候補採用・checkpoint・operation receiptが同時に保存される。

## P2-07 訂正と忘却の永続適用

- 先行条件: P2-04、06、P1-06。
- 変更先: `D/lifecycle/repository/forget.ts`、`src/application/sqlite/{invalidate,forget}.ts`、各domainの削除公開口、`test/scenario/{forget,correction}.test.ts`。
- 作業: 新たな訂正では古い主張を即停止。forgetはgateを閉じ→依存閉包の次対象をworld_forget_targetへ保存→domainごとの消去→投影除去→墓標→進捗を更新する。削除前に次の逆依存を同じtransactionで保存し、辺の消去で未走査対象を失わない。chunkは最大500対象/回、続きがあればpendingのまま。
- 契約: 支持根拠だけでなく全入力依存を消す。write結果のappliedは「当該chunk適用」を表し、forget全体は別のpending/completeを持つ。completeを返すのは閉包消去と再構築完了時のみ。外部journal/receiptはP3で確認する。
- 試験/検証: A11、A29〜A31。引用しなかったsourceのforget、長い閉包、途中失敗、World OFF、モデル不在、forget済みsourceの遅着採用、旧payloadのLIKE検索と公開照会を確認。F、S。
- 完了条件: 管理対象の全payload列に本文が残らず、墓標と最小進捗だけ残る。pending中は対象Scopeが閉じている。

## P2-08 復元と再構築の本体手順

- 先行条件: P2-05、06、07。
- 変更先: `src/application/sqlite/{restore,rebuild}.ts`、lifecycle gate、`test/support/restore-fixture.ts`、`test/scenario/restore.test.ts`。
- 作業: 試験専用の古いDB fixtureと最新の外部journalを別々に作る。restoreEpochを更新しgateを閉じた状態で、全manifestの依存を列挙→外部再登録結果を入力→墓標/版照合→投影再構築→gate再開する。
- 契約: テストのjournal adapterはメモリ/一時ファイルのfixtureであり、製品journalの耐久性はP3-05まで未受入。テストDB以外のバックアップを読まない。TOMBSTONEDなら派生物を消去し再登録成功とみなさない。
- 試験/検証: A32。古いDB・新墓標、巻戻ったseq、未登録辺、途中crash、未知source、restoreEpoch違い、再実行で同じ結果を検査。F、S。
- 完了条件: 再構築後の投影が台帳からの純粋結果と一致し、不明な依存が残る場合はgateを開かない。

## P2-09 取得上限と性能の計測

- 先行条件: P2-05、07、08。
- 変更先: `scripts/bench-world.ts`、packageの`bench:world`、`fixtures/performance/`の決定的generator、`spec/performance-baseline.md`、`test/scenario/budgets.test.ts`。
- 作業: seed固定の1千/1万/10万主張、high-degree、cycleを合成する。生成時間と照会時間を分離し、warmup10回+測定100回でp50/p95、取得行数、展開数、UTF-8出力bytes、RSSを記録する。SQLのEXPLAIN QUERY PLANで主要索引使用を保存する。
- 契約: 取得行数はdriverから返った行数であり走査行数と呼ばない。走査計数が取得不能なら未計測を明記する。DB生成や移行全体を短いwriterの20ms予算へ混ぜない。
- 試験/検証: A33。上限は機材非依存の必須検査。時間の仮受入値は代表1万主張Slice p95<=50ms、通常単一operationのwriter p95<=20ms。機材/fixture/版を固定して測り、未達なら段階完了を保留して取得分割を行う。F、S、`bun run bench:world`。
- 完了条件: 生の測定データと環境が残り、10万件でも全件をJSへロードしない。閾値変更は理由と比較測定を記録してから行う。

## P2-10 永続化段階の受入

- 先行条件: P2-01〜09。
- 変更先: `test/scenario/world-lifecycle.test.ts`、公開API文書、進捗表。
- 作業: 新規一時file/WALで対象登録→明示主張採用→Slice→訂正→旧Slice拒否→forget→再構築を一つのケースにまとめる。全段階でhost_probeも同じtransactionへ参加させる。
- 試験/検証: A21〜A33、全D、F、S。変更のない同じ操作を再送し、主張版・epoch・件数が増えないことを照会する。
- 完了条件: 本体のSQL受入が完了。EumenesのWriter queue、実Memory登録、journal耐久性、実モデルを未受入として明示し、P3の入口に実行済みAPI一覧を渡す。
