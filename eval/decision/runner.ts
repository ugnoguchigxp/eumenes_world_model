/**
 * Runs every task under the three conditions with identical settings and
 * builds the report. Providers are injected; nothing here touches a model,
 * the network or the filesystem.
 */
import { applyBudget, buildContext } from "./context.ts";
import {
	REPORT_SCHEMA,
	type AcceptanceBlock,
	type AdjudicationEntry,
	type CellResult,
	type ConditionSummary,
	type FramingEvidence,
	type Report,
	type SafetyEntry,
	type Summary,
	type TaskResult,
} from "./report.ts";
import {
	ACCEPTANCE,
	compareTask,
	judgeAcceptance,
	scoreMissing,
	scoreOutput,
} from "./scoring.ts";
import type { FrozenCheck } from "./tasks.ts";
import { HAND_AUTHORED, presentWorldClaims } from "./world-pipeline.ts";
import {
	axes,
	conditionIds,
	type Axis,
	type ConditionId,
	type Mode,
	type Provider,
	type ProviderOutput,
	type RunSettings,
	type Task,
} from "./types.ts";

export interface RunOptions {
	readonly mode: Mode;
	readonly tasks: readonly Task[];
	readonly provider: Provider;
	readonly seed: number;
	readonly inputBudgetTokens: number;
	readonly temperature?: number;
	readonly frozen: Readonly<Record<string, FrozenCheck>>;
	/** ISO timestamp; injected so the report is reproducible in tests. */
	readonly generatedAt: string;
	/** Monotonic millisecond clock; injected for deterministic latency. */
	readonly now?: () => number;
}

function validOutput(value: unknown): value is ProviderOutput {
	if (value === null || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v["text"] === "string" &&
		Array.isArray(v["citations"]) &&
		(v["citations"] as unknown[]).every((c) => typeof c === "string") &&
		typeof v["hold"] === "boolean" &&
		typeof v["corrections"] === "number" &&
		typeof v["inputTokens"] === "number" &&
		typeof v["outputTokens"] === "number"
	);
}

async function runCell(
	task: Task,
	condition: ConditionId,
	provider: Provider,
	settings: RunSettings,
	now: () => number,
): Promise<CellResult> {
	let budgeted: ReturnType<typeof applyBudget>;
	try {
		budgeted = applyBudget(
			task.question,
			buildContext(task, condition),
			settings.inputBudgetTokens,
		);
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		return {
			condition,
			contextItemIds: [],
			droppedItemIds: [],
			output: null,
			error: `context: ${message}`,
			inputTokens: 0,
			outputTokens: 0,
			latencyMs: 0,
			score: scoreMissing(`文脈を作れない: ${message}`),
		};
	}
	const contextItemIds = budgeted.kept.map((i) => i.id);
	const started = now();
	let raw: unknown = null;
	let error: string | null = null;
	try {
		raw = await provider.complete({
			taskId: task.id,
			condition,
			scope: task.scope,
			question: task.question,
			context: budgeted.kept,
			settings,
		});
	} catch (cause) {
		error = cause instanceof Error ? cause.message : String(cause);
	}
	const latencyMs = Math.max(0, Math.round(now() - started));
	if (error === null && !validOutput(raw)) error = "invalid provider output";
	if (error !== null || !validOutput(raw)) {
		return {
			condition,
			contextItemIds,
			droppedItemIds: budgeted.dropped,
			output: null,
			error: error ?? "invalid provider output",
			inputTokens: budgeted.inputTokens,
			outputTokens: 0,
			latencyMs,
			score: scoreMissing(`出力なし: ${error ?? "invalid provider output"}`),
		};
	}
	return {
		condition,
		contextItemIds,
		droppedItemIds: budgeted.dropped,
		output: {
			text: raw.text,
			citations: [...raw.citations],
			hold: raw.hold,
			corrections: raw.corrections,
		},
		error: null,
		inputTokens: raw.inputTokens,
		outputTokens: raw.outputTokens,
		latencyMs,
		score: scoreOutput(task.rubric, raw, new Set(contextItemIds)),
	};
}

