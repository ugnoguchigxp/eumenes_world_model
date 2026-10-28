/**
 * E04: history vs Slice under one shared budget. All fixtures are
 * handcrafted; no model, no network, no suite JSON is read here.
 */
import { describe, expect, test } from "bun:test";
import { estimateTokens } from "../../eval/decision/context.ts";
import {
	buildOracleContext,
	buildSlice,
	loadE04Suite,
	parseExtractionCandidates,
	renderHistory,
	scoreE04Answer,
	summarizeE04,
	truncateHistory,
	type E04Episode,
	type E04ExtractionCandidate,
	type E04Question,
	type E04ResultItem,
} from "../../eval/decision/e04.ts";

const episode: E04Episode = {
	id: "ep-a",
	title: "会議室と担当",
	entities: [
		{ id: "ent-room", displayName: "会議室A", aliases: ["A会議室"] },
		{ id: "ent-sato", displayName: "佐藤", aliases: ["佐藤さん"] },
	],
	sessions: [
		{
			id: "s1",
			date: "2026-09-02",
			utterances: [
				{ id: "u1", speaker: "田中", text: "会議室Aの予約上限は10人です。" },
				{ id: "u2", speaker: "佐藤", text: "会議室Aの担当は佐藤です。" },
			],
		},
		{
			id: "s2",
			date: "2026-09-09",
			utterances: [
				{
					id: "u3",
					speaker: "田中",
					text: "会議室Aの予約上限は12人に変わりました。",
				},
				{ id: "u4", speaker: "佐藤", text: "予約上限の変更を承知しました。" },
			],
		},
	],
};

const updateQuestion: E04Question = {
	id: "ep-a-q1",
	episodeId: "ep-a",
	category: "update",
	question: "会議室Aの現在の予約上限は何人ですか。",
	gold: {
		requiredGroups: [["12人"]],
		forbidden: ["10人"],
		holdExpected: false,
		evidenceUtteranceIds: ["u3"],
	},
	oracleClaims: [
		{ text: "会議室Aの予約上限は12人である。", evidenceUtteranceId: "u3" },
	],
};

const holdQuestion: E04Question = {
	id: "ep-a-q2",
	episodeId: "ep-a",
	category: "rejection",
	question: "会議室AのWi-Fiパスワードは何ですか。",
	gold: {
		requiredGroups: [],
		forbidden: [],
		holdExpected: true,
		evidenceUtteranceIds: [],
	},
	oracleClaims: [],
};

const candidate = (
	over: Partial<E04ExtractionCandidate> = {},
): E04ExtractionCandidate => ({
	subject: { kind: "id", id: "ent-room" },
	predicate: "capacity",
	payload: { kind: "value", value: { kind: "number", value: 10, unit: "人" } },
	quote: { utteranceId: "u1", startByte: 0, endByte: 45 },
	modality: "asserted",
	...over,
});

const suiteJson = () => ({
	suiteId: "e04-ja-v1",
	budgetTokens: 300,
	episodes: [
		{
			id: "ep-a",
			title: "会議室と担当",
			entities: [
				{ id: "ent-room", displayName: "会議室A", aliases: ["A会議室"] },
			],
			sessions: [
				{
					id: "s1",
					date: "2026-09-02",
					utterances: [
						{
							id: "u1",
							speaker: "田中",
							text: "会議室Aの予約上限は10人です。",
						},
					],
				},
			],
		},
	],
	questions: [
		{
			id: "ep-a-q1",
			episodeId: "ep-a",
			category: "update",
			question: "会議室Aの現在の予約上限は何人ですか。",
			gold: {
				requiredGroups: [["12人"]],
				forbidden: ["10人"],
				holdExpected: false,
				evidenceUtteranceIds: ["u1"],
			},
			oracleClaims: [
				{ text: "会議室Aの予約上限は12人である。", evidenceUtteranceId: "u1" },
			],
		},
	],
});

