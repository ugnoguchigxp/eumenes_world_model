/**
 * Measures bounded retrieval and writer latency on deterministic synthetic
 * ledgers (A33). Usage: bun scripts/bench-world.ts [--sizes 1000,10000,100000]
 * [--seed 42] [--out path.json]. Fetched rows are rows the driver returned
 * (sentinel rows included), NOT scanned rows; scanned-row counts are not
 * measured.
 */
import { writeFileSync } from "node:fs";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { openTestStore } from "../test/support/sqlite-store.ts";
import {
	realPlans,
	seedWorld,
	sliceOnce,
	writeOnce,
} from "../fixtures/performance/harness.ts";
import {
	PERF_SCOPE,
	type GenOptions,
} from "../fixtures/performance/generator.ts";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1]! : fallback;
};
const sizes = flag("--sizes", "1000,10000,100000").split(",").map(Number);
const seed = Number(flag("--seed", "42"));
const out = flag("--out", "");
const WARMUP = 10;
const RUNS = 100;

const percentile = (sorted: number[], p: number) =>
	sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
const stats = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	return {
		p50: percentile(sorted, 0.5),
		p95: percentile(sorted, 0.95),
		max: sorted.at(-1)!,
	};
};
const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);

const results: unknown[] = [];
for (const claims of sizes) {
	const options: GenOptions = { seed, claims };
	const store = openTestStore();
	try {
		const seeded = seedWorld(store, options);
		const rssAfterSeed = process.memoryUsage().rss;
		// Representative focus set: the hub, a chain head, plain subjects.
		const focusSets = [
			["hub"],
			["s-0"],
			["s-3", "s-7"],
			[`s-${Math.floor(claims / 20)}`],
		];
		const slice = {
			times: [] as number[],
			fetched: 0,
			expanded: 0,
			bytes: 0,
			partial: 0,
			statuses: {} as Record<string, number>,
		};
		for (let i = 0; i < WARMUP + RUNS; i++) {
			const focus = focusSets[i % focusSets.length]!;
			const t0 = performance.now();
			const run = sliceOnce(store, focus);
			const elapsed = performance.now() - t0;
			if (i < WARMUP) continue;
			slice.times.push(elapsed);
			slice.fetched = Math.max(slice.fetched, run.fetchedRows);
			slice.expanded = Math.max(slice.expanded, run.expandedRows);
			slice.bytes = Math.max(slice.bytes, run.outputBytes);
			slice.partial += run.partial ? 1 : 0;
			slice.statuses[run.status] = (slice.statuses[run.status] ?? 0) + 1;
		}
		const writes: number[] = [];
		for (let i = 0; i < WARMUP + RUNS; i++) {
			const t0 = performance.now();
			writeOnce(store, options);
			const elapsed = performance.now() - t0;
			if (i >= WARMUP) writes.push(elapsed);
		}
		const plans = store.read((db) => realPlans(db));
		const unindexed = Object.entries(plans).filter(([, v]) => !v.indexed);
		results.push({
			claims,
			seed,
			generateAndInsertMs: Math.round(seeded.generateAndInsertMs),
			fullRebuildMs: Math.round(seeded.rebuildMs),
			slice: {
				runs: RUNS,
				warmup: WARMUP,
				ms: stats(slice.times),
				maxFetchedRows: slice.fetched,
				maxExpandedRows: slice.expanded,
				maxOutputBytes: slice.bytes,
				partialRuns: slice.partial,
				statuses: slice.statuses,
				rawMs: slice.times,
			},
			writer: { runs: RUNS, warmup: WARMUP, ms: stats(writes), rawMs: writes },
			rssMb: {
				afterSeed: mb(rssAfterSeed),
				end: mb(process.memoryUsage().rss),
			},
			plans,
			unindexedQueries: unindexed.map(([name]) => name),
		});
		console.log(
			`${claims} claims: slice p50=${stats(slice.times).p50.toFixed(2)}ms p95=${stats(slice.times).p95.toFixed(2)}ms fetched<=${slice.fetched} bytes<=${slice.bytes}; writer p95=${stats(writes).p95.toFixed(2)}ms; rebuild=${Math.round(seeded.rebuildMs)}ms; unindexed=${unindexed.length}`,
		);
	} finally {
		store.close();
	}
}
const environment = {
	date: new Date().toISOString(),
	platform: `${platform()} ${release()} ${arch()}`,
	cpu: cpus()[0]?.model ?? "unknown",
	cores: cpus().length,
	memoryGb: Math.round(totalmem() / 1024 ** 3),
	bun: Bun.version,
	node: process.versions.node,
	sqlite: "bun:sqlite",
	scope: PERF_SCOPE,
};
const report = {
	environment,
	thresholds: { slice10kP95Ms: 50, writerP95Ms: 20 },
	results,
};
if (out) writeFileSync(out, `${JSON.stringify(report, undefined, "\t")}\n`);
else console.log(JSON.stringify(environment));
