/** Checks a scorer's known false-positive cases against frozen answer fixtures. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { asRecord } from "../../src/index.ts";

const { values } = parseArgs({
	options: { audit: { type: "string" } },
	strict: true,
});
if (!values.audit) throw new Error("--audit <audit report.json> is required");
const fixture = asRecord(
	JSON.parse(
		await readFile(resolve(import.meta.dir, "grader-regressions.json"), "utf8"),
	),
);
const report = asRecord(
	JSON.parse(await readFile(resolve(values.audit), "utf8")),
);
if (
	!fixture ||
	!Array.isArray(fixture["checks"]) ||
	!report ||
	report["status"] !== "completed" ||
	report["parentReportDigest"] !== fixture["parentReportDigest"] ||
	!Array.isArray(report["judgements"])
)
	throw new Error("grader_regression_input_mismatch");
const rows = report["judgements"].map(asRecord);
const checks = fixture["checks"].map((value) => {
	const spec = asRecord(value);
	const expected = asRecord(spec?.["expected"]);
	if (!spec || typeof spec["arm"] !== "string" || !expected)
		throw new Error("invalid_regression_fixture");
	const row = rows.find(
		(item) =>
			item?.["questionId"] === spec["questionId"] &&
			item?.["repeat"] === spec["repeat"],
	);
	const grade = asRecord(asRecord(row?.["grades"])?.[spec["arm"]]);
	return {
		...spec,
		actual: grade,
		passed:
			grade !== undefined &&
			Object.entries(expected).every(([key, score]) => grade[key] === score),
	};
});
console.log(
	JSON.stringify(
		{
			kind: "frozen-answer-grader-regression",
			passed: checks.every((check) => check.passed),
			checks,
		},
		null,
		2,
	),
);
if (checks.length === 0 || checks.some((check) => !check.passed))
	process.exitCode = 1;