describe("loadE04Suite", () => {
	test("accepts a valid suite and fills alias defaults", () => {
		const suite = loadE04Suite(suiteJson());
		expect(suite.suiteId).toBe("e04-ja-v1");
		expect(suite.budgetTokens).toBe(300);
		expect(suite.episodes[0]?.entities[0]?.aliases).toEqual(["A会議室"]);
		expect(suite.questions[0]?.category).toBe("update");
	});

	test("rejects a question for an unknown episode", () => {
		const json = suiteJson();
		json.questions[0]!.episodeId = "ep-missing";
		expect(() => loadE04Suite(json)).toThrow(/unknown episode/);
	});

	test("rejects gold evidence that is not an utterance of the episode", () => {
		const json = suiteJson();
		json.questions[0]!.gold.evidenceUtteranceIds = ["uX"];
		expect(() => loadE04Suite(json)).toThrow(/unknown utterance/);
	});

	test("rejects oracle evidence that is not an utterance of the episode", () => {
		const json = suiteJson();
		json.questions[0]!.oracleClaims[0]!.evidenceUtteranceId = "uX";
		expect(() => loadE04Suite(json)).toThrow(/unknown utterance/);
	});

	test("rejects an invalid category and a non-positive budget", () => {
		const badCategory = suiteJson();
		badCategory.questions[0]!.category = "knowledge-update";
		expect(() => loadE04Suite(badCategory)).toThrow(/category/);
		const badBudget = suiteJson();
		badBudget.budgetTokens = 0;
		expect(() => loadE04Suite(badBudget)).toThrow(/budgetTokens/);
	});
});

describe("renderHistory", () => {
	test("renders every utterance in episode order with date and speaker", () => {
		const rendered = renderHistory(episode);
		expect(rendered.utteranceIds).toEqual(["u1", "u2", "u3", "u4"]);
		expect(rendered.text.split("\n")[0]).toBe(
			"[u1] (2026-09-02 田中) 会議室Aの予約上限は10人です。",
		);
		expect(rendered.text.split("\n")[2]).toBe(
			"[u3] (2026-09-09 田中) 会議室Aの予約上限は12人に変わりました。",
		);
	});
});

describe("truncateHistory", () => {
	test("keeps the most recent utterances within budget and reports dropped", () => {
		const lines = renderHistory(episode).text.split("\n");
		const budget =
			estimateTokens(lines[2] as string) + estimateTokens(lines[3] as string);
		const truncated = truncateHistory(episode, budget);
		expect(truncated.keptIds).toEqual(["u3", "u4"]);
		expect(truncated.droppedIds).toEqual(["u1", "u2"]);
		expect(truncated.text).toBe([lines[2], lines[3]].join("\n"));
	});

	test("a generous budget keeps everything", () => {
		const truncated = truncateHistory(episode, 100000);
		expect(truncated.keptIds).toEqual(["u1", "u2", "u3", "u4"]);
		expect(truncated.droppedIds).toEqual([]);
	});
});

describe("parseExtractionCandidates", () => {
	test("parses valid entries and skips malformed ones with a count", () => {
		const parsed = parseExtractionCandidates({
			candidates: [
				{
					subject: { kind: "id", id: "ent-room" },
					predicate: "capacity",
					payload: {
						kind: "value",
						value: { kind: "number", value: 12, unit: "人" },
					},
					quote: { utteranceId: "u3", startByte: 0, endByte: 10 },
					modality: "asserted",
				},
				{
					subject: { kind: "alias", text: "佐藤さん" },
					predicate: "inChargeOf",
					payload: {
						kind: "relation",
						relation: "inChargeOf",
						object: { kind: "id", id: "ent-room" },
					},
					quote: { utteranceId: "u2", startByte: 0, endByte: 10 },
					modality: "reported",
				},
				{ subject: { kind: "id", id: "ent-room" }, predicate: "capacity" },
				"not an object",
				{
					subject: { kind: "id", id: "ent-room" },
					predicate: "capacity",
					payload: { kind: "value", value: { kind: "number", value: "12" } },
					quote: { utteranceId: "u3", startByte: 0, endByte: 10 },
					modality: "asserted",
				},
			],
		});
		expect(parsed.candidates.length).toBe(2);
		expect(parsed.skipped).toBe(3);
		expect(parsed.candidates[1]?.subject).toEqual({
			kind: "alias",
			text: "佐藤さん",
		});
	});

	test("accepts a bare array and tolerates non-container input", () => {
		expect(parseExtractionCandidates([])).toEqual({
			candidates: [],
			skipped: 0,
		});
		expect(parseExtractionCandidates(null).candidates).toEqual([]);
		expect(parseExtractionCandidates(42).skipped).toBe(0);
	});
});

