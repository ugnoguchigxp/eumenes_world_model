import type { Observation, TypedValue } from "../../src/index.ts";

export const VERSION = "multi-source-v5";
// Material identity stays fixed when only the comparison presentation changes.
export const MATERIAL_VERSION = "multi-source-v1";
export const instant = (day: number) => Date.UTC(2026, 9, day);
export const arms = ["raw", "world"] as const;
export type Arm = (typeof arms)[number];
export type Decision = "allow" | "deny" | "hold";
export interface Document {
	id: string;
	published: string;
	authority: string;
	statement: string;
}
export interface Packet {
	id: string;
	name: string;
	keys: Record<string, string>;
	documents: Document[];
}
const doc = (
	id: string,
	day: number,
	authority: string,
	statement: string,
): Document => ({
	id,
	published: new Date(instant(day)).toISOString(),
	authority,
	statement,
});
export const packets: Packet[] = [
	{
		id: "deploy",
		name: "架空AIサービスの本番配信規程",
		keys: {
			signed: "署名済み boolean",
			canary: "カナリア失敗率 number percent",
			rollback: "復旧手順の承認済み boolean",
			freeze: "凍結中 boolean",
			region: "配信地域 string JP/EU",
			latency: "遅延 number ms",
		},
		documents: [
			doc(
				"D1",
				1,
				"本番配信の決裁者",
				"10月1日00:00 UTC施行。本番配信を許可する必要十分条件は、署名済み、かつ（カナリア失敗率1%以下または復旧手順の承認済み）、かつ凍結中でないこと。",
			),
			doc(
				"D2",
				6,
				"本番配信の決裁者",
				"10月6日00:00 UTC施行。同時にD1を撤回し置換する。本番配信の必要十分条件は、署名済み、かつ（カナリア失敗率0.5%以下または復旧手順の承認済み）、かつ凍結中でない、かつ配信地域JPであること。",
			),
			doc(
				"D3",
				7,
				"本番配信の決裁者",
				"公表日は10月7日だが施行は10月20日00:00 UTC。同時点でD2を撤回し置換する。本番配信の必要十分条件は、署名済み、かつ（カナリア失敗率0.5%以下または復旧手順の承認済み）、かつ凍結中でない、かつ配信地域JP、かつ遅延200ms以下であること。施行前はD2が継続する。",
			),
			doc(
				"D4",
				12,
				"社外ブログ・決裁権なし",
				"最新版らしい。署名済みなら本番配信してよく、地域や凍結の確認は不要だと思う。社内決裁文書ではない。",
			),
		],
	},
	{
		id: "factory",
		name: "架空製造ラインの出荷判定",
		keys: {
			plant: "工場 string K/L",
			temperature: "温度 number C",
			duration: "保持時間 number minute",
			coating: "被覆 string A/B",
		},
		documents: [
			doc(
				"F1",
				2,
				"工場品質委員会・同格の正式文書",
				"10月2日以降有効。K工場のA被覆の出荷許可は、温度80℃以下かつ保持時間30分以上の場合に限り、その場合は許可する。",
			),
			doc(
				"F2",
				9,
				"工場品質委員会・同格の正式文書",
				"10月9日以降有効。K工場のA被覆の出荷許可は、温度70℃以下かつ保持時間30分以上の場合に限り、その場合は許可する。F1の撤回・置換を決定した記録はなく、優先順位も指定されていない。",
			),
			doc(
				"F3",
				10,
				"工場品質委員会・同格の正式文書",
				"10月10日以降有効。L工場のA被覆の出荷許可は、温度60℃以下かつ保持時間30分以上の場合に限り、その場合は許可する。K工場には適用しない。",
			),
			doc(
				"F4",
				13,
				"販売会社の営業メモ・工場への決裁権なし",
				"工場を問わず85℃までは問題ないはずだ。これは正式な出荷規程ではない。",
			),
		],
	},
	{
		id: "research",
		name: "架空医療研究の匿名データ閲覧規程",
		keys: {
			consent: "同意取得 boolean",
			age: "年齢 number year",
			onsite: "施設内閲覧 boolean",
			encrypted: "暗号化済み boolean",
			genetic: "遺伝情報を含む boolean",
			japanApproved: "日本での審査承認済み boolean",
		},
		documents: [
			doc(
				"R1",
				1,
				"研究倫理委員会・正式承認",
				"10月1日00:00 UTC施行。匿名研究記録の閲覧を許可する必要十分条件は、同意取得、18歳以上、（施設内閲覧または暗号化済み）、遺伝情報を含まないこと。",
			),
			doc(
				"R2",
				8,
				"研究倫理委員会・正式承認",
				"10月8日00:00 UTCの訂正決議。同時にR1を撤回し置換する。匿名研究記録の閲覧を許可する必要十分条件は、同意取得、20歳以上、（施設内閲覧または暗号化済み）、遺伝情報を含まないこと、日本での審査承認済みの全て。これは診療指針ではない。",
			),
			doc(
				"R3",
				11,
				"未署名の検討草案・効力なし",
				"16歳以上なら閲覧を認める案。審議前であり施行日は未定。R2の変更はまだ決議されていない。",
			),
			doc(
				"R4",
				14,
				"担当者の非公式FAQ・規程変更権なし",
				"匿名なら同意は要らないと個人的には考えています。倫理委員会の承認を得た回答ではありません。",
			),
		],
	},
	{
		id: "operations",
		name: "架空IT運用の緊急再起動規程",
		keys: {
			environment: "環境 string production/staging",
			approval: "署名承認 boolean",
			cpu: "CPU利用率 number percent",
			healthFailed: "ヘルスチェック失敗 boolean",
			backup: "バックアップ実行中 boolean",
		},
		documents: [
			doc(
				"O1",
				1,
				"SRE責任者・正式承認",
				"10月1日以降、本番環境の緊急再起動を許可する必要十分条件は、署名承認、（CPU利用率90%以上またはヘルスチェック失敗）、バックアップ実行中でないこと。",
			),
			doc(
				"O2",
				3,
				"SRE責任者・正式承認",
				"全ての運用判断で観測値の有効期間は観測後1時間以内。同じ項目では高いpriorityを優先する。同順位の値が食い違う場合は不明とする。値が欠落または古い場合も不明で、偽とは扱わない。",
			),
			doc(
				"O3",
				12,
				"SRE責任者・正式承認",
				"10月12日以降、検証環境の緊急再起動はCPU利用率90%以上なら許可し、それ以外は不可。本番環境には適用せず、本番の承認要件も変更しない。",
			),
		],
	},
];

