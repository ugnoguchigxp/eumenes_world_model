import type { Tri } from "../../src/index.ts";
import type { Packet, Decision } from "../multi-source-comparison/fixtures.ts";
import type { AnswerContext } from "../multi-source-comparison/world.ts";
import { observation } from "../linked-answer-holdout/fixtures.ts";
import type { SourceQuestion } from "../operative-sources-comparison/fixtures.ts";
import saved from "./regressions.json";
export type { SourceQuestion };
export const VERSION = "applicability-order-v1";
export const regressions = saved.cases as unknown as {
	question: SourceQuestion;
	context: AnswerContext;
}[];
const time = (iso: string) => Date.parse(iso);
const doc = (
	id: string,
	statement: string,
	day = 1,
	authority = "運営評議会の正式規程",
) => ({
	id,
	statement,
	authority,
	published: new Date(Date.UTC(2026, 11, day)).toISOString(),
});
const measurement =
	"観測は基準時刻以前かつ1時間以内（境界含む）のものを使う。同一項目ではpriority最大を採用し、同順位で異なる値、古い値、未来の値、欠落は不明とする。観測方針は許可条件を追加しない。";
export const packets: Packet[] = [
	{
		id: "observatory-hatch",
		name: "架空観測塔の天蓋開放",
		keys: { trained: "講習修了 boolean", velocity: "風速 number m/s" },
		documents: [
			doc(
				"OH1",
				"2026年12月1日00:00 UTC施行。天蓋開放の必要十分条件は講習修了かつ風速9 m/s以下。",
			),
			doc(
				"OH7",
				"2026年12月10日12:00 UTC施行。同時にOH1を撤回し置換する。天蓋開放の必要十分条件は講習修了かつ風速5 m/s以下。施行時刻まではOH1が有効である。",
				2,
			),
			doc(
				"OH3",
				"2026年12月20日12:00 UTC施行。同時にOH7を撤回し置換する。天蓋開放の必要十分条件は講習修了かつ風速8 m/s以下。OH1を復活させるものではない。",
				4,
			),
			doc(
				"OH9",
				"審議記録には、風速上限を15 m/sとしてOH3を廃止する案が提出されたが未承認である、と記されている。この記録に規程変更の効力はない。",
				5,
				"事務局の審議経過記録。制定権限なし",
			),
		],
	},
	{
		id: "reservoir-valve",
		name: "架空貯水槽の弁操作",
		keys: { authorized: "操作証あり boolean", pressure: "圧力 number kPa" },
		documents: [
			doc(
				"RV6",
				"2026年12月1日00:00 UTC施行。許可章: 弁操作の必要十分条件は操作証ありかつ圧力14 kPa以下。観測章: " +
					measurement,
			),
			doc(
				"RV2",
				"2026年12月12日06:00 UTC施行。RV6の許可章だけを撤回し置換する。弁操作の必要十分条件は操作証ありかつ圧力10 kPa以下。RV6の観測章は引き続きこの判断に適用する。",
				3,
			),
			doc(
				"RV8",
				"点検記録には、12月5日に旧上限14 kPaで弁操作を実施したと記されている。現行の許可条件や観測方針を変更するものではない。",
				13,
				"点検担当者の過去作業記録",
			),
		],
	},
	{
		id: "ceramic-cabinet",
		name: "架空陶材保管庫の解錠",
		keys: { badge: "入庫証あり boolean", duration: "処理時間 number min" },
		documents: [
			doc(
				"CC5",
				"2026年12月1日00:00 UTC施行。許可章: 解錠の必要十分条件は入庫証ありかつ処理時間15 min以上。観測章: " +
					measurement,
			),
			doc(
				"CC2",
				"2026年12月14日09:00 UTC施行。CC5は許可章と観測章の両方を含め全文撤回する。解錠の必要十分条件は入庫証ありかつ処理時間20 min以上。観測には同時施行のCC9を適用する。",
				3,
			),
			doc(
				"CC9",
				"2026年12月14日09:00 UTC施行。保管庫の解錠判断に適用する観測方針。" +
					measurement,
				4,
			),
			doc(
				"CC4",
				"保管庫の沿革資料には、12月1日から旧規程CC5に基づき15 minを下限として扱ったと記録されている。この沿革資料は現在の許可や観測方法を定めない。",
				15,
				"記録係の沿革資料",
			),
		],
	},
	{
		id: "canal-berth",
		name: "架空運河の係留開始",
		keys: {
			basin: "水域 string upper/lower",
			inspected: "点検済み boolean",
			clearance: "余裕高 number cm",
		},
		documents: [
			doc(
				"CB3",
				"2026年12月1日00:00 UTC施行。upper水域の係留開始の必要十分条件は点検済みかつ余裕高8 cm以上。lower水域には適用しない。",
			),
			doc(
				"CB8",
				"2026年12月1日00:00 UTC施行。lower水域の係留開始の必要十分条件は点検済みかつ余裕高10 cm以上。upper水域には適用しない。",
			),
			doc(
				"CB1",
				"2026年12月16日15:00 UTC施行。同時にupper水域のCB3を撤回して置換する。upper水域の係留開始の必要十分条件は点検済みかつ余裕高5 cm以上。lower水域のCB8は改訂対象外で存続する。",
				3,
			),
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
		"observatory-hatch",
		"OH01",
		"2026-12-10T11:59:59.999Z",
		{ trained: true, velocity: [7, "m/s"] },
		"allow",
		{ OH1: "satisfied" },
		["OH1"],
		[],
		"one-ms-before-first-effect",
	),
	q(
		"observatory-hatch",
		"OH02",
		"2026-12-10T12:00:00Z",
		{ trained: true, velocity: [7, "m/s"] },
		"deny",
		{ OH7: "violated" },
		["OH7"],
		["OH1"],
		"exact-first-effect",
		true,
	),
	q(
		"observatory-hatch",
		"OH03",
		"2026-12-20T11:59:59.999Z",
		{ trained: true, velocity: [7, "m/s"] },
		"deny",
		{ OH7: "violated" },
		["OH7"],
		["OH1"],
		"one-ms-before-second-effect",
	),
	q(
		"observatory-hatch",
		"OH04",
		"2026-12-20T12:00:00Z",
		{ trained: true, velocity: [7, "m/s"] },
		"allow",
		{ OH3: "satisfied" },
		["OH3"],
		["OH1", "OH7"],
		"exact-second-effect",
		true,
	),
	q(
		"reservoir-valve",
		"RV01",
		"2026-12-16T06:00:00Z",
		{ authorized: true, pressure: [10, "kPa"] },
		"allow",
		{ RV2: "satisfied" },
		["RV2", "RV6"],
		[],
		"retained-policy-boundary",
	),
	q(
		"reservoir-valve",
		"RV02",
		"2026-12-16T06:00:00Z",
		{ authorized: true, pressure: [11, "kPa"] },
		"deny",
		{ RV2: "violated" },
		["RV2", "RV6"],
		[],
		"retained-policy-deny",
		true,
	),
	q(
		"reservoir-valve",
		"RV03",
		"2026-12-16T06:00:00Z",
		{ authorized: true },
		"hold",
		{ RV2: "unknown" },
		["RV2", "RV6"],
		[],
		"retained-policy-unknown",
		true,
	),
	q(
		"reservoir-valve",
		"RV04",
		"2026-12-16T06:00:00Z",
		{ authorized: false },
		"deny",
		{ RV2: "violated" },
		["RV2", "RV6"],
		[],
		"false-and-missing",
	),
	q(
		"ceramic-cabinet",
		"CC01",
		"2026-12-17T09:00:00Z",
		{ badge: true, duration: [20, "min"] },
		"allow",
		{ CC2: "satisfied" },
		["CC2", "CC9"],
		["CC5"],
		"both-chapters-ended-boundary",
	),
	q(
		"ceramic-cabinet",
		"CC02",
		"2026-12-17T09:00:00Z",
		{ badge: true, duration: [18, "min"] },
		"deny",
		{ CC2: "violated" },
		["CC2", "CC9"],
		["CC5"],
		"both-chapters-ended-deny",
		true,
	),
	q(
		"ceramic-cabinet",
		"CC03",
		"2026-12-17T09:00:00Z",
		{ badge: true },
		"hold",
		{ CC2: "unknown" },
		["CC2", "CC9"],
		["CC5"],
		"both-chapters-ended-unknown",
		true,
	),
	q(
		"ceramic-cabinet",
		"CC04",
		"2026-12-17T09:00:00Z",
		{ badge: false },
		"deny",
		{ CC2: "violated" },
		["CC2", "CC9"],
		["CC5"],
		"replacement-policy-false-and-missing",
	),
	q(
		"canal-berth",
		"CB01",
		"2026-12-16T14:59:59.999Z",
		{ basin: "upper", inspected: true, clearance: [6, "cm"] },
		"deny",
		{ CB3: "violated" },
		["CB3"],
		[],
		"before-easing-effect",
		true,
	),
	q(
		"canal-berth",
		"CB02",
		"2026-12-16T15:00:00Z",
		{ basin: "upper", inspected: true, clearance: [6, "cm"] },
		"allow",
		{ CB1: "satisfied" },
		["CB1"],
		["CB3"],
		"exact-easing-effect",
	),
	q(
		"canal-berth",
		"CB03",
		"2026-12-17T15:00:00Z",
		{ basin: "lower", inspected: true, clearance: [9, "cm"] },
		"deny",
		{ CB8: "violated" },
		["CB8"],
		["CB3"],
		"other-scope-old-survives",
		true,
	),
	q(
		"canal-berth",
		"CB04",
		"2026-12-17T15:00:00Z",
		{ basin: "upper", inspected: true },
		"hold",
		{ CB1: "unknown" },
		["CB1"],
		["CB3"],
		"current-permission-unknown",
	),
];
export const questions = [
	...regressions.map((c) => c.question),
	...unseenQuestions,
];
export const targetControls = [
	"PC01",
	"CV04",
	...unseenQuestions.map((q) => q.id),
];
