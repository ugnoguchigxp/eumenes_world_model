# assertions / test

このドメインの*.test.tsを置く。純粋試験と、test/supportの試験hostを使った実SQLite試験（一時file/WAL・memory）を所有する。`bun run verify -- --domain assertions`で実行する。0件の領域は未実装として失敗する。