function summarizeCondition(
	results: readonly TaskResult[],
	condition: ConditionId,
): ConditionSummary {
	const sums = Object.fromEntries(axes.map((a) => [a, 0])) as Record<
		Axis,
		number
	>;
	let totalScore = 0;
	let safety = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let latency = 0;
	let corrections = 0;
	let errors = 0;
	let adjudication = 0;
	for (const task of results) {
		const cell = task.cells[condition];
		for (const axis of axes) sums[axis] += cell.score.axes[axis].score;
		totalScore += cell.score.total;
		safety += cell.score.safetyFailures.length;
		inputTokens += cell.inputTokens;
		outputTokens += cell.outputTokens;
		latency += cell.latencyMs;
		corrections += cell.output?.corrections ?? 0;
		if (cell.error !== null) errors += 1;
		adjudication += cell.score.adjudications.length;
	}
	const n = results.length;
	const averages = Object.fromEntries(
		axes.map((a) => [a, n === 0 ? 0 : Math.round((sums[a] / n) * 1000) / 1000]),
	) as Record<Axis, number>;
	return {
		tasks: n,
		axisSums: sums,
		axisAverages: averages,
		totalScore,
		safetyFailures: safety,
		inputTokens,
		outputTokens,
		latencyMsTotal: latency,
		corrections,
		errors,
		needsAdjudication: adjudication,
	};
}

export function summarize(results: readonly TaskResult[]): Summary {
	const improvedIds: string[] = [];
	const worseIds: string[] = [];
	let improvedTuning = 0;
	let same = 0;
	let incomplete = 0;
	let judged = 0;
	const worldSafety: SafetyEntry[] = [];
	const adjudications: AdjudicationEntry[] = [];
	const framingImproved: string[] = [];
	const framingWorse: string[] = [];
	let framingSame = 0;
	let framingIncomplete = 0;
	for (const task of results) {
		const framing = task.worldVsPlainFacts.verdict;
		if (framing === "improved") {
			if (task.split === "evaluation") framingImproved.push(task.taskId);
		} else if (framing === "worse") framingWorse.push(task.taskId);
		else if (framing === "same") framingSame += 1;
		else framingIncomplete += 1;
		for (const condition of conditionIds) {
			for (const a of task.cells[condition].score.adjudications) {
				adjudications.push({ ...a, taskId: task.taskId, condition });
			}
		}
		if (task.split === "evaluation") judged += 1;
		const verdict = task.worldVsMemoryOnly.verdict;
		if (verdict === "improved") {
			if (task.split === "evaluation") improvedIds.push(task.taskId);
			else improvedTuning += 1;
		} else if (verdict === "worse") worseIds.push(task.taskId);
		else if (verdict === "same") same += 1;
		else incomplete += 1;
		for (const f of task.cells["memory-world"].score.safetyFailures) {
			worldSafety.push({
				taskId: task.taskId,
				condition: "memory-world",
				kind: f.kind,
				detail: f.detail,
			});
		}
	}
	const conditions = Object.fromEntries(
		conditionIds.map((c) => [c, summarizeCondition(results, c)]),
	) as Record<ConditionId, ConditionSummary>;
	const byCondition = Object.fromEntries(
		conditionIds.map((c) => [c, conditions[c].safetyFailures]),
	) as Record<ConditionId, number>;
	return {
		tasksRun: results.length,
		evaluationTasksJudged: judged,
		improved: improvedIds.length,
		improvedTaskIds: improvedIds,
		improvedTuning,
		worse: worseIds.length,
		worseTaskIds: worseIds,
		same,
		incomplete,
		worldSafetyFailures: worldSafety,
		safetyFailuresByCondition: byCondition,
		conditions,
		adjudications,
		framing: {
			improved: framingImproved.length,
			improvedTaskIds: framingImproved,
			worse: framingWorse.length,
			worseTaskIds: framingWorse,
			same: framingSame,
			incomplete: framingIncomplete,
		},
	};
}

/**
 * The control: did World framing help beyond supplying the same facts?
 * Informational only. The acceptance gate is World versus Memory-only.
 */
function framingEvidenceFor(
	mode: Mode,
	evidence: Report["evidence"],
	summary: Summary,
): FramingEvidence {
	if (mode === "tuning") {
		return { status: "not-judged", note: "調整用の実行。判定しない。" };
	}
	const f = summary.framing;
	if (f.incomplete > 0 || summary.adjudications.length > 0) {
		return {
			status: "incomplete",
			note: "plain-facts対照に比較不能または要判定があり、枠組みの効果を判定できない。",
		};
	}
	const demonstrated = f.improved >= ACCEPTANCE.minImproved && f.worse === 0;
	const fixtureCaveat =
		evidence === "fixture"
			? "【fixture】模擬providerはWorld枠組みのメタデータ（置換・保留）を機械的に使うため、この判定はharnessの動作確認でありWorldの効果の証拠ではない。 "
			: "";
	return {
		status: demonstrated ? "demonstrated" : "not-demonstrated",
		note: `${fixtureCaveat}${
			demonstrated
				? `同じ事実を平文で渡す対照に対し、評価用で${f.improved}件改善・悪化0件。World枠組み（条件・置換・保留の表示）の寄与を示す参考証拠（受入ゲートではない）。`
				: `同じ事実を平文で渡す対照に対し、評価用の改善${f.improved}件・悪化${f.worse}件。受入ゲートを満たしても、Worldの枠組みが主張文の複写以上に効いたとは言えない。`
		}`,
	};
}

