import type { Tri } from "../../src/index.ts";
import type { Packet, Decision } from "../multi-source-comparison/fixtures.ts";
import type { AnswerContext } from "../multi-source-comparison/world.ts";
import { observation } from "../linked-answer-holdout/fixtures.ts";
import type { SourceQuestion } from "../operative-sources-comparison/fixtures.ts";
import saved from "./regressions.json";
export type { SourceQuestion };
export const VERSION = "validity-audit-v1";
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
	expectedInvalid: boolean;
}[];
const time = (iso: string) => Date.parse(iso);
export const packets: Packet[] = [
	{
		id: "beacon-winch",
		name: "架空標識ウインチの巻上げ",
		keys: {
			unlatched: "係止解除済み boolean",
			weight: "吊荷質量 number kg",
		},
		documents: [
			{
				id: "BW4",
				statement:
					"2026年12月1日00:00 UTC施行。巻上げの必要十分条件は係止解除済みかつ吊荷質量16 kg以下。",
				authority: "設備管理会の正式規程",
				published: "2026-11-28T00:00:00Z",
			},
			{
				id: "BW2",
				statement:
					"公表は12月6日。2026年12月28日08:35 UTCにBW4を撤回して置き換える。同時刻以降、巻上げの必要十分条件は係止解除済みかつ吊荷質量10 kg以下。それまではBW4が有効。",
				authority: "設備管理会の正式規程",
				published: "2026-12-06T00:00:00Z",
			},
		],
	},
	{
		id: "filtration-hatch",
		name: "架空濾過槽ハッチの開放",
		keys: {
			checked: "確認済み boolean",
			pressure: "圧力 number kPa",
		},
		documents: [
			{
				id: "FH7",
				statement:
					"有効期間は2026年12月1日00:00 UTC以上、2026年12月27日02:10 UTC未満。期限の終了時刻自体は含まない。この期間の開放の必要十分条件は確認済みかつ圧力14 kPa以下。",
				authority: "設備管理会の正式規程",
				published: "2026-11-27T00:00:00Z",
			},
			{
				id: "FH3",
				statement:
					"2026年12月27日02:10 UTCから有効。この時刻以降の開放の必要十分条件は確認済みかつ圧力8 kPa以下。FH7は元から定められた期限により終了する。本書に別の撤回決定はない。",
				authority: "設備管理会の正式規程",
				published: "2026-12-05T00:00:00Z",
			},
		],
	},
	{
		id: "depot-turntable",
		name: "架空車庫転車台の起動",
		keys: {
			side: "区画 string east/west",
			locked: "固定確認済み boolean",
			speed: "速度 number m/s",
		},
		documents: [
			{
				id: "DT5",
				statement:
					"2026年12月1日00:00 UTC施行。east区画の起動の必要十分条件は固定確認済みかつ速度6 m/s以下。west区画には適用しない。",
				authority: "設備管理会の正式規程",
				published: "2026-11-25T00:00:00Z",
			},
			{
				id: "DT8",
				statement:
					"2026年12月1日00:00 UTC施行。west区画の起動の必要十分条件は固定確認済みかつ速度9 m/s以下。east区画には適用しない。",
				authority: "設備管理会の正式規程",
				published: "2026-11-26T00:00:00Z",
			},
			{
				id: "DT2",
				statement:
					"2026年12月30日23:59:59.500 UTCにDT5だけを撤回して置換する。east区画の起動の必要十分条件は固定確認済みかつ速度4 m/s以下。west区画のDT8は変更しない。",
				authority: "設備管理会の正式規程",
				published: "2026-12-04T00:00:00Z",
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
		"beacon-winch",
		"BW01",
		"2026-12-28T08:34:59.999Z",
		{ unlatched: true, weight: [13, "kg"] },
		"allow",
		{ BW4: "satisfied" },
		["BW4"],
		[],
		"before-effect",
		true,
	),
	q(
		"beacon-winch",
		"BW02",
		"2026-12-28T08:35:00Z",
		{ unlatched: true, weight: [13, "kg"] },
		"deny",
		{ BW2: "violated" },
		["BW2"],
		["BW4"],
		"at-effect",
		true,
	),
	q(
		"beacon-winch",
		"BW03",
		"2026-12-28T08:34:59.999Z",
		{ unlatched: true },
		"hold",
		{ BW4: "unknown" },
		["BW4"],
		[],
		"before-effect-unknown",
		false,
	),
	q(
		"beacon-winch",
		"BW04",
		"2026-12-28T08:35:00Z",
		{ unlatched: false },
		"deny",
		{ BW2: "violated" },
		["BW2"],
		["BW4"],
		"legitimate-violation",
		false,
	),
	q(
		"filtration-hatch",
		"FH01",
		"2026-12-27T02:09:59.999Z",
		{ checked: true, pressure: [11, "kPa"] },
		"allow",
		{ FH7: "satisfied" },
		["FH7"],
		[],
		"before-expiry",
		true,
	),
	q(
		"filtration-hatch",
		"FH02",
		"2026-12-27T02:10:00Z",
		{ checked: true, pressure: [11, "kPa"] },
		"deny",
		{ FH3: "violated" },
		["FH3"],
		["FH7"],
		"at-expiry",
		true,
	),
	q(
		"filtration-hatch",
		"FH03",
		"2026-12-27T02:10:00.001Z",
		{ checked: true },
		"hold",
		{ FH3: "unknown" },
		["FH3"],
		["FH7"],
		"after-expiry-unknown",
		false,
	),
	q(
		"filtration-hatch",
		"FH04",
		"2026-12-27T02:10:00.001Z",
		{ checked: true, pressure: [8, "kPa"] },
		"allow",
		{ FH3: "satisfied" },
		["FH3"],
		["FH7"],
		"after-expiry-boundary",
		false,
	),
	q(
		"depot-turntable",
		"DT01",
		"2026-12-30T23:59:59.499Z",
		{ side: "east", locked: true, speed: [5, "m/s"] },
		"allow",
		{ DT5: "satisfied" },
		["DT5"],
		[],
		"before-millisecond-effect",
		true,
	),
	q(
		"depot-turntable",
		"DT02",
		"2026-12-30T23:59:59.500Z",
		{ side: "east", locked: true, speed: [5, "m/s"] },
		"deny",
		{ DT2: "violated" },
		["DT2"],
		["DT5"],
		"at-millisecond-effect",
		false,
	),
	q(
		"depot-turntable",
		"DT03",
		"2026-12-31T00:00:00Z",
		{ side: "west", locked: true, speed: [10, "m/s"] },
		"deny",
		{ DT8: "violated" },
		["DT8"],
		["DT5"],
		"other-scope",
		true,
	),
	q(
		"depot-turntable",
		"DT04",
		"2026-12-31T00:00:00Z",
		{ side: "west", locked: true },
		"hold",
		{ DT8: "unknown" },
		["DT8"],
		["DT5"],
		"other-scope-unknown",
		false,
	),
];
export const questions = [
	...regressions.map((c) => c.question),
	...unseenQuestions,
];
import { validateFixtureIdentity } from "../source-review-comparison/fixtures.ts";
validateFixtureIdentity(
	packets.map((p) => p.id),
	questions,
	regressions.map((r) => r.question),
);
