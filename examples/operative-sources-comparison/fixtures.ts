import type { Tri } from "../../src/index.ts";
import type { Packet, Decision } from "../multi-source-comparison/fixtures.ts";
import {
	observation,
	type HoldoutQuestion,
} from "../linked-answer-holdout/fixtures.ts";
import type { AnswerContext } from "../multi-source-comparison/world.ts";
import saved from "./regressions.json";
export const VERSION = "operative-sources-v1";
export interface SourceQuestion extends HoldoutQuestion {
	suite: "regression" | "unseen";
	retiredOnlySources: string[];
}
export const regressions = saved.cases as unknown as {
	question: SourceQuestion;
	context: AnswerContext;
}[];
const time = (day: number) => Date.UTC(2026, 11, day);
const doc = (id: string, statement: string, day = 1) => ({
	id,
	statement,
	authority: "管理委員会の正式決定",
	published: new Date(time(day)).toISOString(),
});
const measurement =
	"観測は基準時刻以前かつ1時間以内（境界含む）のものを使う。同一項目ではpriority最大を採用し、同順位で異なる値、古い値、未来の値、欠落は不明とする。これは観測方針で、操作の許可条件ではない。";
export const packets: Packet[] = [
	{
		id: "tide-gate",
		name: "架空水路の閘門操作",
		keys: {
			trained: "講習修了 boolean",
			depth: "水深 number m",
			blocked: "閉鎖指示あり boolean",
		},
		documents: [
			doc(
				"TG7",
				"2026年12月1日00:00 UTC施行。閘門操作の必要十分条件は講習修了、水深6 m以下、閉鎖指示がないこと。",
			),
			doc(
				"TG2",
				"2026年12月10日00:00 UTC施行。同時点でTG7を撤回・置換する。閘門操作の必要十分条件は講習修了、水深4 m以下、閉鎖指示がないこと。施行前はTG7を使用する。",
				3,
			),
			doc(
				"TG9",
				"2026年12月20日00:00 UTC施行。同時点でTG2を撤回・置換する。閘門操作の必要十分条件は講習修了、水深8 m以下、閉鎖指示がないこと。施行前にTG2を撤回するものではない。",
				6,
			),
		],
	},
	{
		id: "kiln-bay",
		name: "架空焼成室の起動",
		keys: {
			bay: "室 string east/west",
			ready: "点検済み boolean",
			temperature: "室温 number C",
		},
		documents: [
			doc(
				"KB4",
				"2026年12月1日施行。east室の起動の必要十分条件は点検済みかつ室温18 C以下。west室には適用しない。",
			),
			doc(
				"KB8",
				"2026年12月1日施行。west室の起動の必要十分条件は点検済みかつ室温12 C以下。east室には適用しない。",
			),
			doc(
				"KB6",
				"2026年12月1日施行。両室の起動判断に使う観測方針。" + measurement,
			),
			doc(
				"KB1",
				"2026年12月12日00:00 UTC施行。KB4を撤回し置換する。east室の起動の必要十分条件は点検済みかつ室温15 C以下。KB8とKB6は引き続き有効で、変更しない。",
				4,
			),
		],
	},
	{
		id: "ferry-lift",
		name: "架空貨物昇降機の使用",
		keys: { card: "認証カードあり boolean", quota: "割当枠 number slot" },
		documents: [
			doc(
				"FL3",
				"2026年12月1日施行。昇降機使用の必要十分条件は認証カードありかつ割当枠2 slot以上。",
			),
			doc(
				"FL5",
				"2026年12月8日施行。昇降機使用の必要十分条件は認証カードありかつ割当枠5 slot以上。FL3と同格で双方有効。撤回・置換・優先順位の指定はない。",
				5,
			),
		],
	},
	{
		id: "specimen-room",
		name: "架空標本室の開扉",
		keys: { badge: "入室証あり boolean", humidity: "湿度 number percent" },
		documents: [
			doc(
				"SP2",
				"2026年12月1日施行。許可章: 開扉の必要十分条件は入室証ありかつ湿度10 percent以下。観測章: " +
					measurement,
			),
			doc(
				"SP7",
				"2026年12月14日00:00 UTC施行。SP2の許可章だけを撤回・置換し、開扉の必要十分条件を入室証ありかつ湿度7 percent以下とする。SP2の観測章はそのまま有効で開扉判断に適用する。施行前はSP2の許可章を使う。",
				4,
			),
		],
	},
];
type Value = boolean | string | readonly [number, string];
function q(
	packet: string,
	id: string,
	day: number,
	values: Record<string, Value>,
	decision: Decision,
	expectedAssessments: Record<string, Tri>,
	sources: string[],
	retiredOnlySources: string[],
	category: string,
): SourceQuestion {
	const asOf = time(day);
	return {
		id,
		packet,
		asOf,
		question: `この状況で${packets.find((p) => p.id === packet)!.name}を許可できるか。`,
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
		"tide-gate",
		"TG01",
		9,
		{ trained: true, depth: [5, "m"], blocked: false },
		"allow",
		{ TG7: "satisfied" },
		["TG7"],
		[],
		"future-replacement-does-not-retire-yet",
	),
	q(
		"tide-gate",
		"TG02",
		10,
		{ trained: true, depth: [5, "m"], blocked: false },
		"deny",
		{ TG2: "violated" },
		["TG2"],
		["TG7"],
		"first-effective-boundary",
	),
	q(
		"tide-gate",
		"TG03",
		20,
		{ trained: true, depth: [5, "m"], blocked: false },
		"allow",
		{ TG9: "satisfied" },
		["TG9"],
		["TG7", "TG2"],
		"replacement-chain",
	),
	q(
		"tide-gate",
		"TG04",
		21,
		{ trained: true, blocked: false },
		"hold",
		{ TG9: "unknown" },
		["TG9"],
		["TG7", "TG2"],
		"chain-with-missing-input",
	),
	q(
		"kiln-bay",
		"KB01",
		11,
		{ bay: "east", ready: true, temperature: [17, "C"] },
		"allow",
		{ KB4: "satisfied" },
		["KB4", "KB6"],
		[],
		"before-effect-keep-old",
	),
	q(
		"kiln-bay",
		"KB02",
		12,
		{ bay: "east", ready: true, temperature: [17, "C"] },
		"deny",
		{ KB1: "violated" },
		["KB1", "KB6"],
		["KB4"],
		"after-effect-exclude-old",
	),
	q(
		"kiln-bay",
		"KB03",
		15,
		{ bay: "east", ready: true, temperature: [15, "C"] },
		"allow",
		{ KB1: "satisfied" },
		["KB1", "KB6"],
		["KB4"],
		"retained-observation-policy",
	),
	q(
		"kiln-bay",
		"KB04",
		15,
		{ bay: "west", ready: true, temperature: [14, "C"] },
		"deny",
		{ KB8: "violated" },
		["KB8", "KB6"],
		["KB4"],
		"other-scope-old-rule-still-active",
	),
	q(
		"ferry-lift",
		"FL01",
		19,
		{ card: true, quota: [3, "slot"] },
		"hold",
		{ FL3: "satisfied", FL5: "violated" },
		["FL3", "FL5"],
		[],
		"newer-is-not-override",
	),
	q(
		"ferry-lift",
		"FL02",
		19,
		{ card: true, quota: [5, "slot"] },
		"allow",
		{ FL3: "satisfied", FL5: "satisfied" },
		["FL3", "FL5"],
		[],
		"coexisting-rules-satisfied",
	),
	q(
		"ferry-lift",
		"FL03",
		19,
		{ card: false, quota: [5, "slot"] },
		"deny",
		{ FL3: "violated", FL5: "violated" },
		["FL3", "FL5"],
		[],
		"coexisting-rules-violated",
	),
	q(
		"ferry-lift",
		"FL04",
		19,
		{ card: true },
		"hold",
		{ FL3: "unknown", FL5: "unknown" },
		["FL3", "FL5"],
		[],
		"coexisting-rules-unknown",
	),
	q(
		"specimen-room",
		"SP01",
		13,
		{ badge: true, humidity: [8, "percent"] },
		"allow",
		{ SP2: "satisfied" },
		["SP2"],
		[],
		"mixed-before-effect",
	),
	q(
		"specimen-room",
		"SP02",
		14,
		{ badge: true, humidity: [8, "percent"] },
		"deny",
		{ SP7: "violated" },
		["SP7", "SP2"],
		[],
		"permission-ended-policy-retained",
	),
	q(
		"specimen-room",
		"SP03",
		17,
		{ badge: true },
		"hold",
		{ SP7: "unknown" },
		["SP7", "SP2"],
		[],
		"retained-policy-missing-observation",
	),
	q(
		"specimen-room",
		"SP04",
		17,
		{ badge: true, humidity: [7, "percent"] },
		"allow",
		{ SP7: "satisfied" },
		["SP7", "SP2"],
		[],
		"retained-policy-boundary",
	),
];
export const questions = [
	...regressions.map((c) => c.question),
	...unseenQuestions,
];
