import type { Tri } from "../../src/index.ts";
import type { Packet, Decision } from "../multi-source-comparison/fixtures.ts";
import type { AnswerContext } from "../multi-source-comparison/world.ts";
import { observation } from "../linked-answer-holdout/fixtures.ts";
import type { SourceQuestion } from "../operative-sources-comparison/fixtures.ts";
import saved from "./regressions.json";
export type { SourceQuestion };
export const VERSION = "audit-repair-v1";
export const regressions = saved.cases as unknown as {
	question: SourceQuestion;
	context: AnswerContext;
	seedRaw: string;
	origin: {
		experiment: string;
		questionId: string;
		repeat: number;
		arm: string;
	};
	expectedTrigger: boolean;
}[];
const time = (iso: string) => Date.parse(iso);
export const packets: Packet[] = [
	{
		id: "canopy-motor",
		name: "架空野外舞台の庇展開",
		keys: {
			interlock: "連動装置正常 boolean",
			wind: "風速 number m/s",
		},
		documents: [
			{
				id: "CM1",
				statement:
					"2026年12月1日00:00 UTC施行。庇展開の必要十分条件は連動装置正常かつ風速11 m/s以下。",
				authority: "設備審査会の正式規程",
				published: "2026-12-01T00:00:00.000Z",
			},
			{
				id: "CM5",
				statement:
					"公表は12月6日、効力の開始は2026年12月26日14:20:00 UTC。この時刻にCM1を撤回して置換する。庇展開の必要十分条件は連動装置正常かつ風速6 m/s以下。それより前はCM1が適用される。",
				authority: "設備審査会の正式規程",
				published: "2026-12-06T00:00:00.000Z",
			},
			{
				id: "CM9",
				statement:
					"運用履歴には旧上限11 m/sを使っていた経緯が記されている。この文書は許可条件を定めたり変更したりする権限を持たない。",
				authority: "舞台係の運用履歴",
				published: "2026-12-10T00:00:00.000Z",
			},
		],
	},
	{
		id: "freight-lock",
		name: "架空搬入口の解錠",
		keys: {
			sealed: "封印確認済み boolean",
			temperature: "温度 number C",
		},
		documents: [
			{
				id: "FL5",
				statement:
					"2026年12月1日00:00 UTC施行。許可章: 解錠の必要十分条件は封印確認済みかつ温度12 C以下。観測章: 判断時刻以前かつ1時間以内（境界を含む）の観測を採用する。同じ項目ではpriorityが最大の観測を使い、同順位の値が食い違う場合、期限超過、未来の観測、観測欠落は不明とする。観測方針自体は許可条件を加えない。",
				authority: "設備審査会の正式規程",
				published: "2026-12-01T00:00:00.000Z",
			},
			{
				id: "FL3",
				statement:
					"2026年12月21日07:10 UTC施行。同時刻からFL5の許可章を撤回・置換し、解錠の必要十分条件を封印確認済みかつ温度8 C以下とする。FL5の観測章はそのまま存続する。",
				authority: "設備審査会の正式規程",
				published: "2026-12-04T00:00:00.000Z",
			},
			{
				id: "FL9",
				statement:
					"点検記録は12月10日に旧上限12 Cの条件を使用したことを記している。現在の許可や観測方針を定める文書ではない。",
				authority: "点検係の記録",
				published: "2026-12-12T00:00:00.000Z",
			},
		],
	},
	{
		id: "sample-dispenser",
		name: "架空試料分配機の起動",
		keys: {
			approved: "承認済み boolean",
			clean: "清掃済み boolean",
			cartridge: "交換容器あり boolean",
		},
		documents: [
			{
				id: "SM4",
				statement:
					"2026年12月1日00:00 UTC施行。許可章: 起動の必要十分条件は承認済み、かつ清掃済みまたは交換容器ありの少なくとも一方が成り立つこと。観測章: 判断時刻以前かつ1時間以内（境界を含む）の観測を採用する。同じ項目ではpriorityが最大の観測を使い、同順位の値が食い違う場合、期限超過、未来の観測、観測欠落は不明とする。観測方針自体は許可条件を加えない。",
				authority: "設備審査会の正式規程",
				published: "2026-12-01T00:00:00.000Z",
			},
			{
				id: "SM2",
				statement:
					"2026年12月22日16:40 UTCからSM4を全文撤回する。旧観測章も存続しない。以後の起動の必要十分条件は承認済み、清掃済み、交換容器ありの全て。観測にはSM8を用いる。",
				authority: "設備審査会の正式規程",
				published: "2026-12-07T00:00:00.000Z",
			},
			{
				id: "SM8",
				statement:
					"2026年12月22日16:40 UTC施行。試料分配機の起動判断に使う観測方針。判断時刻以前かつ1時間以内（境界を含む）の観測を採用する。同じ項目ではpriorityが最大の観測を使い、同順位の値が食い違う場合、期限超過、未来の観測、観測欠落は不明とする。観測方針自体は許可条件を加えない。",
				authority: "設備審査会の正式規程",
				published: "2026-12-08T00:00:00.000Z",
			},
			{
				id: "SM6",
				statement:
					"旧手順の教材には、清掃か容器交換のどちらかを行った従来の例が掲載されている。現行の許可規程や観測方針を制定する文書ではない。",
				authority: "研修担当の旧手順教材",
				published: "2026-12-23T00:00:00.000Z",
			},
		],
	},
	{
		id: "orchard-sprayer",
		name: "架空散布機の運転開始",
		keys: {
			plot: "区画 string ridge/valley",
			checked: "確認済み boolean",
			flow: "流量 number L/min",
		},
		documents: [
			{
				id: "OS7",
				statement:
					"2026年12月1日00:00 UTC施行。ridge区画の運転開始の必要十分条件は確認済みかつ流量9 L/min以下。valleyには適用しない。",
				authority: "設備審査会の正式規程",
				published: "2026-12-01T00:00:00.000Z",
			},
			{
				id: "OS2",
				statement:
					"2026年12月1日00:00 UTC施行。valley区画の運転開始の必要十分条件は確認済みかつ流量7 L/min以下。ridgeには適用しない。",
				authority: "設備審査会の正式規程",
				published: "2026-12-01T00:00:00.000Z",
			},
			{
				id: "OS4",
				statement:
					"2026年12月27日09:25 UTCからridge区画のOS7のみを撤回して置換する。ridge区画の運転開始の必要十分条件は確認済みかつ流量5 L/min以下。valley区画のOS2は存続する。",
				authority: "設備審査会の正式規程",
				published: "2026-12-05T00:00:00.000Z",
			},
			{
				id: "OS9",
				statement:
					"意見集約には「全区画で上限を15 L/minにする」との未承認案がある。規程変更の権限も承認もなく、現在の運転条件を変更しない。",
				authority: "利用者の意見集約",
				published: "2026-12-10T00:00:00.000Z",
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
		"canopy-motor",
		"CM01",
		"2026-12-26T14:19:59.999Z",
		{ interlock: true, wind: [8, "m/s"] },
		"allow",
		{ CM1: "satisfied" },
		["CM1"],
		[],
		"before-effect",
		true,
	),
	q(
		"canopy-motor",
		"CM02",
		"2026-12-26T14:20:00Z",
		{ interlock: true, wind: [8, "m/s"] },
		"deny",
		{ CM5: "violated" },
		["CM5"],
		["CM1"],
		"at-effect",
		true,
	),
	q(
		"canopy-motor",
		"CM03",
		"2026-12-26T14:20:00Z",
		{ interlock: true },
		"hold",
		{ CM5: "unknown" },
		["CM5"],
		["CM1"],
		"missing-wind",
		false,
	),
	q(
		"canopy-motor",
		"CM04",
		"2026-12-26T14:20:00Z",
		{ interlock: false },
		"deny",
		{ CM5: "violated" },
		["CM5"],
		["CM1"],
		"false-and-unknown",
		false,
	),
	q(
		"freight-lock",
		"FL01",
		"2026-12-25T07:10:00Z",
		{ sealed: true, temperature: [8, "C"] },
		"allow",
		{ FL3: "satisfied" },
		["FL3", "FL5"],
		[],
		"retained-observation-boundary",
		false,
	),
	q(
		"freight-lock",
		"FL02",
		"2026-12-25T07:10:00Z",
		{ sealed: true, temperature: [10, "C"] },
		"deny",
		{ FL3: "violated" },
		["FL3", "FL5"],
		[],
		"retained-observation-deny",
		true,
	),
	q(
		"freight-lock",
		"FL03",
		"2026-12-25T07:10:00Z",
		{ sealed: true },
		"hold",
		{ FL3: "unknown" },
		["FL3", "FL5"],
		[],
		"retained-observation-unknown",
		true,
	),
	q(
		"freight-lock",
		"FL04",
		"2026-12-25T07:10:00Z",
		{ sealed: false },
		"deny",
		{ FL3: "violated" },
		["FL3", "FL5"],
		[],
		"retained-observation-false",
		false,
	),
	q(
		"sample-dispenser",
		"SM01",
		"2026-12-25T16:40:00Z",
		{ approved: true, clean: true, cartridge: true },
		"allow",
		{ SM2: "satisfied" },
		["SM2", "SM8"],
		["SM4"],
		"all-true",
		false,
	),
	q(
		"sample-dispenser",
		"SM02",
		"2026-12-25T16:40:00Z",
		{ approved: true, clean: false, cartridge: true },
		"deny",
		{ SM2: "violated" },
		["SM2", "SM8"],
		["SM4"],
		"old-or-new-and",
		true,
	),
	q(
		"sample-dispenser",
		"SM03",
		"2026-12-25T16:40:00Z",
		{ approved: true, clean: true },
		"hold",
		{ SM2: "unknown" },
		["SM2", "SM8"],
		["SM4"],
		"missing-cartridge",
		true,
	),
	q(
		"sample-dispenser",
		"SM04",
		"2026-12-25T16:40:00Z",
		{ approved: false, clean: true },
		"deny",
		{ SM2: "violated" },
		["SM2", "SM8"],
		["SM4"],
		"false-and-unknown",
		false,
	),
	q(
		"orchard-sprayer",
		"OS01",
		"2026-12-27T09:24:59.999Z",
		{ plot: "ridge", checked: true, flow: [6, "L/min"] },
		"allow",
		{ OS7: "satisfied" },
		["OS7"],
		[],
		"before-scope-replacement",
		true,
	),
	q(
		"orchard-sprayer",
		"OS02",
		"2026-12-27T09:25:00Z",
		{ plot: "ridge", checked: true, flow: [6, "L/min"] },
		"deny",
		{ OS4: "violated" },
		["OS4"],
		["OS7"],
		"at-scope-replacement",
		false,
	),
	q(
		"orchard-sprayer",
		"OS03",
		"2026-12-28T09:25:00Z",
		{ plot: "valley", checked: true, flow: [8, "L/min"] },
		"deny",
		{ OS2: "violated" },
		["OS2"],
		["OS7"],
		"other-scope-survives",
		true,
	),
	q(
		"orchard-sprayer",
		"OS04",
		"2026-12-28T09:25:00Z",
		{ plot: "valley", checked: true },
		"hold",
		{ OS2: "unknown" },
		["OS2"],
		["OS7"],
		"other-scope-unknown",
		false,
	),
];
export const questions = [
	...regressions.map((c) => c.question),
	...unseenQuestions,
];
