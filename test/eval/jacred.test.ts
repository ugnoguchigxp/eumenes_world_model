/**
 * E01: JacRED suite (jacred-ja-v1) adapter, selection, scoring and runner.
 * All fixtures are small handcrafted upstream documents; the real JacRED
 * files are never read here. Deterministic: fake providers only, no model,
 * no network.
 */
import { describe, expect, test } from "bun:test";
import {
	JACRED_CONDITION,
	JACRED_TEXT_JOIN_RULE,
	buildJacredSuite,
	convertJacredCase,
	type JacredDoc,
	type JacredMention,
	type JacredSuite,
} from "../../eval/extraction/jacred.ts";
import {
	aggregateJacredScores,
	scoreJacredCase,
	type JacredPrediction,
} from "../../eval/extraction/jacred-scoring.ts";
import { runJacredSuite } from "../../eval/extraction/jacred-runner.ts";
import type {
	ExtractionProvider,
	ProviderRequest,
} from "../../eval/extraction/runner.ts";

const rel2id = { Na: 0, P131: 1, P17: 2 };
const relInfo = { P131: "AdministrativeLocation", P17: "Country" };

const mention = (
	name: string,
	sentId: number,
	type = "LOC",
): JacredMention => ({ type, name, sent_id: sentId, pos: [0, 1] });

const doc = (over: Partial<JacredDoc> = {}): JacredDoc => ({
	title: "doc",
	sents: [["文", "。"]],
	vertexSet: [[mention("甲", 0)], [mention("乙", 0)]],
	labels: [{ h: 0, t: 1, r: "P131", evidence: [0] }],
	...over,
});

describe("jacred conversion", () => {
	test("sentence text is the tokens joined with the empty string", () => {
		const converted = convertJacredCase(
			"dev",
			doc({
				sents: [
					["東", "京"],
					["日", "本"],
				],
			}),
			7,
		);
		expect(converted.caseId).toBe("jacred-dev-7");
		expect(converted.utterances).toEqual([
			{ utteranceId: "s0", text: "東京" },
			{ utteranceId: "s1", text: "日本" },
		]);
	});

	test("display name is the lowest-sent_id mention; aliases are the rest", () => {
		const converted = convertJacredCase(
			"dev",
			doc({
				vertexSet: [
					[mention("Alpha", 1), mention("AlphaPrime", 0), mention("Alpha", 2)],
					[mention("Gamma", 0, "PER"), mention("GammaAlt", 0, "PER")],
				],
			}),
			0,
		);
		expect(converted.entities[0]).toEqual({
			id: "ent-0",
			displayName: "AlphaPrime",
			aliases: ["Alpha"],
			type: "LOC",
		});
		// Tie on sent_id: the first mention wins.
		expect(converted.entities[1]).toEqual({
			id: "ent-1",
			displayName: "Gamma",
			aliases: ["GammaAlt"],
			type: "PER",
		});
	});

	test("gold keeps single-evidence triples; the rest is counted, not dropped", () => {
		const converted = convertJacredCase(
			"dev",
			doc({
				labels: [
					{ h: 0, t: 1, r: "P131", evidence: [1] },
					// Same (subject, relation, object), other evidence: duplicate.
					{ h: 0, t: 1, r: "P131", evidence: [0] },
					{ h: 1, t: 0, r: "P17", evidence: [0, 1] },
					{ h: 1, t: 0, r: "P17", evidence: [] },
					{ h: 1, t: 0, r: "Na", evidence: [0] },
					// "Na" is counted as Na even with non-single evidence.
					{ h: 1, t: 0, r: "Na", evidence: [] },
				],
			}),
			0,
		);
		expect(converted.gold).toEqual([
			{
				subjectId: "ent-0",
				relation: "P131",
				objectId: "ent-1",
				evidenceUtteranceId: "s1",
			},
		]);
		expect(converted.unsupported).toEqual({
			multiEvidence: 2,
			naLabels: 2,
			duplicateGold: 1,
		});
	});
});

