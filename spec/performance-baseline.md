# Performance baseline (P2-09)

Measured on synthetic, deterministic ledgers (seed 42); no real data. **Fixture/SQLite measurement only**: it says nothing about the Eumenes Writer queue, real Memory registration or real models (those stay unaccepted until P3+). Raw data (every measured run) is in [performance-baseline.json](performance-baseline.json); regenerate with `bun run bench:world -- --out spec/performance-baseline.json`.

## Environment

| item | value |
|---|---|
| machine | Apple M4, 10 cores, 32 GB RAM |
| OS | darwin 25.6.0 arm64 |
| runtime | bun 1.4.2 (node 26.3.0 compat), `bun:sqlite`, file DB with WAL, single writer + readonly reader |
| measured at | 2026-10-09T03:17:09.680Z |
| generator | `fixtures/performance/generator.ts` (mulberry32; hub fan-out 400; chains with a cycle every 50 subjects; 50 cited sources) |
| method | warmup 10 + 100 measured runs per metric; p95 = ceil(0.95 n)-th smallest; wall-clock of the whole call |

Generation (`generateAndInsertMs`), the full paged rebuild (`fullRebuildMs`) and migration are timed separately and are **not** part of the writer or Slice budgets.

## Results

Slice = `readWorldSnapshot` (focus set of 1-2 subjects, depth 2, default budgets 500/500) on the readonly reader + `buildWorldSlice`. Writer = one `applyWorldOperation(assertion.register)` in its own write transaction **including the commit** (host WAL defaults, no fsync tuning). "p95 run 2" is a second full run of the same benchmark, shown to expose run-to-run noise. Fetched/expanded rows are rows **returned by the driver** (limit+1 sentinel rows included), not scanned rows; scanned-row counts are **not measured**.

| claims | Slice p50 ms | Slice p95 ms | Slice p95 run 2 | max fetched rows | max expanded rows | max output bytes (units JSON) | partial runs | writer p50 ms | writer p95 ms | writer p95 run 2 | generate+insert ms | full rebuild ms | RSS MB after seed / end |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1,000 | 5.78 | 6.62 | 7.21 | 500 | 500 | 8010 | 100/100 | 0.22 | 1.10 | 1.05 | 35 | 32 | 67 / 101 |
| 10,000 | 5.95 | 10.45 | 7.99 | 500 | 500 | 8182 | 100/100 | 0.18 | 0.36 | 0.29 | 341 | 250 | 114 / 126 |
| 100,000 | 7.32 | 8.95 | 8.36 | 500 | 500 | 8010 | 100/100 | 0.18 | 0.68 | 0.61 | 4,449 | 2,930 | 150 / 169 |

Provisional acceptance values (C5/P2-09): representative 10k-claim Slice p95 <= 50 ms and ordinary single-operation writer p95 <= 20 ms. Measured: 10k Slice p95 10.45 ms, writer p95 0.36 ms on this machine. These thresholds were not edited. They are met on this machine/fixture only; other hardware must be re-measured before any production claim.

Notes on interpretation:
- Every Slice run is `partial` (designed: partial, never "no effect"). Verified reasons at 10k claims, depth 2: focus `hub`, `s-0` and `s-3,s-7` reach the hub's 400 neighbours and stop on `CANDIDATE_BUDGET` + `EXPANSION_BUDGET` (500 rows each; this is the worst case and dominates p95); focus `s-500` is a light read (55 rows fetched, 27 expanded) that stops on `DEPTH_LIMIT`. One quarter of the measured runs are therefore the light case.
- Output stays <= 8192 bytes; fetched and expanded rows never exceed 500 even at 100k claims. The ledger is never loaded into JS: a full rebuild reads head assertions in pages of 500 (RSS above includes the test-store, generator and bun itself).
- The 100k RSS figure is a process total, not a World-only allocation.

## EXPLAIN QUERY PLAN (10k+ claims, first line per query)

An entry is "indexed" only if the plan names the selective column in the index search (a plan that narrows by `(principal, scope_key)` alone would still scan the whole Scope). Full plans are in the JSON.

