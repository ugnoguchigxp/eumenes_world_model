/**
 * Entry of `bun run eval:cache-latency`. Replays pre-fixed observation series
 * through the pure World rules and scores them against expectations fixed in
 * advance. Fixture/pure-rule evidence only: no Tool, host ledger, network or
 * model is used.
 */
import { EXPECTED, PLAN, SERIES } from "./fixture.ts";
import { createReplayExecutor, runCacheLatency } from "./runner.ts";
import { scoreSeries } from "./scorer.ts";

const granted = { granted: true, grantRef: "fixture-permission-1" };
let failures = 0;
console.log("cache-latency evaluation (fixture / pure-rule evidence only)");
for (const series of SERIES) {
	const report = runCacheLatency({
		toolPermission: granted,
		executor: createReplayExecutor([series.record]),
	});
	const expectation = EXPECTED.find((e) => e.seriesId === series.seriesId)!;
	const score = scoreSeries(PLAN, series.record, expectation, report);
	if (!score.pass) failures++;
	console.log(
		[
			score.pass ? "PASS" : "FAIL",
			series.seriesId,
			`expected=${score.expected}`,
			`actual=${score.actual}`,
			`work=${report.work.status}`,
			`adoption=${report.adoption.judgment}`,
		].join(" "),
	);
}
const executor = createReplayExecutor(SERIES.map((s) => s.record));
const denied = runCacheLatency({
	toolPermission: { granted: false },
	executor,
});
const gapOk =
	executor.calls === 0 &&
	denied.measurement.gap?.reasonCode === "TOOL_PERMISSION_REQUIRED" &&
	denied.work.status === "not_started" &&
	denied.hypothesis.verdict === "not_measured";
if (!gapOk) failures++;
console.log(
	`${gapOk ? "PASS" : "FAIL"} no-permission executorCalls=${executor.calls} gap=${denied.measurement.gap?.reasonCode}`,
);
console.log(
	failures === 0
		? "OK: all expectations met (fixture only; real Tool, host ledger and real model are not covered)"
		: `FAILED: ${failures} expectation(s) not met`,
);
process.exit(failures === 0 ? 0 : 1);