describe("jacred selection", () => {
	test("suite metadata and predicates exclude Na and carry rel_info names", () => {
		const { suite } = buildJacredSuite("dev", [doc()], rel2id, "sha", relInfo);
		expect(suite.suiteId).toBe("jacred-ja-v1");
		expect(suite.condition).toBe(JACRED_CONDITION);
		expect(suite.textJoinRule).toBe(JACRED_TEXT_JOIN_RULE);
		expect(suite.upstreamSha256).toBe("sha");
		expect(suite.predicates).toEqual([
			{ code: "P131", name: "AdministrativeLocation" },
			{ code: "P17", name: "Country" },
		]);
	});

	test("selection is deterministic for the same input", () => {
		const docs = Array.from({ length: 8 }, (_, i) => doc({ title: `d${i}` }));
		const first = buildJacredSuite("dev", docs, rel2id, "sha", relInfo);
		const second = buildJacredSuite("dev", docs, rel2id, "sha", relInfo);
		expect(second.manifest).toEqual(first.manifest);
		expect(second.suite.cases.map((c) => c.caseId)).toEqual(
			first.suite.cases.map((c) => c.caseId),
		);
	});

	test("each exclusion reason fires and the counts add up", () => {
		const tooManySentences = doc({
			sents: Array.from({ length: 17 }, () => ["文"]),
		});
		const textTooLarge = doc({ sents: [["あ".repeat(2001)]] });
		const tooManyEntities = doc({
			vertexSet: Array.from({ length: 25 }, (_, i) => [mention(`e${i}`, 0)]),
		});
		const noRepresentable = doc({
			labels: [{ h: 0, t: 1, r: "Na", evidence: [0] }],
		});
		const { manifest } = buildJacredSuite(
			"dev",
			[tooManySentences, textTooLarge, tooManyEntities, noRepresentable, doc()],
			rel2id,
			"sha",
			relInfo,
		);
		expect(manifest.upstreamCount).toBe(5);
		expect(manifest.excluded).toEqual({
			tooManySentences: 1,
			textTooLarge: 1,
			tooManyEntities: 1,
			noRepresentableRelation: 1,
			beyondCap: 0,
		});
		expect(manifest.selectedCount).toBe(1);
		expect(manifest.selectedUpstreamIndices).toEqual([4]);
		const excludedTotal = Object.values(manifest.excluded).reduce(
			(a, b) => a + b,
			0,
		);
		expect(manifest.selectedCount + excludedTotal).toBe(manifest.upstreamCount);
		expect(manifest.config).toEqual({
			seed: "jacred-e01-v1",
			maxSentences: 16,
			maxTextBytes: 6000,
			maxEntities: 24,
			cap: 30,
		});
	});

	test("the dev cap holds and overflow is counted as beyondCap", () => {
		const docs = Array.from({ length: 31 }, (_, i) => doc({ title: `d${i}` }));
		const { manifest } = buildJacredSuite("dev", docs, rel2id, "sha", relInfo);
		expect(manifest.selectedCount).toBe(30);
		expect(manifest.excluded.beyondCap).toBe(1);
		expect(new Set(manifest.selectedUpstreamIndices).size).toBe(30);
	});

	test("a split without a frozen cap is refused", () => {
		expect(() => buildJacredSuite("train", [doc()], rel2id, "sha")).toThrow(
			/frozen selection cap/,
		);
	});
});

