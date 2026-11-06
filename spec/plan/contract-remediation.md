# 契約修正の固定評価条件（2026-11-06）

## 範囲と順序

今回の明示依頼により、評価条件の固定→入力検査→観測訂正の反映→複数引用→
部分/結合/通し検証を行う。隣接repo、CI、commit/push、本流取込みは対象外。
既存の改善5件/悪化0、抽出95%、gold、過去結果を変更しない。
API累積上限9.93184335 USD、残額0.06815665 USD。今回のAPI呼出しは0。

## 編集前に固定する合否

新しいprotocolは`contract-remediation/1`。ここでの合格はローカルの契約・結合
試験であり、実LLMの判断改善、P5/Local正式受入、80点の再評価を意味しない。

| 試験群 | 必須条件 | 不合格になる例 |
|---|---|---|
| 公開入力 | 全操作の必須構造とsource stateを利用前に検査。認可失敗は内容処理より優先。無効入力で予期しない例外/DMLを発生させない | prediction/outcomeのinput欠落、null state、誤型、未知field |
| 観測訂正 | 同一測定の最新版と派生主張を一つのhost transactionで反映。旧receiptを失効させる。比較不能/反証を旧支持で上書きしない | 支持rev1→比較不能/反証rev2でも旧判断を採用、途中失敗で片側だけ保存 |
| 複数引用 | LLMが選んだ全引用を個別に検証し、一主張のEvidenceへ保持。全入力依存も維持。旧単一引用は互換 | 一部引用だけ採用、quoteとquotesの併記、空/過多/重複/不正引用、片方の撤回後も利用 |
| 回帰 | 元goldの2出典要求を変えず、wire→公開検証→保存→Slice/receipt→訂正・forgetを実SQLiteで確認 | 入力manifestを支持根拠の代用にする、既存正解を減らす |

全件成功・欠測0を必須とし、平均点で失効/認可/引用の失敗を相殺しない。
意味的な判断案はfixtureで明示し、codeは版・契約・権限・数学だけを検査する。
語句/名前/個別問題に対応した製品分岐を追加しない。

## 公開契約の変更

- extraction candidateに`quotes`（1〜12個）を追加する。旧`quote`との併記は不可。
  各要素は既存quoteと同じutteranceId/startByte/endByte。支持する意味範囲の選択は
  LLMに残し、codeは引用の厳密な検証を行う。
- 第一Evidenceは既存host割当IDを維持。追加Evidence IDはhost割当IDと引用順の
  SHA-256から同期・決定的に導出し、モデルへID決定や採用権限を与えない。
  同じ出典系列は独立根拠として水増ししない。DBschemaとAssertion型は変更不要。
- 新native抽出版は9として識別し、旧版の単一引用schema/decoderを互換経路として
  残す。旧結果を新版の測定結果へ読み替えない。比較する各profileの実際の容量を
  preflightへ渡し、旧baselineの容量不足も隠さない。
- 観測訂正は既存Outcome/Assertion/invalidate/receiptを組み合わせる。意味的な
  修正候補はhost/LLMから明示入力し、codeが観測値から行動を生成しない。

## 次の実モデル評価を固定する条件（今回は実施しない）

一つの実仕事で、同じGoal・原典・operator情報・モデル・入力予算を持つ
原典検索/plain/Worldを比較する。支持、反証、比較不能、観測訂正、Goal撤回を
含む事前固定episodeと、未見の反対条件を使う。次の判断の正確性、過保留、
誤断定、旧値使用、条件外への誤一般化、bytes/token/時間を別々に報告する。
実行action/parameters/検証器/sourceの対応と採用権限はhostが保証する。
固定fixture案の保存成功やoracleをモデルの改善に数えない。

## 残作業

- [x] 評価条件・契約差分を編集前に固定
- [x] 入力検査と部分試験
- [x] 観測訂正の反映と結合試験
- [x] 複数引用のwire/公開候補/根拠/失効の結合試験
- [x] verify/build、差分・費用・過去証拠点検、progress記録

## ローカル結果

- 部分/結合: 29pass/0fail/190 assertions。支持→反証、支持→比較不能、
  生Outcomeの先行到着後の反映、根拠欠落、追加引用不正、同一原典系列、
  各出典の変更/撤回/忘却、同一再送、途中失敗を確認した。
- 全体verify: 1131pass/0fail/19887 assertions/97 files。build成功。
- 元のI-lifecycle-09の2出典goldはそのままで、二引用の一主張が一致する。
  同例はread前にs0を忘却するため、保存後の照会は空になることも維持した。
- 現行複数引用の容量監査は衝突0。旧単一引用は同じ正解に衝突1のまま。
  旧baselineを含む全比較のpreflightを新版の容量で通したことにはしない。
- 採用根拠を欠くplanも既存の遷移要求parserで拒否する。source検査とともに
  認可されたhostからの不正構造でもDML前に止まる。
- 観測の最新版は同一identityを既存主キー順で1件取得するdomain公開queryを
  使用する。これはこのproject内の接続例であり、配布hostの新しい認可済み
  query APIや実runtime接続を追加したものではない。
- API呼出し0、累積上限9.93184335 USD不変。CI/commit/push/本流取込みなし。

証拠は`artifacts/contract-remediation/2026-11-06/`。新旧監査、一巡の実行記録、
部分/結合/全体検証とbuild、最終差分/過去証拠/費用点検を分離して保存した。
新版9の実モデル品質は未測定、旧API総合未受入は維持する。
