import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { hash } from "../../eval/seed/corpus.ts";
import { arms, type Packet, type Question } from "./fixtures.ts";
import { score, summarize, type Cell } from "./results.ts";
import type { Assessment, GroundingAudit } from "./grounding.ts";

// Reports use the FROZEN protocol, not today's fixture questions or oracle.
const { values } = parseArgs({
	options: { run: { type: "string" } },
	strict: true,
});
if (!values.run) throw new Error("--run <completed directory> required");
const directory = resolve(values.run);
const protocolText = await readFile(
	resolve(directory, "protocol.json"),
	"utf8",
);
const protocol = JSON.parse(protocolText) as {
	version: string;
	model: string;
	repeats: number;
	packets: Packet[];
	questions: Question[];
	design: { plannedAnswers: number; plannedExtractions: number };
};
const reportText = await readFile(resolve(directory, "report.json"), "utf8");
const report = JSON.parse(reportText) as {
	status: string;
	protocolDigest: string;
	cells: (Cell & {
		answer: Cell["answer"] & { assessments?: Assessment[] };
		grounding?: GroundingAudit;
	})[];
	extractionCosts: {
		latencyMs: number;
		reused?: boolean;
		usage: { input_tokens: number; output_tokens: number };
	}[];
};
if (
	report.status !== "completed" ||
	report.protocolDigest !== hash(Buffer.from(protocolText)) ||
	report.cells.length !== protocol.design.plannedAnswers ||
	report.extractionCosts.length !== protocol.design.plannedExtractions
)
	throw new Error("run_incomplete_or_changed");
const keys = new Set<string>();
for (const cell of report.cells) {
	const question = protocol.questions.find((q) => q.id === cell.questionId);
	const key = `${cell.questionId}:${cell.repeat}:${cell.arm}`;
	if (
		!question ||
		keys.has(key) ||
		!arms.includes(cell.arm) ||
		!Number.isInteger(cell.repeat) ||
		cell.repeat < 0 ||
		cell.repeat >= protocol.repeats
	)
		throw new Error("invalid_or_duplicate_cell");
	keys.add(key);
	const expectedScore = score(question, cell.answer);
	if (
		Object.entries(expectedScore).some(
			([key, value]) => cell[key as keyof Cell] !== value,
		)
	)
		throw new Error("stored_score_changed");
}
const summary = summarize(report.cells);
const decisions = { better: 0, worse: 0, bothCorrect: 0, bothWrong: 0 };
for (const raw of report.cells.filter((c) => c.arm === "raw")) {
	const world = report.cells.find(
		(c) =>
			c.arm === "world" &&
			c.questionId === raw.questionId &&
			c.repeat === raw.repeat,
	)!;
	if (world.decisionCorrect && !raw.decisionCorrect) decisions.better++;
	else if (!world.decisionCorrect && raw.decisionCorrect) decisions.worse++;
	else if (world.decisionCorrect) decisions.bothCorrect++;
	else decisions.bothWrong++;
}
const armName = (arm: string) =>
	arm === "raw" ? "資料全文" : "全文＋WorldModel";