describe("buildSlice", () => {
	test("supersedes an older value for the same subject and predicate", () => {
		const slice = buildSlice(
			episode,
			[
				candidate(),
				candidate({
					payload: {
						kind: "value",
						value: { kind: "number", value: 12, unit: "人" },
					},
					quote: { utteranceId: "u3", startByte: 0, endByte: 10 },
				}),
			],
			updateQuestion,
			100000,
		);
		expect(slice.supersededCount).toBe(1);
		expect(slice.claimIds).toEqual(["c1"]);
		expect(slice.text).toContain("12人");
		expect(slice.text).not.toContain("10人");
		expect(slice.includedEvidenceIds).toEqual(["u3"]);
		expect(slice.partial).toBe(false);
	});

	test("excludes hold modalities and counts them", () => {
		const slice = buildSlice(
			episode,
			[
				candidate({
					modality: "negated",
					predicate: "wifiPassword",
					payload: {
						kind: "value",
						value: { kind: "string", value: "secret" },
					},
				}),
				candidate({
					modality: "hypothetical",
					predicate: "capacity",
					quote: { utteranceId: "u4", startByte: 0, endByte: 10 },
				}),
			],
			updateQuestion,
			100000,
		);
		expect(slice.heldOutCount).toBe(2);
		expect(slice.claimIds).toEqual([]);
		expect(slice.text).toBe("");
	});

	test("question-mentioned subjects come before more recent claims", () => {
		const slice = buildSlice(
			episode,
			[
				candidate({
					subject: { kind: "alias", text: "佐藤さん" },
					predicate: "inChargeOf",
					payload: {
						kind: "relation",
						relation: "inChargeOf",
						object: { kind: "id", id: "ent-room" },
					},
					quote: { utteranceId: "u2", startByte: 0, endByte: 10 },
				}),
				candidate({
					quote: { utteranceId: "u4", startByte: 0, endByte: 10 },
				}),
			],
			{
				...updateQuestion,
				question: "佐藤さんは何の担当ですか。",
			},
			100000,
		);
		expect(slice.claimIds).toEqual(["c1", "c2"]);
		expect(slice.text.split("\n")[0]).toContain("佐藤 inChargeOf 会議室A");
	});

	test("renders the quote byte range when it decodes, else the full text", () => {
		const text = episode.sessions[0]?.utterances[0]?.text as string;
		const bytes = new TextEncoder().encode(text);
		const sliced = buildSlice(
			episode,
			[
				candidate({
					quote: {
						utteranceId: "u1",
						startByte: 0,
						endByte: bytes.length,
					},
				}),
			],
			updateQuestion,
			100000,
		);
		expect(sliced.text).toContain(`「${text}」`);
		const outOfRange = buildSlice(
			episode,
			[
				candidate({
					quote: { utteranceId: "u1", startByte: 0, endByte: 99999 },
				}),
			],
			updateQuestion,
			100000,
		);
		expect(outOfRange.text).toContain(`「${text}」`);
	});

	test("a budget cut marks partial and counts dropped claims", () => {
		const claims = [
			candidate({ quote: { utteranceId: "u1", startByte: 0, endByte: 10 } }),
			candidate({
				predicate: "inChargeOf",
				subject: { kind: "id", id: "ent-sato" },
				payload: {
					kind: "relation",
					relation: "inChargeOf",
					object: { kind: "id", id: "ent-room" },
				},
				quote: { utteranceId: "u2", startByte: 0, endByte: 10 },
			}),
			candidate({
				predicate: "capacity",
				payload: {
					kind: "value",
					value: { kind: "number", value: 12, unit: "人" },
				},
				quote: { utteranceId: "u3", startByte: 0, endByte: 10 },
			}),
		];
		const slice = buildSlice(episode, claims, updateQuestion, 5);
		expect(slice.partial).toBe(true);
		expect(slice.droppedClaims).toBeGreaterThan(0);
		expect(slice.claimIds.length + slice.droppedClaims).toBe(2);
	});

	const chainEpisode: E04Episode = {
		id: "ep-chain",
		title: "APIの依存と担当",
		entities: [
			{ id: "ent-search", displayName: "検索API", aliases: [] },
			{ id: "ent-analysis", displayName: "分析API", aliases: [] },
			{ id: "ent-tanaka", displayName: "田中", aliases: [] },
			{ id: "ent-room-b", displayName: "会議室B", aliases: [] },
		],
		sessions: [
			{
				id: "s1",
				date: "2026-09-02",
				utterances: [
					{
						id: "v1",
						speaker: "佐藤",
						text: "検索APIは分析APIに依存しています。",
					},
					{ id: "v2", speaker: "佐藤", text: "分析APIの担当は田中です。" },
					{
						id: "v3",
						speaker: "佐藤",
						text: "会議室Bの予約上限は8人です。",
					},
				],
			},
		],
	};

	const chainQuestion: E04Question = {
		id: "ep-chain-q1",
		episodeId: "ep-chain",
		category: "multi-session",
		question: "検索APIが依存しているAPIの担当者は誰ですか。",
		gold: {
			requiredGroups: [["田中"]],
			forbidden: [],
			holdExpected: false,
			evidenceUtteranceIds: ["v1", "v2"],
		},
		oracleClaims: [
			{
				text: "検索APIは分析APIに依存している。",
				evidenceUtteranceId: "v1",
			},
			{ text: "分析APIの担当は田中である。", evidenceUtteranceId: "v2" },
		],
	};

	const chainClaims: E04ExtractionCandidate[] = [
		{
			subject: { kind: "id", id: "ent-search" },
			predicate: "depends_on",
			payload: {
				kind: "relation",
				relation: "depends_on",
				object: { kind: "id", id: "ent-analysis" },
			},
			quote: { utteranceId: "v1", startByte: 0, endByte: 10 },
			modality: "asserted",
		},
		{
			subject: { kind: "id", id: "ent-analysis" },
			predicate: "owner",
			payload: {
				kind: "value",
				value: { kind: "entity", entityId: "ent-tanaka" },
			},
			quote: { utteranceId: "v2", startByte: 0, endByte: 10 },
			modality: "asserted",
		},
		{
			subject: { kind: "id", id: "ent-room-b" },
			predicate: "capacity",
			payload: {
				kind: "value",
				value: { kind: "number", value: 8, unit: "人" },
			},
			quote: { utteranceId: "v3", startByte: 0, endByte: 10 },
			modality: "asserted",
		},
	];

	test("one-hop expansion ranks a chained claim before an unrelated claim and keeps it under a tight budget", () => {
		// The owner claim's names （分析API・田中） never appear in the
		// question; only the depends_on claim (tier 1) references 分析API.
		// The unrelated claim quotes the newest utterance, so plain
		// recency would rank it ahead of the owner claim.
		const full = buildSlice(chainEpisode, chainClaims, chainQuestion, 100000);
		const lines = full.text.split("\n");
		expect(lines.length).toBe(3);
		expect(lines[0]).toContain("検索API depends_on 分析API");
		expect(lines[1]).toContain("分析API owner 田中");
		expect(lines[2]).toContain("会議室B capacity 8人");
		const budget =
			estimateTokens(lines[0] as string) + estimateTokens(lines[1] as string);
		const cut = buildSlice(chainEpisode, chainClaims, chainQuestion, budget);
		expect(cut.claimIds).toEqual(["c1", "c2"]);
		expect(cut.text).toContain("田中");
		expect(cut.droppedClaims).toBe(1);
		expect(cut.partial).toBe(true);
		expect(cut.includedEvidenceIds).toEqual(["v1", "v2"]);
	});

	test("tiers order 1 before 1.5 before 2 regardless of recency or input order", () => {
		const orderEpisode: E04Episode = {
			id: "ep-order",
			title: "tier順序",
			entities: [
				{ id: "ent-search", displayName: "検索API", aliases: [] },
				{ id: "ent-analysis", displayName: "分析API", aliases: [] },
				{ id: "ent-tanaka", displayName: "田中", aliases: [] },
				{ id: "ent-room-b", displayName: "会議室B", aliases: [] },
				{ id: "ent-record", displayName: "記録API", aliases: [] },
			],
			sessions: [
				{
					id: "s1",
					date: "2026-09-02",
					utterances: [
						{
							id: "w1",
							speaker: "佐藤",
							text: "検索APIは分析APIに依存しています。",
						},
						{
							id: "w2",
							speaker: "佐藤",
							text: "分析APIの担当は田中です。",
						},
						{
							id: "w3",
							speaker: "佐藤",
							text: "会議室Bは分析APIを利用しています。",
						},
						{
							id: "w4",
							speaker: "佐藤",
							text: "記録APIの容量は100GBです。",
						},
					],
				},
			],
		};
		const claims: E04ExtractionCandidate[] = [
			// Tier 2: unrelated, but quotes the newest utterance.
			{
				subject: { kind: "id", id: "ent-record" },
				predicate: "capacity",
				payload: {
					kind: "value",
					value: { kind: "number", value: 100, unit: "GB" },
				},
				quote: { utteranceId: "w4", startByte: 0, endByte: 10 },
				modality: "asserted",
			},
			// Tier 1.5 via its object: 会議室B uses 分析API (referenced by tier 1).
			{
				subject: { kind: "id", id: "ent-room-b" },
				predicate: "uses",
				payload: {
					kind: "relation",
					relation: "uses",
					object: { kind: "id", id: "ent-analysis" },
				},
				quote: { utteranceId: "w3", startByte: 0, endByte: 10 },
				modality: "asserted",
			},
			// Tier 1: 検索API is named in the question.
			{
				subject: { kind: "id", id: "ent-search" },
				predicate: "depends_on",
				payload: {
					kind: "relation",
					relation: "depends_on",
					object: { kind: "id", id: "ent-analysis" },
				},
				quote: { utteranceId: "w1", startByte: 0, endByte: 10 },
				modality: "asserted",
			},
			// Tier 1.5 via its subject: 分析API owner 田中.
			{
				subject: { kind: "id", id: "ent-analysis" },
				predicate: "owner",
				payload: {
					kind: "value",
					value: { kind: "entity", entityId: "ent-tanaka" },
				},
				quote: { utteranceId: "w2", startByte: 0, endByte: 10 },
				modality: "asserted",
			},
		];
		const slice = buildSlice(
			orderEpisode,
			claims,
			{ ...chainQuestion, episodeId: "ep-order" },
			100000,
		);
		const lines = slice.text.split("\n");
		expect(lines.length).toBe(4);
		expect(lines[0]).toContain("検索API depends_on 分析API");
		// Within tier 1.5, recency still decides: w3 before w2.
		expect(lines[1]).toContain("会議室B uses 分析API");
		expect(lines[2]).toContain("分析API owner 田中");
		expect(lines[3]).toContain("記録API capacity 100GB");
	});
});