export interface Question {
	id: string;
	packet: string;
	asOf: number;
	question: string;
	observations: Observation[];
	expected: { decision: Decision; governingSources: string[]; reason: string };
}
const value = (v: string | number | boolean, unit = ""): TypedValue =>
	typeof v === "number"
		? { kind: "number", value: v, unit }
		: typeof v === "boolean"
			? { kind: "boolean", value: v }
			: { kind: "string", value: v };
const obs = (
	facts: Record<string, string | number | boolean>,
	units: Record<string, string>,
	asOf = instant(16),
): Observation[] =>
	Object.entries(facts).map(([key, v]) => ({
		observationId: `obs-${key}`,
		key,
		value: value(v, units[key]),
		observedAt: asOf,
		version: "v1",
		priority: 1,
	}));
const q = (
	id: string,
	packet: string,
	question: string,
	observations: Observation[],
	decision: Decision,
	governingSources: string[],
	reason: string,
	asOf = instant(16),
): Question => ({
	id,
	packet,
	asOf,
	question,
	observations,
	expected: { decision, governingSources, reason },
});
const deploy = (
	extra: Record<string, string | number | boolean> = {},
	asOf = instant(16),
) =>
	obs(
		{
			signed: true,
			canary: 0.7,
			rollback: false,
			freeze: false,
			region: "JP",
			latency: 250,
			...extra,
		},
		{ canary: "percent", latency: "ms" },
		asOf,
	);
const factory = (extra: Record<string, string | number | boolean> = {}) =>
	obs(
		{ plant: "K", temperature: 75, duration: 30, coating: "A", ...extra },
		{ temperature: "C", duration: "minute" },
	);
const research = (extra: Record<string, string | number | boolean> = {}) =>
	obs(
		{
			consent: true,
			age: 20,
			onsite: true,
			encrypted: false,
			genetic: false,
			japanApproved: true,
			...extra,
		},
		{ age: "year" },
	);
const operations = (extra: Record<string, string | number | boolean> = {}) =>
	obs(
		{
			environment: "production",
			approval: true,
			cpu: 95,
			healthFailed: false,
			backup: false,
			...extra,
		},
		{ cpu: "percent" },
	);