const lines = [
	"# 複数資料の比較結果",
	"",
	`実験版：${protocol.version}。`,
	`モデル：${protocol.model} / medium。架空の15資料・4資料群・16問×${protocol.repeats}回×2条件。`,
	"事前固定した判定と資料ID集合を採点。説明文は採点せず、全回答を下に掲載する。",
	"判定一致は説明文の正しさを保証しない。説明の観測値の読み違いと、判定欄との不整合は別途codex-review.jsonに記録する。",
	"",
	"| 条件 | 判定一致 | 根拠集合一致 | 両方一致 | 入力tokens | 出力tokens | 平均回答秒 |",
	"|---|---:|---:|---:|---:|---:|---:|",
];
for (const arm of arms) {
	const s = summary.byArm[arm]!;
	lines.push(
		`| ${armName(arm)} | ${s.decisionCorrect}/${s.answers} | ${s.governingSourcesCorrect}/${s.answers} | ${s.jointCorrect}/${s.answers} | ${s.inputTokens} | ${s.outputTokens} | ${((s.meanLatencyMs ?? 0) / 1000).toFixed(2)} |`,
	);
}
lines.push(
	"",
	`判定だけの対応比較：World側で改善${decisions.better}、悪化${decisions.worse}、両方正解${decisions.bothCorrect}、両方不正解${decisions.bothWrong}。`,
	`判定＋根拠集合の対応比較：改善${summary.pairs.better}、悪化${summary.pairs.worse}、両方正解${summary.pairs.bothCorrect}、両方不正解${summary.pairs.bothWrong}。`,
	"",
	"## 資料群別の判定一致",
	"",
	"| 資料群 | 資料全文 | 全文＋WorldModel |",
	"|---|---:|---:|",
);
for (const packet of protocol.packets) {
	const ids = protocol.questions
		.filter((q) => q.packet === packet.id)
		.map((q) => q.id);
	const values = arms.map((arm) => {
		const rows = report.cells.filter(
			(c) => c.arm === arm && ids.includes(c.questionId),
		);
		return `${rows.filter((c) => c.decisionCorrect).length}/${rows.length}`;
	});
	lines.push(`| ${packet.name} | ${values.join(" | ")} |`);
}
lines.push("", "## 根拠IDの診断（主指標は変更しない）", "");
for (const arm of arms) {
	const rows = report.cells.filter((c) => c.arm === arm);
	let unknown = 0;
	let unsafeAllow = 0;
	for (const cell of rows) {
		const question = protocol.questions.find((q) => q.id === cell.questionId)!;
		const ids = protocol.packets
			.find((p) => p.id === question.packet)!
			.documents.map((d) => d.id);
		if (cell.answer.governingSources.some((id) => !ids.includes(id))) unknown++;
		if (
			cell.answer.decision === "allow" &&
			question.expected.decision !== "allow"
		)
			unsafeAllow++;
	}
	lines.push(
		`- ${armName(arm)}：提示資料に存在しないIDを含む回答${unknown}/${rows.length}。正解が不可または保留なのに許可した回答${unsafeAllow}/${rows.length}。`,
	);
}
const extraction = report.extractionCosts.reduce(
	(sum, c) => ({
		input: sum.input + c.usage.input_tokens,
		output: sum.output + c.usage.output_tokens,
		ms: sum.ms + c.latencyMs,
	}),
	{ input: 0, output: 0, ms: 0 },
);
const reused = report.extractionCosts.filter((cost) => cost.reused).length;
if (report.cells.some((cell) => cell.grounding)) {
	lines.push(
		"",
		"## 根拠票と計算の整合検査",
		"",
		"| 条件 | 検査一致 | 計算の照合数 | 転記不一致 | 判定と根拠票の不一致 | 上書きの申告 |",
		"|---|---:|---:|---:|---:|---:|",
	);
	for (const arm of arms) {
		const rows = report.cells.filter((cell) => cell.arm === arm);
		lines.push(
			`| ${armName(arm)} | ${rows.filter((cell) => cell.grounding?.passed).length}/${rows.length} | ${rows.reduce((n, cell) => n + (cell.grounding?.comparedCalculations ?? 0), 0)} | ${rows.reduce((n, cell) => n + (cell.grounding?.calculationMismatches ?? 0), 0)} | ${rows.filter((cell) => cell.grounding && !cell.grounding.decisionConsistent).length} | ${rows.filter((cell) => cell.grounding?.overrides.length).length} |`,
		);
	}
	lines.push(
		"",
		"この検査はLunaが選んだ規程の参照・転記・自己申告と判定欄の対応を確認する。規程選択や説明の意味は検査していない。点数を変えず、再試行や回答の自動修正は行わない。RawにはWorldの計算を渡していないので、計算照合数0は正常。",
		"",
	);
}
lines.push(
	"",
	"## 前処理費用と解釈上の限界",
	"",
	`World側の事前抽出は${report.extractionCosts.length}呼出し、入力${extraction.input}、出力${extraction.output}tokens、呼出し所要時間の合計${(extraction.ms / 1000).toFixed(2)}秒。回答時間には含めていない。`,
	`このうち${reused}件は以前の実抽出応答をdigest照合して再利用。再利用分は元の使用量・時間を表示しており、このrunで新しく発生した抽出費用ではない。`,
	"World側は同じ全文にSliceを追加する。速度・費用の改善を狙った構成ではない。時間は順次実行した壁時計値で、サーバ負荷も混ざる。",
	"同じ問の反復と同じ資料群内の問いは独立ではない。小標本であり、統計的な優劣や実資料全体への一般化は主張しない。",
	"v2は先行v1の情報提示の偏りを修正した開発中の評価。質問と正解は共通で、独立したholdoutではない。v1は別runに保存し、v2と合算しない。",
	...(["multi-source-v3", "multi-source-v4", "multi-source-v5"].includes(
		protocol.version,
	)
		? [
				"v3は同じ問題の既知の不整合を受けて、回答指示・出力順・主張と計算の結合を改善した回帰評価。元の資料・正解・抽出を維持し、両条件に新指示を共通適用。複数変更を合わせた効果であり、出力順だけの効果や未見問題への一般化は主張しない。",
			]
		: []),
	...(protocol.version === "multi-source-v5"
		? [
				"v5は残った説明の誤認を受け、両条件に観測IDの存在表を追加し、Worldには既存エンジンで計算した比較項目ごとの入力ID・結果を追加。資料・抽出・主判定の計算・正解は維持。説明は別途全件点検し、主採点を変更しない。既知ケースの開発中の評価であり、未見での精度を保証しない。",
			]
		: []),
	"Lunaによる事前整理とWorldの処理を合わせた比較で、整理だけの第三条件はない。モデルの解釈ミスはvalidatorだけでは検出できない。",
	"全候補は未採用。比較先も同じ強い指示を受ける。長い資料・検索漏れ・実資料の不鮮明な権限関係・継続運用は未検証。",
	"根拠IDの完全一致には形式面も含まれる。特に共通ランタイム方針の説明を資料ID扱いする誤りと、規程の選択ミスを混同しない。",
	"",
	"## 全回答",
	"",
);
for (const question of protocol.questions) {
	lines.push(
		`### ${question.id} — ${question.question}`,
		"",
		`時点：${new Date(question.asOf).toISOString()}。正解：**${question.expected.decision}**／根拠${question.expected.governingSources.join(", ")}。`,
		question.expected.reason,
		"",
	);
	for (let repeat = 0; repeat < protocol.repeats; repeat++)
		for (const arm of arms) {
			const cell = report.cells.find(
				(c) =>
					c.questionId === question.id && c.repeat === repeat && c.arm === arm,
			)!;
			lines.push(
				`**${repeat + 1}回目・${armName(arm)}：${cell.answer.decision}**（判定${cell.decisionCorrect ? "一致" : "不一致"}／根拠${cell.governingSourcesCorrect ? "一致" : "不一致"}）。根拠：${cell.answer.governingSources.join(", ")}`,
				"",
				cell.answer.explanation,
				"",
			);
			if (cell.answer.assessments)
				lines.push(
					`根拠票：${cell.answer.assessments.map((a) => `${a.sourceId}=${a.result} (${a.assertionId ?? "計算参照なし"})${a.overrideReason ? `／上書き理由: ${a.overrideReason}` : ""}`).join("; ")}`,
					`整合検査：${cell.grounding?.passed ? "一致" : "要確認"}。${cell.grounding?.issues.join(", ") ?? ""}`,
					"",
				);
		}
}
lines.push(
	"## 記録",
	"",
	`protocol.json SHA256: ${hash(Buffer.from(protocolText))}`,
	`report.json SHA256: ${hash(Buffer.from(reportText))}`,
	"",
	"生応答・指示・使用量・失敗：cache/、events.jsonl。実際のSlice・条件計算・SQLite履歴：contexts.json。",
	"採点基準や成功応答の上書きはしていない。",
);
await writeFile(resolve(directory, "comparison.md"), `${lines.join("\n")}\n`);
console.log(resolve(directory, "comparison.md"));
