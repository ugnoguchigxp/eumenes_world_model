/**
 * Report structure (JSON) and its Markdown rendering.
 *
 * Every provider output, citation, scoring reason, token count, latency and
 * correction count is stored, so any usefulness claim traces back to it.
 */
import type { FrozenCheck } from "./tasks.ts";
import type { AcceptanceResult, Comparison } from "./scoring.ts";
import {
	axes,
	conditionIds,
	type Adjudication,
	type Axis,
	type ConditionId,
	type Mode,
	type RunSettings,
	type SafetyKind,
	type Split,
	type TaskScore,
} from "./types.ts";

export const REPORT_SCHEMA = "world-decision-eval/2";

export interface CellResult {
	readonly condition: ConditionId;
	readonly contextItemIds: readonly string[];
	readonly droppedItemIds: readonly string[];
	readonly output: {
		readonly text: string;
		readonly citations: readonly string[];
		readonly hold: boolean;
		readonly corrections: number;
	} | null;
	readonly error: string | null;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly latencyMs: number;
	readonly score: TaskScore;
}

export interface TaskResult {
	readonly taskId: string;
	readonly split: Split;
	readonly title: string;
	readonly scope: string;
	readonly question: string;
	readonly cells: Readonly<Record<ConditionId, CellResult>>;
	/** The acceptance gate (ticket): World versus Memory-only. */
	readonly worldVsMemoryOnly: Comparison;
	readonly relatedVsMemoryOnly: Comparison;
	/**
	 * Control, not a gate: World versus the same claim statements as plain
	 * facts. Separates the effect of World framing from merely supplying the
	 * claim text.
	 */
	readonly worldVsPlainFacts: Comparison;
}

export interface ConditionSummary {
	readonly tasks: number;
	readonly axisSums: Readonly<Record<Axis, number>>;
	/** Reference only. Never used by the acceptance rule. */
	readonly axisAverages: Readonly<Record<Axis, number>>;
	readonly totalScore: number;
	readonly safetyFailures: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly latencyMsTotal: number;
	readonly corrections: number;
	readonly errors: number;
	/** Unresolved needs-adjudication hits in this condition. */
	readonly needsAdjudication: number;
}

export interface AdjudicationEntry extends Adjudication {
	readonly taskId: string;
	readonly condition: ConditionId;
}

export interface SafetyEntry {
	readonly taskId: string;
	readonly condition: ConditionId;
	readonly kind: SafetyKind;
	readonly detail: string;
}

export interface Summary {
	readonly tasksRun: number;
	readonly evaluationTasksJudged: number;
	/** World improved over Memory-only; evaluation split only. */
	readonly improved: number;
	readonly improvedTaskIds: readonly string[];
	/** Improved on tuning tasks (reference only, not counted). */
	readonly improvedTuning: number;
	/** World got worse than Memory-only; all tasks run. */
	readonly worse: number;
	readonly worseTaskIds: readonly string[];
	readonly same: number;
	readonly incomplete: number;
	/** Safety failures of the World condition (all tasks run). */
	readonly worldSafetyFailures: readonly SafetyEntry[];
	readonly safetyFailuresByCondition: Readonly<Record<ConditionId, number>>;
	readonly conditions: Readonly<Record<ConditionId, ConditionSummary>>;
	/** Every unresolved needs-adjudication hit, all conditions. Blocks p5Accepted. */
	readonly adjudications: readonly AdjudicationEntry[];
	/** World versus plain facts (control). Evaluation split for improved. */
	readonly framing: {
		readonly improved: number;
		readonly improvedTaskIds: readonly string[];
		readonly worse: number;
		readonly worseTaskIds: readonly string[];
		readonly same: number;
		readonly incomplete: number;
	};
}

export type AcceptanceStatus = "accepted" | "not-accepted" | "tuning-only";

/**
 * Whether World framing itself helped beyond supplying the same facts.
 * Informational: it never changes `status` or `p5Accepted`.
 */
export type FramingStatus =
	| "demonstrated"
	| "not-demonstrated"
	| "incomplete"
	| "not-judged";

export interface FramingEvidence {
	readonly status: FramingStatus;
	readonly note: string;
}

export interface AcceptanceBlock {
	readonly status: AcceptanceStatus;
	/** Gate: safety 0, worse 0, improved >= 5 versus Memory-only. */
	readonly gate: "world-vs-memory-only";
	readonly result: AcceptanceResult | null;
	readonly framingEvidence: FramingEvidence;
	/** True only for an accepted evaluation run with a real model. */
	readonly p5Accepted: boolean;
	readonly note: string;
}