function acceptanceFor(
	mode: Mode,
	evidence: Report["evidence"],
	summary: Summary,
): AcceptanceBlock {
	const framingEvidence = framingEvidenceFor(mode, evidence, summary);
	if (mode === "tuning") {
		return {
			status: "tuning-only",
			gate: "world-vs-memory-only",
			framingEvidence,
			result: null,
			p5Accepted: false,
			note: "調整用の実行。評価入力を使っておらず、受入判定は行わない。",
		};
	}
	const cellErrors = conditionIds.reduce(
		(n, c) => n + summary.conditions[c].errors,
		0,
	);
	const result = judgeAcceptance({
		improved: summary.improved,
		worse: summary.worse,
		safetyFailures: summary.worldSafetyFailures.length,
		incomplete: summary.incomplete + cellErrors,
		needsAdjudication: summary.adjudications.length,
	});
	const status = result.accepted ? "accepted" : "not-accepted";
	return {
		status,
		gate: "world-vs-memory-only",
		framingEvidence,
		result,
		p5Accepted: result.accepted && evidence === "real-model",
		note:
			evidence === "fixture"
				? "fixture providerの結果であり実モデルの受入ではない。G5は未充足、P5は未受入のまま。"
				: result.accepted
					? "実モデルでの初期受入基準を満たした。G5の他の条件は別途確認する。"
					: "実モデルでの初期受入基準を満たさない。P5は未受入。",
	};
}

function worldAuthoring(tasks: readonly Task[]): Report["worldAuthoring"] {
	const sliceDigests: Record<string, string> = {};
	for (const task of tasks) {
		try {
			sliceDigests[task.id] = presentWorldClaims(task).digest;
		} catch (cause) {
			sliceDigests[task.id] =
				`error: ${cause instanceof Error ? cause.message : String(cause)}`;
		}
	}
	return {
		pipeline:
			"World純粋API buildWorldSlice（assertion記録の検証・Scope・source状態・鮮度・提示予算）を通した slice unit を提示",
		handAuthored: HAND_AUTHORED,
		sliceDigests,
		note: "全仕事で主張文・条件文・置換元・保留条件は手書き（v1）。純粋層はMemory原典からこれらを導出しない。passはWorldの有用性の証拠ではなく、memory-plain-facts対照に対する差で別途判断する。",
	};
}

export async function runDecisionEval(options: RunOptions): Promise<Report> {
	if (options.mode === "tuning") {
		const leaked = options.tasks.filter((t) => t.split !== "tuning");
		if (leaked.length > 0) {
			throw new Error("evaluation inputs must not be loaded in tuning mode");
		}
	}
	const now = options.now ?? (() => performance.now());
	const settings: RunSettings = {
		model: options.provider.model,
		seed: options.seed,
		temperature: options.temperature ?? 0,
		inputBudgetTokens: options.inputBudgetTokens,
	};
	const results: TaskResult[] = [];
	for (const task of options.tasks) {
		const cells = {} as Record<ConditionId, CellResult>;
		for (const condition of conditionIds) {
			cells[condition] = await runCell(
				task,
				condition,
				options.provider,
				settings,
				now,
			);
		}
		const memoryOnly = cells["memory-only"];
		const asScore = (c: CellResult) => (c.error === null ? c.score : null);
		results.push({
			taskId: task.id,
			split: task.split,
			title: task.title,
			scope: task.scope,
			question: task.question,
			cells,
			worldVsMemoryOnly: compareTask(
				asScore(memoryOnly),
				asScore(cells["memory-world"]),
			),
			relatedVsMemoryOnly: compareTask(
				asScore(memoryOnly),
				asScore(cells["memory-related"]),
			),
			worldVsPlainFacts: compareTask(
				asScore(cells["memory-plain-facts"]),
				asScore(cells["memory-world"]),
			),
		});
	}
	const evidence = options.provider.kind === "real" ? "real-model" : "fixture";
	const summary = summarize(results);
	return {
		schema: REPORT_SCHEMA,
		mode: options.mode,
		evidence,
		generatedAt: options.generatedAt,
		provider: {
			id: options.provider.id,
			kind: options.provider.kind,
			model: options.provider.model,
		},
		settings,
		worldAuthoring: worldAuthoring(options.tasks),
		frozen: options.frozen,
		tasks: results,
		summary,
		acceptance: acceptanceFor(options.mode, evidence, summary),
	};
}