export const questions: Question[] = [
	q(
		"D01",
		"deploy",
		"現在、本番配信を許可できるか。",
		deploy(),
		"deny",
		["D2"],
		"D1は撤回済み。D3は未施行。D2の0.5%を超える。ブログに決裁権はない。",
	),
	q(
		"D02",
		"deploy",
		"現在、本番配信を許可できるか。",
		deploy({ rollback: true }),
		"allow",
		["D2"],
		"ORの復旧承認で満たす。将来の遅延条件を早く適用しない。",
	),
	q(
		"D03",
		"deploy",
		"施行時刻ちょうどに、本番配信を許可できるか。",
		deploy({ rollback: true }, instant(20)),
		"deny",
		["D3"],
		"D3施行、D2撤回。250msは200ms以下を満たさない。",
		instant(20),
	),
	q(
		"D04",
		"deploy",
		"現在、本番配信を許可できるか。",
		deploy({ rollback: true }).filter((o) => o.key !== "freeze"),
		"hold",
		["D2"],
		"NOTの対象の凍結状態が不明。未観測をfalseにしない。",
	),
	q(
		"F01",
		"factory",
		"K工場のA被覆の出荷を許可できるか。",
		factory(),
		"hold",
		["F1", "F2"],
		"75℃はF1で可、F2で不可。同格の文書が未解決であり日付だけで選べない。",
	),
	q(
		"F02",
		"factory",
		"K工場のA被覆の出荷を許可できるか。両文書で結論が一致すれば共通する結論を答える。",
		factory({ temperature: 85 }),
		"deny",
		["F1", "F2"],
		"どちらの上限も超過。矛盾の解消を待たずとも共通の不可は言える。",
	),
	q(
		"F03",
		"factory",
		"L工場のA被覆の出荷を許可できるか。",
		factory({ plant: "L", temperature: 65 }),
		"deny",
		["F3"],
		"K工場の二文書は別範囲。L工場は60℃以下が必要。",
	),
	q(
		"F04",
		"factory",
		"K工場のA被覆の出荷を許可できるか。",
		factory().filter((o) => o.key !== "temperature"),
		"hold",
		["F1", "F2"],
		"温度がない。どちらの正式文書でも判定不能。",
	),
	q(
		"R01",
		"research",
		"この架空研究で匿名記録の閲覧を許可できるか。",
		research({ age: 19 }),
		"deny",
		["R2"],
		"訂正後の20歳以上を満たさない。草案は無効。",
	),
	q(
		"R02",
		"research",
		"この架空研究で匿名記録の閲覧を許可できるか。",
		research().filter((o) => o.key !== "encrypted"),
		"allow",
		["R2"],
		"施設内trueなので暗号化不明でもORはtrue。",
	),
	q(
		"R03",
		"research",
		"この架空研究で匿名記録の閲覧を許可できるか。",
		research({ onsite: false, encrypted: true }).filter(
			(o) => o.key !== "genetic",
		),
		"hold",
		["R2"],
		"遺伝情報の有無不明。NOT unknownはunknown。",
	),
	q(
		"R04",
		"research",
		"この架空研究で匿名記録の閲覧を許可できるか。",
		research({ consent: false }).filter((o) => o.key !== "genetic"),
		"deny",
		["R2"],
		"同意falseでAND不成立。別項目不明でも不可が確定。",
	),
	q(
		"O01",
		"operations",
		"本番の緊急再起動を許可できるか。",
		[
			...operations({ cpu: 91 }),
			{
				observationId: "cpu-other",
				key: "cpu",
				value: value(89, "percent"),
				observedAt: instant(16),
				version: "v1",
				priority: 1,
			},
		],
		"hold",
		["O1", "O2"],
		"同順位CPUが相反しunknown。healthFailed=falseなのでOR不明。",
	),
	q(
		"O02",
		"operations",
		"本番の緊急再起動を許可できるか。",
		operations().map((o) =>
			o.key === "cpu" ? { ...o, observedAt: instant(16) - 3_600_001 } : o,
		),
		"hold",
		["O1", "O2"],
		"CPUは1時間を超え古い。healthFailed=falseと合わせ判定不能。",
	),
	q(
		"O03",
		"operations",
		"本番の緊急再起動を許可できるか。",
		operations({ healthFailed: true }).filter((o) => o.key !== "cpu"),
		"allow",
		["O1", "O2"],
		"ORのhealthFailed=trueでCPU欠落を補える。他要件は全て満たす。",
	),
	q(
		"O04",
		"operations",
		"本番の緊急再起動を許可できるか。",
		operations({ healthFailed: true }).filter((o) => o.key !== "backup"),
		"hold",
		["O1", "O2"],
		"バックアップ不明は非実行とみなせない。検証環境の規程は適用しない。",
	),
];