describe("jacred scoring", () => {
	const gold = [
		{
			subjectId: "ent-0",
			relation: "P131",
			objectId: "ent-1",
			evidenceUtteranceId: "s1",
		},
		{
			subjectId: "ent-1",
			relation: "P17",
			objectId: "ent-0",
			evidenceUtteranceId: "s0",
		},
	];
	const entityIds = new Set(["ent-0", "ent-1"]);
	const relationCodes = new Set(["P131", "P17"]);
	const score = (predictions: readonly JacredPrediction[]) =>
		scoreJacredCase({ gold, predictions, entityIds, relationCodes });

	test("tp/fp/fn, f1 and evidence accuracy", () => {
		const result = score([
			{
				subjectId: "ent-0",
				relation: "P131",
				objectId: "ent-1",
				quoteUtteranceId: "s1",
			},
			{
				subjectId: "ent-1",
				relation: "P17",
				objectId: "ent-0",
				quoteUtteranceId: "s2",
			},
			{
				subjectId: "ent-0",
				relation: "P17",
				objectId: "ent-1",
				quoteUtteranceId: "s0",
			},
		]);
		expect(result.tp).toBe(2);
		expect(result.fp).toBe(1);
		expect(result.fn).toBe(0);
		expect(result.precision).toBeCloseTo(2 / 3, 10);
		expect(result.recall).toBe(1);
		expect(result.f1).toBeCloseTo(0.8, 10);
		expect(result.evidenceMatch).toBe(1);
		expect(result.evidenceAccuracy).toBe(0.5);
	});

	test("predictions are deduplicated; unknown ids/codes are invalid, not fp", () => {
		const result = score([
			{
				subjectId: "ent-0",
				relation: "P131",
				objectId: "ent-1",
				quoteUtteranceId: "s1",
			},
			{
				subjectId: "ent-0",
				relation: "P131",
				objectId: "ent-1",
				quoteUtteranceId: "s1",
			},
			{
				subjectId: "ent-9",
				relation: "P131",
				objectId: "ent-1",
				quoteUtteranceId: "s0",
			},
			{
				subjectId: "ent-0",
				relation: "P999",
				objectId: "ent-1",
				quoteUtteranceId: "s0",
			},
			{
				subjectId: "ent-1",
				relation: "P17",
				objectId: "ent-0",
				quoteUtteranceId: null,
			},
		]);
		expect(result.tp).toBe(2);
		expect(result.fp).toBe(0);
		expect(result.fn).toBe(0);
		expect(result.invalidPredictions).toBe(2);
		expect(result.quoteMissing).toBe(1);
		expect(result.evidenceAccuracy).toBe(0.5);
	});

	test("silence scores fn for every gold triple and zero rates", () => {
		const result = score([]);
		expect(result).toMatchObject({
			tp: 0,
			fp: 0,
			fn: 2,
			precision: 0,
			recall: 0,
			f1: 0,
			evidenceAccuracy: 0,
		});
	});

	test("aggregation is micro-averaged over the summed counts", () => {
		const rows = [
			score([
				{
					subjectId: "ent-0",
					relation: "P131",
					objectId: "ent-1",
					quoteUtteranceId: "s1",
				},
				{
					subjectId: "ent-1",
					relation: "P17",
					objectId: "ent-0",
					quoteUtteranceId: "s2",
				},
				{
					subjectId: "ent-0",
					relation: "P17",
					objectId: "ent-1",
					quoteUtteranceId: "s0",
				},
			]),
			score([]),
		];
		const { cases, totals } = aggregateJacredScores(rows);
		expect(cases).toEqual(rows);
		expect(totals.cases).toBe(2);
		expect(totals.tp).toBe(2);
		expect(totals.fp).toBe(1);
		expect(totals.fn).toBe(2);
		expect(totals.precision).toBeCloseTo(2 / 3, 10);
		expect(totals.recall).toBe(0.5);
	});
});

