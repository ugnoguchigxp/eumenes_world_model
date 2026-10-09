# lifecycle / repository

このドメインのworld_表とSQL・migrationを所有する。接続はホストから借り、同期で処理する。open/close・transaction制御・PRAGMA・独自Writerは禁止。複数ドメインの更新は同じ接続と各公開sqlite入口で組み合わせる。

migrationは`migrations/001.ts`の不変descriptorで、hashは`src/infrastructure/sqlite/migrations/manifest.ts`に固定される（変更は`scripts/gen-migrations.ts`の規則に従う）。
