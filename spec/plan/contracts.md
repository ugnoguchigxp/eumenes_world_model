# WorldModel 実装時に固定する契約

ここに記したAPI名・ファイル名・値は後続実装の仕様。現在存在する業務APIではない。Solは作業票を実装するときにこの契約へ従い、変更が必要なら理由と影響する受入ケースを先に更新する。

## C1 境界と依存方向

`src/contracts`には複数domain共通のID、値、版、result、SourceRef型の再export、およびその共通値の検査・canonical化を置く。固有payloadやSQLを集めない。domainのcontractsは型と定数、serviceは純粋処理、repositoryは同期SQL、testはそのdomainの試験を所有する。

後続実装で許可する直接依存の上限は次のとおり。実際のdependsはimportができた票で追加し、まだ使わない辺は追加しない。privateパスを別domainからimportしない。

| domain | 参照を許すdomain | 主な責務 |
|---|---|---|
| conditions | なし | 時間、単位、三値、式評価 |
| identity | なし | ID、Scope、alias、可逆な統合履歴 |
| lifecycle | なし | 型付き対象IDの失効計画、墓標、起動gate、forget進捗 |
| assertions | identity、conditions | 主張・根拠・採用遷移 |
| projection | identity、conditions、assertions | 再構築可能な状態とedge、Slice素材 |
| reasoning | conditions、assertions、projection | 関連・因果・依存・Gap |
| scenarios | conditions、assertions、projection、reasoning | overlay、予測と結果照合 |
| extraction | identity、conditions、assertions | manifest、候補検査、入力進捗 |

lifecycleは上位domainをimportしない。失効計画の入出力は共通の`DependentRef { kind, id, revision }`と有向依存辺だけ。実際の削除操作はP2-04で追加する`src/application/sqlite/`が各domainの公開sqlite入口を呼ぶ。全domainからapplicationへのimportを禁止する。

`src/sqlite.ts`がホストへ公開する更新APIはapplicationの調整済み操作に限定する。各domain/sqlite.tsはリポジトリ内の公開口であり、package subpathとして外へ公開しない。これによりホストが墓標・投影更新を省略した単独repository呼出しをしない構造にする。

applicationは接続を借りるだけでtransactionを作らない。MemoryとEumenesのSQLは一切置かない。ホストはWorld操作後のMemory登録も同じtransaction内で実施し、失敗を例外にして全体を戻す。

## C2 共通の値と版

| 値 | 契約 |
|---|---|
| WorldContractVersion | 初版は数値リテラル1。未知版は入力検査で拒否 |
| principal / scopeKey | 空でない不透明文字列。正規化で別Scopeへ変換しない。全所有キーに含める |
| ID | 呼出し元が発行する空でない不透明文字列。World内部のUUID、乱数、時計による発行は禁止 |
| revision | World内部は1以上のsafe integer。対象ごとに+1。別対象やsourceの版と比較しない |
| source revision | Memory公開SourceRefの値をそのまま使用。大小を推測せず一致だけを検査 |
| 時刻 | 呼出し元が渡すsafe integerのUTC epoch ms。revisionの代わりに順序判定しない |
| typedValue | string、boolean、finite numberと明示unit、entityRefの判別union。NaN/Infinity/undefinedを拒否 |
| 期間 | 開始を含み終了を含まない。exact instantか、精度day/month/yearと元表現を保持した期間。月を架空の一日へ書き換えない |
| digest | 初版はSHA-256の小文字hexを`sha256:`で識別。ハッシュ対象のcanonical versionを別に持つ |
| World epoch | `(principal,scopeKey)`ごとの投影変更番号。保存済みの素材集合が変わったら+1。同じ変更の再送では増やさない |
| forgetEpoch / restoreEpoch | ホストが現在値を渡す不透明トークン。World epochと混同しない。等値だけを検査 |

文字列の最大長、payload上限、条件上限は`src/contracts/limits.ts`で一箇所に定義し、境界値を試験する。初版はID・版文字列・predicate 256 UTF-8 bytes、通常string value 4KiB、単一更新payload 64KiB、入力manifest最大32のユニークsource/state依存。上限超過は切捨てずrejected。`operationKey`はScope内256 bytes以内。

