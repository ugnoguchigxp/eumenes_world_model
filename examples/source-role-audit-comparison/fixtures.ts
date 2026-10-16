import type { Tri } from "../../src/index.ts";
import type { Packet, Decision } from "../multi-source-comparison/fixtures.ts";
import type { AnswerContext } from "../multi-source-comparison/world.ts";
import { observation } from "../linked-answer-holdout/fixtures.ts";
import type { SourceQuestion } from "../operative-sources-comparison/fixtures.ts";
import saved from "./regressions.json";
export type { SourceQuestion };
export const VERSION = "source-role-audit-v1";
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
		id: "archive-shuttle",
		name: "架空保管庫シャトルの運転",
		keys: {
			zone: "区画 string dry/cold",
			ready: "点検済み boolean",
			mass: "積載質量 number kg",
		},
		documents: [
			{
				id: "AS6",
				statement:
					"2027年1月1日00:00 UTC施行。dry区画の運転の必要十分条件は点検済みかつ積載質量12 kg以下。cold区画には適用しない。",
				authority: "設備管理会の正式規程",
				published: "2026-12-20T00:00:00Z",
			},
			{
				id: "AS1",
				statement:
					"2027年1月1日00:00 UTC施行。cold区画の運転の必要十分条件は点検済みかつ積載質量7 kg以下。dry区画には適用しない。",
				authority: "設備管理会の正式規程",
				published: "2026-12-20T00:00:00Z",
			},
			{
				id: "AS9",
				statement:
					"2027年1月10日00:00 UTCからAS6だけを撤回して置き換える。dry区画の運転の必要十分条件は点検済みかつ積載質量8 kg以下。cold区画のAS1には一切変更を加えない。",
				authority: "設備管理会の正式規程",
				published: "2026-12-20T00:00:00Z",
			},
		],
	},
	{
		id: "harbor-cradle",
		name: "架空港湾架台の移動",
		keys: {
			mode: "運転方式 string manual/remote",
			secured: "固定済み boolean",
			wind: "風速 number m/s",
		},
		documents: [
			{
				id: "HC3",
				statement:
					"2027年1月1日00:00 UTC施行。manual方式での移動の必要十分条件は固定済みかつ風速6 m/s以下。remote方式は対象外。",
				authority: "設備管理会の正式規程",
				published: "2026-12-20T00:00:00Z",
			},
			{
				id: "HC8",
				statement:
					"2027年1月1日00:00 UTC施行。remote方式での移動の必要十分条件は固定済みかつ風速4 m/s以下。manual方式は対象外。HC3のmanual方式については変更しない。",
				authority: "設備管理会の正式規程",
				published: "2026-12-20T00:00:00Z",
			},
		],
	},
	{
		id: "ceramic-furnace",
		name: "架空陶材炉の開蓋",
		keys: {
			chamber: "炉室 string glaze/bisque",
			checked: "点検済み boolean",
			temperature: "温度 number C",
		},
		documents: [
			{
				id: "CF4",
				statement:
					"2027年1月1日00:00 UTC施行。第1章: glaze炉室の開蓋の必要十分条件は点検済みかつ温度90 C以下。bisque炉室には適用しない。第2章: glaze炉室の温度は校正した接触計で観測する。本章は許可規程ではなく観測方法である。",
				authority: "設備管理会の正式規程",
				published: "2026-12-20T00:00:00Z",
			},
			{
				id: "CF7",
				statement:
					"2027年1月10日00:00 UTCからCF4第1章だけを撤回して置換する。glaze炉室の開蓋の必要十分条件は点検済みかつ温度60 C以下。CF4第2章の観測方法は引き続き適用する。bisque炉室のCF2は変更しない。",
				authority: "設備管理会の正式規程",
				published: "2026-12-20T00:00:00Z",
			},
			{
				id: "CF2",
				statement:
					"2027年1月1日00:00 UTC施行。bisque炉室の開蓋の必要十分条件は点検済みかつ温度45 C以下。glaze炉室には適用しない。温度は校正した放射計で観測し、CF4第2章の接触計方法は適用しない。",
				authority: "設備管理会の正式規程",
				published: "2026-12-20T00:00:00Z",
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
		"archive-shuttle",
		"AS01",
		"2027-01-11T00:00:00Z",
		{ zone: "cold", ready: true },
		"hold",
		{ AS1: "unknown" },
		["AS1"],
		["AS6"],
		"other-scope-unknown",
		false,
	),
	q(
		"archive-shuttle",
		"AS02",
		"2027-01-11T00:00:00Z",
		{ zone: "cold", ready: true, mass: [8, "kg"] },
		"deny",
		{ AS1: "violated" },
		["AS1"],
		["AS6"],
		"operative-violation",
		true,
	),
	q(
		"archive-shuttle",
		"AS03",
		"2027-01-11T00:00:00Z",
		{ zone: "dry", ready: true, mass: [7, "kg"] },
		"allow",
		{ AS9: "satisfied" },
		["AS9"],
		["AS6"],
		"opposite-scope-allow",
		true,
	),
	q(
		"archive-shuttle",
		"AS04",
		"2027-01-11T00:00:00Z",
		{ zone: "dry", ready: true },
		"hold",
		{ AS9: "unknown" },
		["AS9"],
		["AS6"],
		"opposite-scope-unknown",
		false,
	),
	q(
		"harbor-cradle",
		"HC01",
		"2027-01-11T00:00:00Z",
		{ mode: "manual", secured: true, wind: [5, "m/s"] },
		"allow",
		{ HC3: "satisfied" },
		["HC3"],
		[],
		"method-scope-allow",
		true,
	),
	q(
		"harbor-cradle",
		"HC02",
		"2027-01-11T00:00:00Z",
		{ mode: "manual", secured: true },
		"hold",
		{ HC3: "unknown" },
		["HC3"],
		[],
		"method-scope-unknown",
		false,
	),
	q(
		"harbor-cradle",
		"HC03",
		"2027-01-11T00:00:00Z",
		{ mode: "remote", secured: true, wind: [5, "m/s"] },
		"deny",
		{ HC8: "violated" },
		["HC8"],
		[],
		"method-scope-deny",
		true,
	),
	q(
		"harbor-cradle",
		"HC04",
		"2027-01-11T00:00:00Z",
		{ mode: "remote", secured: true, wind: [4, "m/s"] },
		"allow",
		{ HC8: "satisfied" },
		["HC8"],
		[],
		"method-scope-boundary",
		false,
	),
	q(
		"ceramic-furnace",
		"CF01",
		"2027-01-11T00:00:00Z",
		{ chamber: "glaze", checked: true, temperature: [55, "C"] },
		"allow",
		{ CF7: "satisfied" },
		["CF4", "CF7"],
		[],
		"retained-observation",
		true,
	),
	q(
		"ceramic-furnace",
		"CF02",
		"2027-01-11T00:00:00Z",
		{ chamber: "glaze", checked: true },
		"hold",
		{ CF7: "unknown" },
		["CF4", "CF7"],
		[],
		"retained-observation-unknown",
		false,
	),
	q(
		"ceramic-furnace",
		"CF03",
		"2027-01-11T00:00:00Z",
		{ chamber: "bisque", checked: true, temperature: [50, "C"] },
		"deny",
		{ CF2: "violated" },
		["CF2"],
		[],
		"observation-out-of-scope",
		true,
	),
	q(
		"ceramic-furnace",
		"CF04",
		"2027-01-11T00:00:00Z",
		{ chamber: "bisque", checked: true },
		"hold",
		{ CF2: "unknown" },
		["CF2"],
		[],
		"observation-out-of-scope-unknown",
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
