import type { Tri } from "../../src/index.ts";
import type { Packet, Decision } from "../multi-source-comparison/fixtures.ts";
import type { AnswerContext } from "../multi-source-comparison/world.ts";
import { observation } from "../linked-answer-holdout/fixtures.ts";
import type { SourceQuestion } from "../operative-sources-comparison/fixtures.ts";
import saved from "./regressions.json";
export type { SourceQuestion };
export const VERSION = "instruction-order-factorial-v1";
export const regressions = saved.cases as unknown as {
	question: SourceQuestion;
	context: AnswerContext;
}[];
const time = (iso: string) => Date.parse(iso);
export const packets: Packet[] = [
	{
		id: "night-projection",
		name: "架空星像上映室の投影開始",
		keys: {
			registered: "登録済み boolean",
			dark: "暗室状態 boolean",
			curtain: "遮光幕あり boolean",
		},
		documents: [
			{
				id: "NP4",
				statement:
					"2026年12月1日00:00 UTC施行。投影開始を許すのは、登録済みで、暗室状態または遮光幕ありの少なくとも一方が成り立つ場合に限り、その条件を満たせば許可する。観測はNP8による。",
				authority: "施設評議会の正式規程",
				published: "2026-12-01T00:00:00.000Z",
			},
			{
				id: "NP1",
				statement:
					"公表日と施行日は異なる。2026年12月22日18:30 UTCに効力を生じ、その時刻にNP4を撤回して置換する。投影開始の必要十分条件は登録済み、暗室状態、遮光幕ありの全て。NP8の観測方針は存続する。それまではNP4が有効。",
				authority: "施設評議会の正式規程",
				published: "2026-12-07T00:00:00.000Z",
			},
			{
				id: "NP8",
				statement:
					"2026年12月1日00:00 UTC施行。投影開始判断の観測方針。観測は基準時刻以前かつ1時間以内（境界含む）のものを使う。同一項目ではpriority最大を採用し、同順位で異なる値、古い値、未来の値、欠落は不明とする。観測方針は許可条件を追加しない。",
				authority: "施設評議会の正式規程",
				published: "2026-12-01T00:00:00.000Z",
			},
			{
				id: "NP7",
				statement:
					"運用日誌には12月9日に遮光幕のみで上映したと記録されている。これは当時の記録であり、許可条件や観測方針を制定・改訂する文書ではない。",
				authority: "上映係の運用日誌",
				published: "2026-12-10T00:00:00.000Z",
			},
		],
	},
	{
		id: "cargo-lift",
		name: "架空資材昇降機の搬送開始",
		keys: {
			signed: "作業票署名済み boolean",
			mass: "積載質量 number kg",
		},
		documents: [
			{
				id: "CL6",
				statement:
					"2026年12月1日00:00 UTC施行。許可章: 搬送開始の必要十分条件は作業票署名済みかつ積載質量900 kg以下。観測章: 観測は基準時刻以前かつ1時間以内（境界含む）のものを使う。同一項目ではpriority最大を採用し、同順位で異なる値、古い値、未来の値、欠落は不明とする。観測方針は許可条件を追加しない。",
				authority: "施設評議会の正式規程",
				published: "2026-12-01T00:00:00.000Z",
			},
			{
				id: "CL2",
				statement:
					"2026年12月11日08:00 UTCからCL6の許可章だけを撤回し、署名済みかつ積載質量700 kg以下を搬送開始の必要十分条件とする。CL6の観測章は存続する。",
				authority: "施設評議会の正式規程",
				published: "2026-12-03T00:00:00.000Z",
			},
			{
				id: "CL9",
				statement:
					"2026年12月23日08:00 UTC施行。その時刻にCL2を撤回して置換する。搬送開始の必要十分条件は作業票署名済みかつ積載質量850 kg以下。CL6の旧許可章を復活させない。CL6の観測章は引き続き適用する。",
				authority: "施設評議会の正式規程",
				published: "2026-12-06T00:00:00.000Z",
			},
			{
				id: "CL5",
				statement:
					"沿革には当初の積載上限900 kgと、その後の700 kgへの変更が記されている。この資料は許可や観測方法を新設せず、旧規程も復活させない。",
				authority: "設備担当者の沿革記録",
				published: "2026-12-15T00:00:00.000Z",
			},
		],
	},
	{
		id: "music-vault",
		name: "架空楽譜収蔵室の入室",
		keys: {
			credential: "入室証有効 boolean",
			humidity: "湿度 number percent",
		},
		documents: [
			{
				id: "MV7",
				statement:
					"2026年12月1日00:00 UTC施行。許可章: 入室の必要十分条件は入室証有効かつ湿度60 percent以下。観測章: 観測は基準時刻以前かつ1時間以内（境界含む）のものを使う。同一項目ではpriority最大を採用し、同順位で異なる値、古い値、未来の値、欠落は不明とする。観測方針は許可条件を追加しない。",
				authority: "施設評議会の正式規程",
				published: "2026-12-01T00:00:00.000Z",
			},
			{
				id: "MV3",
				statement:
					"2026年12月19日10:15 UTCにMV7を全文撤回する。旧観測章も存続しない。同時刻から入室の必要十分条件は入室証有効かつ湿度45 percent以下とし、観測方法はMV9を使う。",
				authority: "施設評議会の正式規程",
				published: "2026-12-05T00:00:00.000Z",
			},
			{
				id: "MV9",
				statement:
					"2026年12月19日10:15 UTC施行。収蔵室入室の観測方針。観測は基準時刻以前かつ1時間以内（境界含む）のものを使う。同一項目ではpriority最大を採用し、同順位で異なる値、古い値、未来の値、欠落は不明とする。観測方針は許可条件を追加しない。",
				authority: "施設評議会の正式規程",
				published: "2026-12-08T00:00:00.000Z",
			},
			{
				id: "MV2",
				statement:
					"旧手順の解説資料には、かつて湿度60 percentを上限として扱った理由が記されている。現在の入室許可や観測方法を定める権限はない。",
				authority: "保存記録係の旧手順解説",
				published: "2026-12-20T00:00:00.000Z",
			},
		],
	},
	{
		id: "survey-drone",
		name: "架空測量用飛行体の出発",
		keys: {
			sector: "区域 string north/south",
			inspected: "点検完了 boolean",
			distance: "航程 number m",
		},
		documents: [
			{
				id: "SD3",
				statement:
					"2026年12月1日00:00 UTC施行。north区域の出発の必要十分条件は点検完了かつ航程300 m以下。south区域には適用しない。",
				authority: "施設評議会の正式規程",
				published: "2026-12-01T00:00:00.000Z",
			},
			{
				id: "SD8",
				statement:
					"2026年12月1日00:00 UTC施行。south区域の出発の必要十分条件は点検完了かつ航程200 m以下。north区域には適用しない。",
				authority: "施設評議会の正式規程",
				published: "2026-12-01T00:00:00.000Z",
			},
			{
				id: "SD1",
				statement:
					"2026年12月24日05:45 UTCからnorth区域のSD3だけを撤回し置換する。north区域の出発の必要十分条件は点検完了かつ航程180 m以下。south区域のSD8は存続し、撤回の対象外。",
				authority: "施設評議会の正式規程",
				published: "2026-12-04T00:00:00.000Z",
			},
			{
				id: "SD6",
				statement:
					"意見募集の記録には「SD8も廃止して全区域で航程400 mまで許可するべきだ」との案がある。未承認の提案で、規程を変更する効力はない。",
				authority: "利用者の意見集計、制定権限なし",
				published: "2026-12-09T00:00:00.000Z",
			},
		],
	},
];
type Value = boolean | string | readonly [number, string];
function q(
	packet: string,
	id: string,
	iso: string,
	values: Record<string, Value>,
	decision: Decision,
	expectedAssessments: Record<string, Tri>,
	sources: string[],
	retiredOnlySources: string[],
	category: string,
	history = false,
): SourceQuestion {
	const asOf = time(iso);
	return {
		id,
		packet,
		asOf,
		question: `この状況で${packets.find((p) => p.id === packet)!.name}を許可できるか。${history ? "従来の扱いと今回の判断の関係も説明してください。" : "今回の判断と根拠を説明してください。"}`,
		observations: Object.entries(values).map(([k, v]) =>
			observation(k, v, asOf),
		),
		expected: { decision, governingSources: sources, reason: category },
		expectedAssessments,
		retiredOnlySources,
		category,
		suite: "unseen",
	};
}
export const unseenQuestions: SourceQuestion[] = [
	q(
		"night-projection",
		"NP01",
		"2026-12-22T18:29:59.999Z",
		{ registered: true, dark: false, curtain: true },
		"allow",
		{ NP4: "satisfied" },
		["NP4", "NP8"],
		[],
		"or-before-effect",
		true,
	),
	q(
		"night-projection",
		"NP02",
		"2026-12-22T18:30:00Z",
		{ registered: true, dark: false, curtain: true },
		"deny",
		{ NP1: "violated" },
		["NP1", "NP8"],
		["NP4"],
		"and-at-effect",
		true,
	),
	q(
		"night-projection",
		"NP03",
		"2026-12-22T18:30:00Z",
		{ registered: true, dark: true },
		"hold",
		{ NP1: "unknown" },
		["NP1", "NP8"],
		["NP4"],
		"and-missing",
		false,
	),
	q(
		"night-projection",
		"NP04",
		"2026-12-22T18:30:00Z",
		{ registered: false, dark: true },
		"deny",
		{ NP1: "violated" },
		["NP1", "NP8"],
		["NP4"],
		"false-and-missing",
		false,
	),
	q(
		"cargo-lift",
		"CL01",
		"2026-12-23T07:59:59.999Z",
		{ signed: true, mass: [800, "kg"] },
		"deny",
		{ CL2: "violated" },
		["CL2", "CL6"],
		[],
		"before-second-effect",
		true,
	),
	q(
		"cargo-lift",
		"CL02",
		"2026-12-23T08:00:00Z",
		{ signed: true, mass: [800, "kg"] },
		"allow",
		{ CL9: "satisfied" },
		["CL9", "CL6"],
		["CL2"],
		"exact-second-effect",
		true,
	),
	q(
		"cargo-lift",
		"CL03",
		"2026-12-24T08:00:00Z",
		{ signed: true },
		"hold",
		{ CL9: "unknown" },
		["CL9", "CL6"],
		["CL2"],
		"old-policy-current-unknown",
		false,
	),
	q(
		"cargo-lift",
		"CL04",
		"2026-12-24T08:00:00Z",
		{ signed: true, mass: [850, "kg"] },
		"allow",
		{ CL9: "satisfied" },
		["CL9", "CL6"],
		["CL2"],
		"old-policy-current-boundary",
		false,
	),
	q(
		"music-vault",
		"MV01",
		"2026-12-21T10:15:00Z",
		{ credential: true, humidity: [45, "percent"] },
		"allow",
		{ MV3: "satisfied" },
		["MV3", "MV9"],
		["MV7"],
		"new-policy-boundary",
		false,
	),
	q(
		"music-vault",
		"MV02",
		"2026-12-21T10:15:00Z",
		{ credential: true, humidity: [52, "percent"] },
		"deny",
		{ MV3: "violated" },
		["MV3", "MV9"],
		["MV7"],
		"history-not-applicable",
		true,
	),
	q(
		"music-vault",
		"MV03",
		"2026-12-21T10:15:00Z",
		{ credential: true },
		"hold",
		{ MV3: "unknown" },
		["MV3", "MV9"],
		["MV7"],
		"new-policy-missing",
		true,
	),
	q(
		"music-vault",
		"MV04",
		"2026-12-21T10:15:00Z",
		{ credential: false },
		"deny",
		{ MV3: "violated" },
		["MV3", "MV9"],
		["MV7"],
		"new-policy-false-and-missing",
		false,
	),
	q(
		"survey-drone",
		"SD01",
		"2026-12-24T05:44:59.999Z",
		{ sector: "north", inspected: true, distance: [250, "m"] },
		"allow",
		{ SD3: "satisfied" },
		["SD3"],
		[],
		"north-before-effect",
		true,
	),
	q(
		"survey-drone",
		"SD02",
		"2026-12-24T05:45:00Z",
		{ sector: "north", inspected: true, distance: [250, "m"] },
		"deny",
		{ SD1: "violated" },
		["SD1"],
		["SD3"],
		"north-at-effect",
		false,
	),
	q(
		"survey-drone",
		"SD03",
		"2026-12-25T05:45:00Z",
		{ sector: "south", inspected: true, distance: [230, "m"] },
		"deny",
		{ SD8: "violated" },
		["SD8"],
		["SD3"],
		"south-old-survives",
		true,
	),
	q(
		"survey-drone",
		"SD04",
		"2026-12-25T05:45:00Z",
		{ sector: "south", inspected: true },
		"hold",
		{ SD8: "unknown" },
		["SD8"],
		["SD3"],
		"south-old-unknown",
		false,
	),
];
export const questions = [
	...regressions.map((c) => c.question),
	...unseenQuestions,
];