主張payloadの文字列は参照データであり命令権限を持たない。プロンプト内でsystemや現在のユーザー指示へ昇格させない。

## C3 Memory共有型の導入

SourceRefとAccessContextはMemoryの公開exportを`import type`する。独自に同名構造を再定義しない。確認時点のMemoryではSourceRefはnamespace/kind/id/revision/digestと任意representation/range、AccessContextはprincipal/scopeKeys/purpose/policyRevisionを持つ。

Memory配布物を固定版・hash付きでvendorへ配置し、package依存とlockに固定する。registryに同名があると推測して取得しない。隣接srcへのpath依存・symlink・tsconfig pathsを恒久的に使わない。既存の固定配布物がなければP1-02で読取り専用の公開ソースから一時stagingへ生成する。手書き型の抜粋はせず、TypeScriptが生成する型宣言とJS、元packageの公開exportを保持する。生成元hash・生成手順・ローカル生成である旨を記録する。公開型や依存不足で生成不能ならG1を未完了とする。SourceRefを要しない条件評価やID解決の純粋部分は進めてよい。

型importは`src/contracts/source.ts`一箇所に制限し、境界検査のallowlistもそこだけにする。runtime import、Memory private subpath、全体への外部import解禁は禁止。型の正本は配布物であり、手書きの仮型やambient宣言で不足を隠さない。

SourceRef自体に所有Scopeはない。ホストが提供する検証済みSourceSnapshotにprincipal/scopeKey/status/current revisionを含める。scopeの存在をSourceRefから推測しない。source keyは公開仕様の配列順に従い、コロン連結で衝突し得るIDを自作しない。公開runtime helperが必要ならホストで計算して渡す。

## C4 純粋APIと状態遷移

全純粋APIは同期、入力immutable、出力deterministicとする。同じ入力から同じ配列順と理由コードを返す。末尾の同順位はID昇順で解決。runtime schema検査は公開入口で行い、型assertionで入力を通さない。

| 所有domain | 初版公開操作 | 入力→出力の要点 |
|---|---|---|
| identity | resolveEntity、planMerge、planSplit | Scopeと対象集合・明示操作→resolved/ambiguous/missingまたは履歴計画 |
| conditions | evaluateConditions、compareValidity | 式・版付き観測・asOf→satisfied/violated/unknownと理由 |
| assertions | validateAssertion、planAssertionTransition、groupEvidenceRoots | draft・source検査結果・現行版→検査結果、次版計画、根拠系列 |
| projection | buildProjection、buildWorldSlice | 許可済みsnapshot・要求・上限→投影またはSlice |
| reasoning | explainRelevance、traceInfluence、checkDependencies、findResearchGaps | bounded snapshot・起点・Goal参照→経路/不足と完全性 |
| scenarios | compareScenarios、assessOutcome | 同じbaselineとoverlay/予測・観測→差、支持/反証/mixed/incomparable |
| extraction | prepareExtraction、validateCandidates | 許可済み入力manifest/候補→推論素材/採用候補と却下理由 |
| lifecycle | planInvalidation、planForget | 版付き対象・依存辺・要求→閉包、削除順、未走査の継続情報 |

候補の単一draft検査とbatch検査を分ける。batchの一部不正を黙って採用しない。validateCandidatesは全候補の判定を返し、明示的に選択されたaccepted集合だけを後続更新へ渡す。

Assertionの固定フィールドは全体設計の基本形を継承する。entityやscopeの主張をLLMが発行しても、ホスト確認前には採用しない。originとlifecycleとfreshnessを別のunionにする。

