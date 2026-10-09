# conditions / repository

このドメインのworld_表とSQL・migrationを所有する。接続はホストから借り、同期で処理する。open/close・transaction制御・PRAGMA・独自Writerは禁止。複数ドメインの更新は同じ接続と各公開sqlite入口で組み合わせる。

このドメインはworld_表を所有しない。repositoryは空で、SQLを追加する場合は契約C7を先に更新する。
