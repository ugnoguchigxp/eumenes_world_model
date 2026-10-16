import type { Tri } from "../../src/index.ts";
import type { Packet, Decision } from "../multi-source-comparison/fixtures.ts";
import type { AnswerContext } from "../multi-source-comparison/world.ts";
import { observation } from "../linked-answer-holdout/fixtures.ts";
import type { SourceQuestion } from "../operative-sources-comparison/fixtures.ts";
import saved from "./regressions.json";
export type { SourceQuestion };
export const VERSION = "source-review-v1";
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
	expectedCorrect: boolean;
}[];
const time = (iso: string) => Date.parse(iso);
export const packets: Packet[] = [
	{
		id: "tidal-crane",
		name: "架空潮汐クレーンの稼働",
		keys: {
			unlocked: "固定解除済み boolean",
			load: "積載量 number t",
		},
		documents: [
			{
				id: "TC6",
				statement:
					"2026年12月1日00:00 UTC施行。稼働の必要十分条件は固定解除済みかつ積載量13 t以下。",
				authority: "設備評議会の正式規程",
				published: "2026-11-28T00:00:00Z",
			},
			{
				id: "TC2",
				statement:
					"公表は12月3日。2026年12月29日05:45 UTCにTC6を撤回・置換する。同時刻以降、稼働の必要十分条件は固定解除済みかつ積載量8 t以下。それより前はTC6が有効。",
				authority: "設備評議会の正式規程",
				published: "2026-12-03T00:00:00Z",
			},
			{
				id: "TC8",
				statement:
					"12月12日の参考メモには「新規程は公表済みなので今後は8 tを用いる」とある。これは担当者の見解であり、施行時刻を変更する決定ではない。",
				authority: "運用係の参考記録（規程を制定・変更する権限なし）",
				published: "2026-12-12T00:00:00Z",
			},
		],
	},
	{
		id: "archive-carriage",
		name: "架空収蔵搬送台の発進",
		keys: {
			closed: "収納扉閉鎖 boolean",
			pressure: "圧力 number kPa",
		},
		documents: [
			{
				id: "AC7",
				statement:
					"2026年12月1日00:00 UTC施行。許可章: 発進の必要十分条件は収納扉閉鎖かつ圧力9 kPa以下。観測章: 判断時刻以前かつ1時間以内（境界を含む）の観測を使う。同じ項目ではpriority最大を採用し、同順位の値が不一致、未来、期限超過、欠落は不明とする。観測方針自体は許可条件を追加しない。",
				authority: "設備評議会の正式規程",
				published: "2026-11-29T00:00:00Z",
			},
			{
				id: "AC2",
				statement:
					"2026年12月28日19:35 UTC施行。同時刻にAC7の許可章だけを撤回・置換する。発進の必要十分条件は収納扉閉鎖かつ圧力6 kPa以下。AC7の観測章は今後も有効。",
				authority: "設備評議会の正式規程",
				published: "2026-12-02T00:00:00Z",
			},
			{
				id: "AC4",
				statement:
					"旧操作実績として収納扉閉鎖、圧力8 kPaで発進した例を掲載する。実績は現在の許可条件や観測の正本を定めない。",
				authority: "運用係の参考記録（規程を制定・変更する権限なし）",
				published: "2026-12-29T00:00:00Z",
			},
		],
	},
	{
		id: "kiln-cart",
		name: "架空炉内台車の移動",
		keys: {
			zone: "区画 string upper/lower",
			clear: "通路確認済み boolean",
			mass: "質量 number kg",
		},
		documents: [
			{
				id: "KC5",
				statement:
					"2026年12月1日00:00 UTC施行。upper区画の移動の必要十分条件は通路確認済みかつ質量10 kg以下。lowerには適用しない。",
				authority: "設備評議会の正式規程",
				published: "2026-11-27T00:00:00Z",
			},
			{
				id: "KC8",
				statement:
					"2026年12月1日00:00 UTC施行。lower区画の移動の必要十分条件は通路確認済みかつ質量5 kg以下。upperには適用しない。",
				authority: "設備評議会の正式規程",
				published: "2026-11-28T00:00:00Z",
			},
			{
				id: "KC1",
				statement:
					"2026年12月30日11:15 UTCからKC5だけを撤回・置換する。upper区画の移動の必要十分条件は通路確認済みかつ質量7 kg以下。lowerのKC8は変更しない。",
				authority: "設備評議会の正式規程",
				published: "2026-12-05T00:00:00Z",
			},
			{
				id: "KC9",
				statement:
					"全区画の上限を20 kgに統一する提案。未承認で施行時刻はなく、現行の許可条件を変更しない。",
				authority: "運用係の参考記録（規程を制定・変更する権限なし）",
				published: "2026-12-31T00:00:00Z",
			},
		],
	},
	{
		id: "cistern-valve",
		name: "架空貯槽弁の開放",
		keys: {
			verified: "確認済み boolean",
			level: "液面高 number cm",
		},
		documents: [
			{
				id: "RV6",
				statement:
					"2026年12月1日00:00 UTC施行。開放の必要十分条件は確認済みかつ液面高11 cm以下。",
				authority: "設備評議会の正式規程",
				published: "2026-11-26T00:00:00Z",
			},
			{
				id: "RV3",
				statement:
					"2026年12月20日06:20 UTC施行。開放の必要十分条件は確認済みかつ液面高7 cm以下。RV6を撤回・置換する決定は含まれず、RV6と本規程は同じ権限の並存規程として残る。両規程で評価が食い違う場合は未解決の不一致として扱う。",
				authority: "設備評議会の正式規程",
				published: "2026-12-04T00:00:00Z",
			},
			{
				id: "RV8",
				statement:
					"2026年12月1日00:00 UTC施行。開放判断の観測方針。判断時刻以前かつ1時間以内（境界を含む）の観測を使う。同じ項目ではpriority最大を採用し、同順位の値が不一致、未来、期限超過、欠落は不明とする。観測方針自体は許可条件を追加しない。",
				authority: "設備評議会の正式規程",
				published: "2026-11-28T00:00:00Z",
			},
			{
				id: "RV1",
				statement:
					"担当者の提案では「日付の新しいRV3を優先し、RV6は無視すればよい」とする。規程の優先順位を決めたり旧規程を撤回したりする権限も承認もない。",
				authority: "運用係の参考記録（規程を制定・変更する権限なし）",
				published: "2026-12-23T00:00:00Z",
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
		"tidal-crane",
		"TC01",
		"2026-12-29T05:44:59.999Z",
		{ unlocked: true, load: [10, "t"] },
		"allow",
		{ TC6: "satisfied" },
		["TC6"],
		[],
		"before-effect",
		true,
	),
	q(
		"tidal-crane",
		"TC02",
		"2026-12-29T05:45:00Z",
		{ unlocked: true, load: [10, "t"] },
		"deny",
		{ TC2: "violated" },
		["TC2"],
		["TC6"],
		"at-effect",
		true,
	),
	q(
		"tidal-crane",
		"TC03",
		"2026-12-29T05:44:59.999Z",
		{ unlocked: true },
		"hold",
		{ TC6: "unknown" },
		["TC6"],
		[],
		"before-effect-unknown",
		false,
	),
	q(
		"tidal-crane",
		"TC04",
		"2026-12-30T05:45:00Z",
		{ unlocked: false },
		"deny",
		{ TC2: "violated" },
		["TC2"],
		["TC6"],
		"false-and-unknown",
		false,
	),
	q(
		"archive-carriage",
		"AC01",
		"2026-12-28T19:34:59.999Z",
		{ closed: true, pressure: [8, "kPa"] },
		"allow",
		{ AC7: "satisfied" },
		["AC7"],
		[],
		"before-partial-replacement",
		true,
	),
	q(
		"archive-carriage",
		"AC02",
		"2026-12-28T19:35:00Z",
		{ closed: true, pressure: [8, "kPa"] },
		"deny",
		{ AC2: "violated" },
		["AC2", "AC7"],
		[],
		"retained-observation-chapter",
		true,
	),
	q(
		"archive-carriage",
		"AC03",
		"2026-12-30T19:35:00Z",
		{ closed: true },
		"hold",
		{ AC2: "unknown" },
		["AC2", "AC7"],
		[],
		"retained-observation-unknown",
		false,
	),
	q(
		"archive-carriage",
		"AC04",
		"2026-12-30T19:35:00Z",
		{ closed: true, pressure: [6, "kPa"] },
		"allow",
		{ AC2: "satisfied" },
		["AC2", "AC7"],
		[],
		"retained-observation-boundary",
		false,
	),
	q(
		"kiln-cart",
		"KC01",
		"2026-12-30T11:14:59.999Z",
		{ zone: "upper", clear: true, mass: [8, "kg"] },
		"allow",
		{ KC5: "satisfied" },
		["KC5"],
		[],
		"before-scoped-replacement",
		true,
	),
	q(
		"kiln-cart",
		"KC02",
		"2026-12-30T11:15:00Z",
		{ zone: "upper", clear: true, mass: [8, "kg"] },
		"deny",
		{ KC1: "violated" },
		["KC1"],
		["KC5"],
		"at-scoped-replacement",
		false,
	),
	q(
		"kiln-cart",
		"KC03",
		"2026-12-31T11:15:00Z",
		{ zone: "lower", clear: true, mass: [6, "kg"] },
		"deny",
		{ KC8: "violated" },
		["KC8"],
		["KC5"],
		"other-scope-survives",
		true,
	),
	q(
		"kiln-cart",
		"KC04",
		"2026-12-31T11:15:00Z",
		{ zone: "lower", clear: true },
		"hold",
		{ KC8: "unknown" },
		["KC8"],
		["KC5"],
		"other-scope-unknown",
		false,
	),
	q(
		"cistern-valve",
		"RV01",
		"2026-12-19T06:20:00Z",
		{ verified: true, level: [9, "cm"] },
		"allow",
		{ RV6: "satisfied" },
		["RV6", "RV8"],
		[],
		"before-concurrent-rule",
		true,
	),
	q(
		"cistern-valve",
		"RV02",
		"2026-12-20T06:20:00Z",
		{ verified: true, level: [9, "cm"] },
		"hold",
		{ RV6: "satisfied", RV3: "violated" },
		["RV6", "RV3", "RV8"],
		[],
		"conflicting-results",
		true,
	),
	q(
		"cistern-valve",
		"RV03",
		"2026-12-25T06:20:00Z",
		{ verified: true, level: [6, "cm"] },
		"allow",
		{ RV6: "satisfied", RV3: "satisfied" },
		["RV6", "RV3", "RV8"],
		[],
		"concurrent-both-satisfied",
		false,
	),
	q(
		"cistern-valve",
		"RV04",
		"2026-12-25T06:20:00Z",
		{ verified: false },
		"deny",
		{ RV6: "violated", RV3: "violated" },
		["RV6", "RV3", "RV8"],
		[],
		"concurrent-both-violated",
		false,
	),
];
export const questions = [
	...regressions.map((c) => c.question),
	...unseenQuestions,
];

/** Experiment identities are IO contracts, not policy-selection rules. */
export function validateFixtureIdentity(
	packetIds: readonly string[],
	qs: readonly SourceQuestion[],
	historical: readonly SourceQuestion[],
) {
	if (
		new Set(packetIds).size !== packetIds.length ||
		new Set(qs.map((q) => q.id)).size !== qs.length
	)
		throw new Error("duplicate_experiment_identity");
	if (historical.some((q) => packetIds.includes(q.packet)))
		throw new Error("historical_packet_collision");
	if (
		qs
			.filter((q) => q.suite === "unseen")
			.some((q) => !packetIds.includes(q.packet))
	)
		throw new Error("unknown_unseen_packet");
}
validateFixtureIdentity(
	packets.map((p) => p.id),
	questions,
	regressions.map((r) => r.question),
);