| 現行→次状態 | 許される理由・必須条件 |
|---|---|
| 新規→candidate | 構造・Scope・source検査済み。model_hypothesisの初期状態は必ずcandidate |
| candidate→active | 明示採用または登録済みの決定的な採用規則ID。モデルconfidenceは採用規則にならない |
| active→disputed | 同一対象・predicate・重なる条件で両立しない根拠。反証参照を付ける |
| disputed→active | 版付きの明示解決と理由。単なる経過時間では解決しない |
| candidate/active/disputed→superseded | 訂正の新revisionを同時登録し、旧版と新版をsupersedesで結ぶ |
| candidate/active/disputed→retracted | 主体が明示撤回。理由sourceが必要 |
| candidate/active/disputed→invalidated | 入力版失効、source撤回、認可・復元の検査失敗 |

終端状態を元のrevisionのままactiveへ戻さない。再採用は新revisionと新検査を必要とする。forgetは状態変更ではなく内容消去と墓標であり、forgotten payloadを履歴に残さない。再送で終端状態や墓標を巻き戻さない。

訂正の対象が曖昧なら、候補を示し当該対象を必要とするSliceをblockedにする。他Scopeを候補件数にも含めない。特定できた訂正は新しい意味抽出が終わる前に旧版を無効化する。

## C5 条件と推論の確定規則

条件ASTはcompare/all/any/notとunsupported。深さ8、ノード64まで。all/anyの空配列と未記述条件はunknown。explicitly_unconditionalは採用根拠を伴う場合だけsatisfiedにできるが、認可・期間・版検査を省略しない。

NOT unknown=unknown。ANDは一つでもviolatedならviolated、それ以外でunknownがあればunknown。ORは一つでもsatisfiedならsatisfied、それ以外でunknownがあればunknown。同一観測キー・重なる時間・同じ優先度の矛盾はunknown。古い観測はunknown、別unitは変換を推測せずunknown。初版は明示された同一unitだけを比較する。

validTime判定が精度不足で確定できない場合はunknown。現在状態のfreshnessは取得時刻ではなく観測時刻とpolicyで評価する。asOfが観測より前ならその観測を現在状態に使用しない。

因果探索は有向の因果edgeだけを伝播する。相関・part_of・serves_goal・related_toは混ぜない。符号合成は同一比較軸のincreases/decreasesだけを対象にし、異なるmetricや比較条件なら方向unknown。enables/causes等を数値効果へ変換しない。逆探索は原因候補の表示だけでedgeの向きを反転しない。feedbackは訪問済み判定で止める。

上限の既定は因果深さ3、関連深さ4、対象30、関係60、経路10、取得候補500、展開500、提示8KiB。ホスト予算との小さい方を採る。全素材の無制限取得後にsliceする実装は禁止。予算不足の検知はcountの全走査ではなく、必要なら上限+1のsentinel行で判定し、sentinelも総取得予算に計上する。打切りならpartialと理由を返し、no_pathからno_effectを導かない。

### 予測照合の計算規則

定量照合するPredictionにはcomparisonId、metric、unit、baselineRefとbaseline値、expectedObservationWindow、期待方向increases/decreases、measurementToleranceを必須にする。toleranceは0以上の有限値で、測定計画の作成時に固定する。予測を見て後から変えない。Outcomeは同じbaselineRefと実測windowを持ち、想定windowと一致しなければincomparableとする。baselineの測定期間自体と実測windowを同じ期間にするという意味ではない。

比較条件がすべて一致した後、delta=outcome値-baseline値を計算する。delta>toleranceなら増加、delta<-toleranceなら減少、それ以外はincomparable/INSUFFICIENT_RESOLUTION。期待方向と一致すればsupported、逆ならrefuted。複数観測で両方が得られた場合だけmixedとし、incomparableな観測の件数と理由も別に残す。例えばbaseline=100ms、tolerance=2ms、期待decreasesなら90msはsupported、110msはrefuted、99msはincomparable。定量情報のないcauses/enables関係はこの計算へ通さず、測定不足のGapを返す。

supportedはこの予測と観測の整合であり、交絡が除かれた因果証明ではない。originや介入・比較条件の制約を保持する。

## C6 Sliceと照合

