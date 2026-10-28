# 意味品質の評価

実モデルを使う抽出・回答・比較評価はここに分離する。通常verifyでネットワークやモデルを起動しない。評価データ、固定版、予算、閾値はP4以降に定める。現在は未実装（実モデルは未受入）。

登録済みLocal Providerで実資料から候補保存までを小規模に確認する場合は、
`bun --env-file=../eumenes/.env eval/extraction/local-smoke.ts --host ../eumenes`を使う。
SQLiteの設定は読取りのみで参照し、認証は既存のhostクライアントが使う。
[実測・前提・限界](../spec/evaluation-baseline.md#登録済みlocal-providerでの小規模接続受入2026年10月28日)を参照。
通常のverifyはモデルを呼ばない。