describe("jacred runner", () => {
	const suite: JacredSuite = {
		suiteId: "jacred-ja-v1",
		split: "dev",
		condition: JACRED_CONDITION,
		textJoinRule: JACRED_TEXT_JOIN_RULE,
		upstreamSha256: "test-sha",
		predicates: [
			{ code: "P131", name: "AdministrativeLocation" },
			{ code: "P17", name: "Country" },
		],
		cases: [
			{
				caseId: "jacred-dev-0",
				upstreamIndex: 0,
				title: "t",
				utterances: [
					{ utteranceId: "s0", text: "東京は日本の首都。" },
					{ utteranceId: "s1", text: "日本は国。" },
				],
				entities: [
					{
						id: "ent-0",
						displayName: "日本",
						aliases: ["日本国"],
						type: "LOC",
					},
					{ id: "ent-1", displayName: "東京", aliases: [], type: "LOC" },
				],
				gold: [
					{
						subjectId: "ent-1",
						relation: "P131",
						objectId: "ent-0",
						evidenceUtteranceId: "s0",
					},
				],
				unsupported: { multiEvidence: 2, naLabels: 1, duplicateGold: 0 },
			},
		],
	};

	const fakeProvider = (
		extract: ExtractionProvider["extract"],
	): ExtractionProvider => ({
		info: { kind: "fixture", modelId: "fake", modelVersion: "0", config: {} },
		extract,
	});

	test("end to end: parse, alias resolution, ignored non-relations, totals", async () => {
		let seen: ProviderRequest | undefined;
		const provider = fakeProvider(async (request) => {
			seen = request;
			return {
				output: JSON.stringify({
					candidates: [
						{
							subject: { kind: "id", id: "ent-1" },
							predicate: "P131",
							payload: {
								kind: "relation",
								relation: "P131",
								object: { kind: "id", id: "ent-0" },
							},
							quote: { utteranceId: "s0", startByte: 0, endByte: 9 },
						},
						{
							// Alias subject resolves to ent-0; a scored FP.
							subject: { kind: "alias", text: "日本国" },
							predicate: "P17",
							payload: {
								kind: "relation",
								relation: "P17",
								object: { kind: "id", id: "ent-1" },
							},
							quote: { utteranceId: "s1" },
						},
						{
							// Unresolved alias: kept as an invalid prediction.
							subject: { kind: "alias", text: "未知の主体" },
							predicate: "P131",
							payload: {
								kind: "relation",
								relation: "P131",
								object: { kind: "id", id: "ent-0" },
							},
							quote: { utteranceId: "s0" },
						},
						{
							// Value payload: not a relation candidate.
							subject: { kind: "id", id: "ent-0" },
							predicate: "name",
							payload: {
								kind: "value",
								value: { kind: "string", value: "日本" },
							},
							quote: { utteranceId: "s1" },
						},
					],
				}),
			};
		});
		const report = await runJacredSuite(suite, provider, {
			now: () => new Date("2026-10-29T00:00:00.000Z"),
		});
		expect(report.generatedAt).toBe("2026-10-29T00:00:00.000Z");
		expect(report.provider.modelId).toBe("fake");
		expect(seen?.predicates).toEqual(["P131", "P17"]);
		expect(seen?.entities.map((e) => e.id)).toEqual(["ent-0", "ent-1"]);
		expect(seen?.window.map((u) => u.utteranceId)).toEqual(["s0", "s1"]);
		const only = report.cases[0]!;
		expect(only.status).toBe("ok");
		expect(only.ignoredNonRelation).toBe(1);
		expect(only.unsupported).toEqual({
			multiEvidence: 2,
			naLabels: 1,
			duplicateGold: 0,
		});
		expect(only.score.tp).toBe(1);
		expect(only.score.fp).toBe(1);
		expect(only.score.invalidPredictions).toBe(1);
		expect(only.score.evidenceAccuracy).toBe(1);
		expect(report.totals.tp).toBe(1);
		expect(report.totals.cases).toBe(1);
	});

	test("object output (not a string) is accepted", async () => {
		const provider = fakeProvider(async () => ({
			output: { candidates: [] },
		}));
		const report = await runJacredSuite(suite, provider);
		expect(report.cases[0]?.status).toBe("ok");
		expect(report.totals.fn).toBe(1);
	});

	test("a throwing provider records an error case, gold stays in the fn", async () => {
		const provider = fakeProvider(async () => {
			throw new Error("backend down");
		});
		const report = await runJacredSuite(suite, provider);
		expect(report.cases[0]?.status).toBe("error");
		expect(report.cases[0]?.predictions).toEqual([]);
		expect(report.totals.fn).toBe(1);
	});

	test("malformed output records invalid_output", async () => {
		const provider = fakeProvider(async () => ({ output: "{not json" }));
		const report = await runJacredSuite(suite, provider);
		expect(report.cases[0]?.status).toBe("invalid_output");
		expect(report.totals.fn).toBe(1);
	});
});