Sliceはprincipal/scope/asOf、GoalRef、各assertion/sourceの版、scope epoch、policyRevision、forgetEpoch、restoreEpoch、解釈版、予算、完全性、digestを持つ。digestはcanonical bytesからホストが算出するか注入した同期純粋hash関数で算出する。DB/時計/ネットワークをhash関数へ隠してはならない。SHA-256実装を自作せず、ホストの既存関数か検証済み小規模実装を利用する選定票をP1-01に含める。

最小説明単位は「結論・条件・反証/仮説表示・出典参照」。8KiBを超えたら単位ごと落とす。条件だけを削らない。JSONのUTF-8 bytesで数え、日本語文字数をbyte数にしない。必須の一単位も入らない場合はoverflow。

| status | 意味 | 許される利用 |
|---|---|---|
| ready | 必須検査完了、要求範囲で打切りなし | 明示した用途で参照可能 |
| partial | 必須検査完了、任意情報の不足・探索打切り | 限界表示付きで参照可能 |
| blocked | 認可・必須版・訂正・復元等の検査未完了 | 当該Sliceを回答/行動に使わない |
| overflow | 必須説明を予算内に表現不能 | 予算/要求を変えて別要求とする |
| disabled | ホスト設定でWorld利用OFF | forget処理は継続する |

優先順はdisabled（通常照会のみ）、blocked、overflow、partial、ready。認可失敗の応答に名称・件数・存在有無を含めない。利用時の再検証はID一致だけでなく依存版とscope epochも検査する。新しい反証が増えた場合もepochで旧Sliceを失効させる。

## C7 SQL所有とschema

物理表の予定と所有を以下に固定する。すべてprincipal/scopeKeyで限定し、対象間の参照も同じ所有境界を検査する。物理列・索引DDLをP2-01でこの表からschema-v1.mdへ落とし、P2-02以降で使用する。

| owner | 初版の表 | 一意キー・主な索引 |
|---|---|---|
| identity | world_entity、world_alias、world_identity_event | `(principal,scope_key,id)`、alias正規形→候補、eventId一意 |
| assertions | world_assertion、world_transition、world_evidence、world_assertion_input | `(principal,scope_key,id,revision)`、subject/predicate/status、source keyから逆引き |
| projection | world_current、world_edge、world_scope_epoch | 所有Scope＋assertion版、subject/predicate、edge両端、Scopeごとepoch1行 |
| scenarios | world_prediction、world_outcome | 所有Scope＋id/revision、comparisonId、metric/期限 |
| extraction | world_inbox、world_input_manifest、world_manifest_dependency、world_checkpoint | eventId一意、manifestId一意、source/state逆引き、feedキー |
| lifecycle | world_tombstone、world_forget_operation、world_forget_target、world_scope_gate、world_operation | 対象kind/id、forgetId、Scope、operationKeyの複合一意 |
| infrastructure | world_schema_info | schema版と順序付きmigration hash一覧。業務データを置かない |

conditionsは条件ASTを主張payloadとして保持し、独立world_condition表を初版で作らない。reasoningは永続tableを持たない。scenario overlayは保存しない。world_operationは再送受付のメタデータだけを保持し、業務payload本文を複製しない。infrastructureのworld_schema_infoはP2で加えるschema管理用メタデータであり業務SQLではない。

domain間の外部キーとSQL JOINは初版では禁止。公開操作でboundedなID/版集合を渡して組み立てる。同じdomain内のFKはScopeを含む複合キーにする。SQL値はすべてbindし、predicateやrelation種別をSQL断片として連結しない。

migrationは`{ id, sql, sha256 }`の不変descriptorと、現行host互換のreadonly SQL文字列配列の両方を公開する。配列を入れ替えず末尾追加のみ。hashは生成時に確定し、実行時はホストの既存hash機能で照合する。既適用のhash不一致・未来schemaは書込みとWorld利用を拒否する。

## C8 同期更新と再送

ホスト向けの更新は`applyWorldOperation(db, input)`を入口とし、operation unionはentity操作、主張採用/訂正/撤回、候補settle、予測/結果登録、失効/forgetに分ける。初版に不要な汎用SQL実行口を作らない。通常照会は`readWorldSnapshot(db, request)`、採用前検査は`validateWorldUsage(db, receipt, current)`を用意する。すべて同期。