describe("buildOracleContext", () => {
	test("renders oracle claims with their evidence ids", () => {
		const oracle = buildOracleContext(updateQuestion, episode, 100000);
		expect(oracle.claimIds).toEqual(["c1"]);
		expect(oracle.text).toBe("[c1] 会議室Aの予約上限は12人である。 (根拠: u3)");
		expect(oracle.includedEvidenceIds).toEqual(["u3"]);
		expect(oracle.partial).toBe(false);
	});

	test("a budget cut marks the oracle context partial", () => {
		const oracle = buildOracleContext(updateQuestion, episode, 1);
		expect(oracle.partial).toBe(true);
		expect(oracle.claimIds).toEqual([]);
	});
});

describe("scoreE04Answer", () => {
	const contextIds = new Set(["u1", "u2", "u3", "u4"]);

	test("correct when every required group is present and no hold", () => {
		const score = scoreE04Answer(
			updateQuestion,
			{ answer: "現在の予約上限は12人です。", hold: false, citations: ["u3"] },
			contextIds,
		);
		expect(score.correct).toBe(true);
		expect(score.contamination).toBe(false);
		expect(score.holdCorrect).toBe(true);
		expect(score.citationValid).toBe(true);
	});

	test("incorrect when a required group is missing", () => {
		const score = scoreE04Answer(
			updateQuestion,
			{ answer: "予約上限は変わりました。", hold: false, citations: [] },
			contextIds,
		);
		expect(score.correct).toBe(false);
		expect(score.reasons.join(" ")).toContain("12人");
	});

	test("contamination when a forbidden stale fact is asserted", () => {
		const score = scoreE04Answer(
			updateQuestion,
			{ answer: "予約上限は10人です。", hold: false, citations: ["u1"] },
			contextIds,
		);
		expect(score.contamination).toBe(true);
		expect(score.correct).toBe(false);
	});

	test("hold questions are correct only when the answer holds", () => {
		const held = scoreE04Answer(
			holdQuestion,
			{ answer: "", hold: true, citations: [] },
			contextIds,
		);
		expect(held.correct).toBe(true);
		expect(held.holdCorrect).toBe(true);
		const answered = scoreE04Answer(
			holdQuestion,
			{ answer: "パスワードは不明です。", hold: false, citations: [] },
			contextIds,
		);
		expect(answered.correct).toBe(false);
		expect(answered.holdCorrect).toBe(false);
	});

	test("an unexpected hold on a normal question is incorrect", () => {
		const score = scoreE04Answer(
			updateQuestion,
			{ answer: "", hold: true, citations: [] },
			contextIds,
		);
		expect(score.correct).toBe(false);
		expect(score.holdCorrect).toBe(false);
	});

	test("citations outside the presented context are invalid", () => {
		const score = scoreE04Answer(
			updateQuestion,
			{ answer: "12人です。", hold: false, citations: ["u3", "c9"] },
			contextIds,
		);
		expect(score.correct).toBe(true);
		expect(score.citationValid).toBe(false);
	});
});

