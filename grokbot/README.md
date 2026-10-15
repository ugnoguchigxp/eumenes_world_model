# Grok Bot の情報収集キット

Grok Bot が、探す対象を選び、本文を読み、根拠を残して JSONL を持ち帰るための運用指示と補助ツールです。意味の判断は Bot が担当し、Python は記録の整合性検証、配分集計、検索結果の保存を担当します。WorldModel 本体には接続しません。

## Grok に渡すもの

`collect-eumenes-knowledge/` フォルダ全体を渡してください。入口は [SKILL.md](collect-eumenes-knowledge/SKILL.md) です。Skill を直接読み込めない環境でも、このファイルを作業指示として読み、参照先を必要時に開けば使えます。自動インストールはしていません。

渡すときの依頼文：

> collect-eumenes-knowledge/SKILL.md に従って収集を進めてください。最初に quality-examples.md を読み、各例で保存すべき条件と、許されない一般化を短く説明してください。その後、利用可能な検索・本文取得・ファイル保存・再開手段を確認し、保存可能なら初回は最大20候補の収集を行ってください。対象は非商用の研究・個人利用で、配分は同梱設定を使います。取得できなかった候補も記録し、自己点検済みと独立評価済みを区別して成果物を返してください。継続実行の仕組みがない場合は、再開用の状態と次の作業を残してください。

## 内容

- [Skill](collect-eumenes-knowledge/SKILL.md)：判断・収集・再開・納品の手順。
- [運用設計](collect-eumenes-knowledge/references/framework.md)：継続収集、予算、評価との分離。
- [品質見本4例](collect-eumenes-knowledge/references/quality-examples.md)：今回の改善用データから選定。出典との内容照合と、未検証部分を明示。
- [データとコマンド](collect-eumenes-knowledge/references/data-contract.md)：保存形式、検証範囲、使い方。
- [配分](collect-eumenes-knowledge/config/distribution.json)：AI 36%、研究20%、医療16%、生活20%、製造8%。継続収集の初期値として変更可能。
- [確認ケース](collect-eumenes-knowledge/references/acceptance.md)：Bot の判断と補助ツールを確認する方法。
- [全体レビューと改修結果](review/report.md)：検証の抜け、集計、キャッシュ、評価手順の修正と残る確認事項。

## 実装済みの範囲

Python 3.10 以上、標準ライブラリのみで動きます。

```sh
python3 grokbot/collect-eumenes-knowledge/scripts/collector_tools.py --help
python3 -m unittest discover -s grokbot/collect-eumenes-knowledge/tests -v
```

検索・取得は Grok 側の既存ツールを使います。このキット自体はモデルの呼出し、常駐実行、スケジューラ、独立した意味評価、WorldModel への投入を実装していません。会話を越えた自律稼働には、Grok 側に保存領域と再起動の仕組みが必要です。これらがない環境では、有限の収集と成果物の返却・再投入で運用します。

本文の存在や引用位置を検証できても、主張の真偽や適用範囲が正しいことまで自動判定できるわけではありません。検証ツールの成功だけを本格運用の承認に使わないでください。

新規データは通常モードで確認します。従来の納品ファイルには候補IDがないため、過去データの確認時だけ `--legacy` を使います。配分集計はファイル上の申告件数であり、本文検証の合格件数ではありません。原抽出の監査結果 `ok` と、採用候補の結果 `first_output_ok` も分けて報告します。