各書込みの共通手順を固定する。`applyWorldOperation`の後、ホストが必要なMemory依存登録などを行ってからcommitする。後続処理の成否をWorld単独では確定できないので、appliedは「現在のtransaction内で適用済み」でありdurable commitの宣言ではない。

1. `db.inTransaction === true`、契約版、サイズ、access、Scopeを確認。false/欠落は`WorldTransactionRequiredError`を投げる。
2. 現在のgate・墓標・入力source版・入力状態を、同じwriter snapshotからホストが渡した値とWorld台帳で検査する。検証済みboolだけを信用するAPIにはしない。
3. `(principal,scope,operationKey)`を確認する。canonical payloadが同じで既適用なら重複を増やさずno_op、異なるpayloadならOPERATION_KEY_CONFLICT。既適用の同一操作は、その操作自身が進めたexpectedRevisionの不一致では拒否しない。再送でも現在の認可・忘却・source状態を再検査してから応答し、no_opには不透明なreceipt参照だけを返す。
4. すべての予見可能な拒否をDML前に判定する。新規操作の期待版不一致はREVISION_CONFLICT、墓標対象はTOMBSTONED。同一操作の再送判定より先にexpectedRevisionを検査しない。
5. 必要なdomainの公開同期操作を同じdbで順に呼び、台帳→投影→epoch→checkpoint→operation receiptを整合する。各resultを検査し、途中不成立は例外へ変換する。
6. 成功はapplied/no_op。DB障害・途中不整合は例外を伝播し、ホストがrollbackする。内部でcatchして成功を返さない。Worldはcommitしない。

通常の入力拒否は`{status: "rejected", reasonCode}`、利用拒否は`{status: "blocked", reasonCode}`。内容を返さない。DML後の失敗をresultだけで返すとホストが部分commitできるため禁止する。ホスト側もWorld/Memoryいずれかがrejected/blockedならその結合操作を例外として戻す。

canonical payloadはkey順を固定し、UTF-8、JSON有限値、集合のsort、意味を持つ配列順の維持を定義する。operationKeyとclockは同値判定から除き、expectedRevision・source版・内容・contractVersionは含む。hashだけでなく保持したcanonical digestの版を比較する。forget時は本文と旧結果payloadを消し、墓標対象を参照するreceiptから内容を返さない。

## C9 忘却と復元

訂正は新しい解釈を待たず旧版の利用を止める。forgetは引用された根拠に加えて、推論へ見せた全source/state依存を辿る。支持根拠と入力依存を同じ集合として扱わない。rootEvidenceの統合は忘却辺を減らす理由にしない。

一度の閉包が上限を超える場合はScope gateを閉じ、forget_operationに継続状態、world_forget_targetに未処理のkind/id/revisionを保存する。削除対象の逆依存を読む→次対象を一意キー付きで保存→本文/辺を削除→処理済みにする、までを同一transactionにする。先に辺を消して未走査の派生物を見失ってはならない。この対象一覧はforgetの意味処理の進捗であり、hostのjob/lease/実行queueを複製しない。小さなchunkを別のホストtransactionで処理し、残件0・投影再構築・外部削除確認まで対象Scopeを公開しない。巨大なtransactionで全走査しない。モデル・World ON/OFFに依存させない。

消す対象は主張内容、引用、派生説明、条件に含む本文、manifest内素材、予測/結果の派生本文、候補、検索投影、利用cache。残すのは不透明なScope付き対象ID・forget操作ID・最小状態・版など再出現防止に必要なメタデータのみ。保持可能な理由codeは列挙値にし、自由文で本文を残さない。

World単独でjournalの耐久保存を実装しない。ホストは同じforgetIdで最新journalの耐久化→DBへの適用→Memory external deletion確認を進め、全段階完了までpendingを保持する。古いDBの復元時はgateを閉じ、restoreEpoch更新、cursor破棄、依存再登録、最新墓標照合、投影再構築の順で進める。照合不能ならclosedのまま。切り戻しで墓標を戻さない。
