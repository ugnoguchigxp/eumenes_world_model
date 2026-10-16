import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Cell } from "./results.ts";
import type { HoldoutQuestion } from "./fixtures.ts";
const { values } = parseArgs({
	options: { run: { type: "string" } },
	strict: true,
});
if (!values.run) throw new Error("Usage: --run <directory>");
const dir = resolve(values.run);
const report = JSON.parse(
	readFileSync(resolve(dir, "report.json"), "utf8"),
) as { status: string; cells: Cell[]; summary: unknown };
const protocol = JSON.parse(
	readFileSync(resolve(dir, "protocol.json"), "utf8"),
) as { questions: HoldoutQuestion[] };
const lines = [
	"# 未見資料での回答方式比較",
	"",
	`実行状態: ${report.status}。legacyは計算を別配列で渡す従来方式、linkedはv4の根拠記録と対応付け。両者とも原文・構造・計算を持つ。2反復は独立資料ではない。判定の採点と説明の点検は分ける。`,
	"",
	"```json",
	JSON.stringify(report.summary, null, 2),
	"```",
	"",
];
for (const q of protocol.questions) {
	lines.push(
		`## ${q.id} ${q.category}`,
		"",
		`期待判定: ${q.expected.decision}。根拠: ${q.expected.governingSources.join(", ")}。${q.expected.reason}`,
		"",
	);
	for (const c of report.cells.filter((c) => c.questionId === q.id)) {
		lines.push(
			`- ${c.arm} / ${c.repeat + 1}: ${c.answer?.decision ?? c.error} / 根拠 ${c.answer?.governingSources.join(", ") ?? "-"} / 判定一致 ${c.decisionCorrect}`,
			"",
			c.answer?.explanation ?? "回答失敗",
			"",
		);
		if (c.grounding)
			lines.push(
				"```json",
				JSON.stringify(
					{ grounding: c.grounding, assessmentsCorrect: c.assessmentsCorrect },
					null,
					2,
				),
				"```",
				"",
			);
	}
}
writeFileSync(resolve(dir, "comparison.md"), lines.join("\n"));
console.log(resolve(dir, "comparison.md"));
