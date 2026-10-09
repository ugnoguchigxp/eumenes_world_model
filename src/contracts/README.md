# 共通のWorld契約

複数ドメインが共有するID・値・版・limits・結果型・canonical化・DependentRefを置く。固有のpayloadは各domainのcontractsが所有し、SQLは置かない。

- Memoryの公開型（SourceRef、AccessContext等）は`source.ts`だけが`import type`で参照する。固定版の配布物は`vendor/eumenes-memory`（ローカル生成、公式リリースではない）。手書きの複製は作らない。
- ここからdomainや永続化への依存は禁止。共通契約を変更したら全体verifyを行う。