export interface Report {
	readonly schema: typeof REPORT_SCHEMA;
	readonly mode: Mode;
	readonly evidence: "fixture" | "real-model";
	readonly generatedAt: string;
	readonly provider: {
		readonly id: string;
		readonly kind: "fixture" | "real";
		readonly model: string;
	};
	readonly settings: RunSettings;
	/** How the World claims were produced (hand-authored parts stated). */
	readonly worldAuthoring: {
		readonly pipeline: string;
		readonly handAuthored: readonly string[];
		readonly sliceDigests: Readonly<Record<string, string>>;
		readonly note: string;
	};
	readonly frozen: Readonly<Record<string, FrozenCheck>>;
	readonly tasks: readonly TaskResult[];
	readonly summary: Summary;
	readonly acceptance: AcceptanceBlock;
}

export function serializeReport(report: Report): string {
	return `${JSON.stringify(report, null, "\t")}\n`;
}

function escapeCell(text: string): string {
	return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderMarkdown(report: Report): string {
	const out: string[] = [];
	const evidenceLabel =
		report.evidence === "fixture"
			? "fixture（模擬providerの結果。実モデルの受入ではない）"
			: "real-model";
	out.push("# World意味品質比較レポート（P5-04 / A50）", "");
	out.push(`- schema: ${report.schema}`);
	out.push(`- mode: ${report.mode}`);
	out.push(`- 証拠の種類: ${evidenceLabel}`);
	out.push(`- 生成時刻: ${report.generatedAt}`);
	out.push(
		`- provider: ${report.provider.id} (${report.provider.kind}) / model: ${report.provider.model}`,
	);
	out.push(
		`- 設定: seed=${report.settings.seed}, temperature=${report.settings.temperature}, 入力予算=${report.settings.inputBudgetTokens} tokens`,
	);
	for (const [split, check] of Object.entries(report.frozen)) {
		out.push(
			`- 凍結(${split}): rubric=${check.rubricDigest} task=${check.taskDigest} ${check.ok ? "一致" : "不一致"}`,
		);
	}
	out.push("");

	out.push("## World主張の作成方法", "");
	out.push(
		`- 経路: ${report.worldAuthoring.pipeline}`,
		`- 手書き部分: ${report.worldAuthoring.handAuthored.join(", ")}`,
		`- 注記: ${report.worldAuthoring.note}`,
		"",
	);
	out.push("## 判定", "");
	out.push(`- 判定の比較対象(ゲート): ${report.acceptance.gate}（Memoryのみ）`);
	out.push(`- 状態: ${report.acceptance.status}`);
	out.push(`- P5受入(実モデル評価の合格): ${report.acceptance.p5Accepted}`);
	out.push(`- 注記: ${report.acceptance.note}`);
	if (report.acceptance.result !== null) {
		const c = report.acceptance.result.criteria;
		out.push(
			`- 安全上の失敗: ${c.safetyFailures.value}件 (${c.safetyFailures.ok ? "OK" : "NG"})`,
		);
		out.push(`- 悪化: ${c.worse.value}件 (${c.worse.ok ? "OK" : "NG"})`);
		out.push(
			`- 改善(評価分割): ${c.improved.value}件 (${c.improved.ok ? "OK" : "NG"})`,
		);
		out.push(
			`- 欠落・比較不能: ${c.complete.value}件 (${c.complete.ok ? "OK" : "NG"})`,
		);
		out.push(
			`- 要判定(needs-adjudication): ${c.adjudicated.value}件 (${c.adjudicated.ok ? "OK" : "NG"})`,
		);
		for (const reason of report.acceptance.result.reasons) {
			out.push(`- 未達理由: ${reason}`);
		}
	}
	out.push(
		`- 参考(ゲートではない)・World枠組みの効果(対 plain-facts): ${report.acceptance.framingEvidence.status}`,
		`  - ${report.acceptance.framingEvidence.note}`,
	);
	out.push("");

	out.push("## 集計", "");
	const s = report.summary;
	out.push(
		`- 実行した仕事: ${s.tasksRun}（評価分割で判定: ${s.evaluationTasksJudged}）`,
		`- Worldが改善（評価分割）: ${s.improved} ${s.improvedTaskIds.join(", ")}`,
		`- Worldが悪化: ${s.worse} ${s.worseTaskIds.join(", ")}`,
		`- 差なし: ${s.same} / 比較不能: ${s.incomplete}`,
		`- World条件の安全上の失敗: ${s.worldSafetyFailures.length}件（平均点では相殺しない）`,
		`- World対plain-facts（対照）: 改善 ${s.framing.improved} ${s.framing.improvedTaskIds.join(", ")} / 悪化 ${s.framing.worse} ${s.framing.worseTaskIds.join(", ")} / 差なし ${s.framing.same} / 比較不能 ${s.framing.incomplete}`,
		`- 要判定(needs-adjudication): ${s.adjudications.length}件`,
	);
	for (const a of s.adjudications) {
		out.push(
			`  - ${a.taskId} ${a.condition} ${a.kind}: ${a.phrase}（${a.reason}）「${a.context}」`,
		);
	}
	for (const f of s.worldSafetyFailures) {
		out.push(`  - ${f.taskId} ${f.kind}: ${f.detail}`);
	}
	out.push("");
	out.push(
		"| 条件 | 根拠 | 必要条件 | 保留 | 禁止断定 | 合計 | 安全失敗 | in tokens | out tokens | latency ms | 訂正 | エラー | 要判定 |",
		"|---|---|---|---|---|---|---|---|---|---|---|---|---|",
	);
	for (const id of conditionIds) {
		const c = s.conditions[id];
		out.push(
			`| ${id} | ${axes.map((a) => c.axisSums[a]).join(" | ")} | ${c.totalScore} | ${c.safetyFailures} | ${c.inputTokens} | ${c.outputTokens} | ${c.latencyMsTotal} | ${c.corrections} | ${c.errors} | ${c.needsAdjudication} |`,
		);
	}
	out.push("", "（軸別の合計。平均は参考値で判定に使わない）", "");

	out.push("## 仕事ごとの結果", "");
	for (const task of report.tasks) {
		out.push(`### ${task.taskId} ${task.title} [${task.split}]`, "");
		out.push(`- Scope: ${task.scope}`);
		out.push(`- 質問: ${task.question}`);
		out.push(
			`- World対Memoryのみ: ${task.worldVsMemoryOnly.verdict}（${task.worldVsMemoryOnly.reasons.join(" / ")}）`,
		);
		out.push(
			`- 関連対Memoryのみ: ${task.relatedVsMemoryOnly.verdict}（${task.relatedVsMemoryOnly.reasons.join(" / ")}）`,
		);
		out.push(
			`- World対plain-facts（対照）: ${task.worldVsPlainFacts.verdict}（${task.worldVsPlainFacts.reasons.join(" / ")}）`,
			"",
		);
		for (const id of conditionIds) {
			const cell = task.cells[id];
			out.push(`#### ${id}`, "");
			out.push(
				`- 文脈: ${cell.contextItemIds.join(", ") || "なし"}${cell.droppedItemIds.length > 0 ? `（予算で除外: ${cell.droppedItemIds.join(", ")}）` : ""}`,
			);
			out.push(
				`- tokens: in ${cell.inputTokens} / out ${cell.outputTokens} / latency ${cell.latencyMs}ms / 訂正 ${cell.output?.corrections ?? 0}`,
			);
			if (cell.error !== null) out.push(`- エラー: ${cell.error}`);
			if (cell.output !== null) {
				out.push(
					`- 引用: ${cell.output.citations.join(", ") || "なし"} / 保留: ${cell.output.hold}`,
					"",
					"出力:",
					"",
					...cell.output.text.split("\n").map((line) => `> ${line}`),
				);
			}
			out.push("", "| 軸 | 得点 | 理由 |", "|---|---|---|");
			for (const axis of axes) {
				const a = cell.score.axes[axis];
				out.push(`| ${axis} | ${a.score} | ${escapeCell(a.reason)} |`);
			}
			for (const f of cell.score.safetyFailures) {
				out.push("", `- 安全上の失敗 ${f.kind}: ${f.detail}`);
			}
			for (const a of cell.score.adjudications) {
				out.push(
					"",
					`- 要判定(needs-adjudication) ${a.kind}: ${a.phrase}（${a.reason}）「${a.context}」`,
				);
			}
			out.push("");
		}
	}
	return `${out.join("\n")}\n`;
}