describe("summarizeE04", () => {
	const result = (over: Partial<E04ResultItem>): E04ResultItem => ({
		arm: "w-slice",
		category: "update",
		correct: true,
		contamination: false,
		holdCorrect: true,
		citationValid: true,
		reasons: [],
		inputTokens: 100,
		evidenceRecall: 1,
		partial: false,
		...over,
	});

	test("aggregates per arm and per arm x category", () => {
		const summary = summarizeE04([
			result({}),
			result({ correct: false, inputTokens: 300, evidenceRecall: 0.5 }),
			result({
				arm: "h-budget",
				category: "rejection",
				contamination: true,
				evidenceRecall: null,
				partial: true,
			}),
		]);
		const slice = summary.byArm["w-slice"];
		expect(slice.n).toBe(2);
		expect(slice.correctRate).toBe(0.5);
		expect(slice.meanInputTokens).toBe(200);
		expect(slice.meanEvidenceRecall).toBe(0.75);
		expect(slice.partialCount).toBe(0);
		const budget = summary.byArm["h-budget"];
		expect(budget.n).toBe(1);
		expect(budget.contaminationCount).toBe(1);
		expect(budget.meanEvidenceRecall).toBeNull();
		expect(budget.partialCount).toBe(1);
		expect(summary.byArmCategory["h-budget"]["rejection"].n).toBe(1);
		expect(summary.byArmCategory["w-slice"]["update"].n).toBe(2);
	});

	test("an arm with no results has null rates and stays in the output", () => {
		const summary = summarizeE04([]);
		const oracle = summary.byArm["w-oracle"];
		expect(oracle.n).toBe(0);
		expect(oracle.correctRate).toBeNull();
		expect(oracle.holdAccuracy).toBeNull();
		expect(oracle.meanInputTokens).toBeNull();
		expect(oracle.meanEvidenceRecall).toBeNull();
		expect(oracle.contaminationCount).toBe(0);
		expect(summary.byArmCategory["h-full"]["temporal"].n).toBe(0);
	});
});