| query | selective index used | first plan line |
|---|---|---|
| current by subject (readCurrent) | yes | `SEARCH world_current USING INDEX world_current_subject (principal=? AND scope_key=? AND subject_id=?)` |
| edges from (readEdgesFrom) | yes | `SEARCH world_edge USING INDEX world_edge_from (principal=? AND scope_key=? AND from_id=?)` |
| edges to (readEdgesTo) | yes | `SEARCH world_edge USING INDEX world_edge_to (principal=? AND scope_key=? AND to_id=?)` |
| assertion head (getHead) | yes | `SEARCH world_assertion_head USING INDEX sqlite_autoindex_world_assertion_head_1 (principal=? AND scope_key=? AND id=?)` |
| assertion by version (getAssertion) | yes | `SEARCH world_assertion USING INDEX sqlite_autoindex_world_assertion_1 (principal=? AND scope_key=? AND id=? AND revision=?)` |
| reverse lookup by source (inputs) | yes | `SEARCH world_assertion_input USING INDEX world_assertion_input_source (principal=? AND scope_key=? AND source_key=?)` |
| reverse lookup by source (evidence) | yes | `SEARCH world_evidence USING INDEX world_evidence_source (principal=? AND scope_key=? AND source_key=?)` |
| manifest dependencies by source | yes | `SEARCH world_manifest_dependency USING INDEX world_manifest_dependency_source (principal=? AND scope_key=? AND source_key=?)` |
| scope epoch | yes | `SEARCH world_scope_epoch USING INDEX sqlite_autoindex_world_scope_epoch_1 (principal=? AND scope_key=?)` |
| scope assertion page (listScopeAssertions) | yes | `SEARCH a USING COVERING INDEX sqlite_autoindex_world_assertion_1 (principal=? AND scope_key=? AND id>?)` |

Finding fixed during this ticket: the planner chose the primary-key index (scope prefix only) for the `source_key IN (...)` lookups on `world_assertion_input` and `world_manifest_dependency`, i.e. a Scope-wide scan on every reverse-dependency lookup. Both repository queries now use `INDEXED BY` their source-key index.

## Projection maintenance (what makes the numbers possible)

The Scope projection is maintained **incrementally**: a write updates only the changed assertion's `world_current`/`world_edge` rows, patches the refutation list of its contradiction targets, and advances the epoch once. The old whole-ledger rebuild (and its 500-assertion cap, which made `assertion.register` fail with `LIMIT_EXCEEDED` beyond 500) is now used only by forget completion, restore and the explicit `rebuild` operation, and it pages the ledger (page 500) up to a ceiling of 200,000 head assertions per Scope (`maxLedgerAssertions`; beyond it the rebuild throws `LEDGER_TOO_LARGE`; ordinary writes are not counted against the ceiling).

Material digest scheme `set-sum-v1`: digest = (sum over head assertions of H(a)) mod 2^256, printed as `sha256:<64 hex>`. H(a) = injected-hasher SHA-256 of the canonical summary {id, revision, lifecycle, sorted contradicts, sorted supersedes, sorted cited sources (identity key, revision, digest)}. It is order independent and updated by -H(old)+H(new). It is a multiset sum, not a preimage hash. Freshness is evaluated at the writing clock and is not part of the digest, so the epoch does not move with time.

Behaviour changes caused by this (tests added in `test/scenario/incremental.test.ts`, `budgets.test.ts`):
- `assertion.register` / `candidate.settle` now reject a contradiction target that does not exist (exact id+revision, in the ledger or in the same batch): `CONTRADICTION_TARGET_NOT_FOUND`. Without this the incremental update could not equal a full rebuild.
- Source currency inside the ledger projection is now local: each assertion's cited sources count as available at the versions it cited (the ledger knows nothing newer). Staleness against the outside world still comes only from host source snapshots on read/validate and from explicit invalidation. Previously a source cited at two versions made the older assertion `SOURCE_NOT_CURRENT` inside the projection.
- Material digests of existing databases would differ (no such databases exist yet).

## Status

Retrieval caps, index use and incremental maintenance: **verified by machine-independent tests** (`test/scenario/budgets.test.ts`, 1,300-2,000 claims). Latency targets: **met on the measured machine for 1k/10k/100k**, fixture only. Not measured: scanned rows, multi-writer contention, host Writer queue, fsync-bound commit on other storage, real-model latency.
