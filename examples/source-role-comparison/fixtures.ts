import type { Tri } from "../../src/index.ts";
import type { Packet, Decision } from "../multi-source-comparison/fixtures.ts";
import type { HoldoutQuestion } from "../linked-answer-holdout/fixtures.ts";
import { observation } from "../linked-answer-holdout/fixtures.ts";
import type { AnswerContext } from "../multi-source-comparison/world.ts";
import saved from "./regression-inputs.json";
export const VERSION = "source-role-v1";
export type Role =
	| "permission_rule"
	| "supporting_evidence"
	| "permission_rule_and_support";
export interface RoleQuestion extends HoldoutQuestion {
	suite: "regression" | "unseen";
	expectedRoles: Record<string, Role>;
}
export interface Prepared {
	question: RoleQuestion;
	context: AnswerContext;
}
export const regressions = saved.cases as unknown as Prepared[];
const time = Date.UTC(2026, 11, 15);
const doc = (id: string, statement: string) => ({
	id,
	statement,
	authority: "施設管理委員会の正式決定",
	published: "2026-12-01T00:00:00.000Z",
});
const observationPolicy =
	"2026年12月1日施行。観測は基準時刻以前かつ1時間以内（境界を含む）を使い、同じ項目ではpriority最大を採用する。同順位で値が違う場合、古い値、未来の値、欠落は不明。";
export const packets: Packet[] = [
	{
		id: "airlock",
		name: "架空気密区画の開放",
		keys: {
			zone: "区画 string alpha/beta",
			approved: "担当承認 boolean",
			level: "粒子濃度 number count",
			backup: "代替装置稼働 boolean",
			locked: "閉鎖命令あり boolean",
		},
		documents: [
			doc(
				"AX9",
				"表題は『測定補足』。2026年12月1日施行。alpha区画の開放の必要十分条件は、担当承認あり、かつ（粒子濃度12 count以下または代替装置稼働）、かつ閉鎖命令がないこと。betaには適用しない。",
			),
			doc(
				"AX1",
				"表題は『開放許可規程・観測章』。" +
					observationPolicy +
					"この文書が定めるのは観測の扱いだけで、開放を許可する条件は定めない。",
			),
			doc(
				"AX4",
				"2026年12月1日施行。beta区画の開放は担当承認ありかつ粒子濃度3 count以下の場合に限り、その場合は許可する。alphaには適用しない。",
			),
		],
	},
	{
		id: "mixed-vault",
		name: "架空保管室の持出し",
		keys: {
			hall: "室 string u/v",
			ready: "検品済み boolean",
			certificate: "証明書あり boolean",
			witness: "立会人あり boolean",
			quarantine: "隔離中 boolean",
		},
		documents: [
			doc(
				"BV2",
				"2026年12月1日施行。u室からの持出しの必要十分条件は、検品済み、かつ（証明書ありまたは立会人あり）、かつ隔離中でないこと。同じ文書の観測章では次を定める。" +
					observationPolicy +
					"v室の持出しには適用しない。",
			),
			doc(
				"BV8",
				"2026年12月1日施行。v室の持出しは検品済みかつ証明書ありの場合に限り、その場合は許可する。u室には適用しない。",
			),
		],
	},
	{
		id: "press-control",
		name: "架空装置の始動",
		keys: {
			trained: "操作講習修了 boolean",
			temperature: "装置温度 number C",
			manual: "手動冷却稼働 boolean",
			stopped: "停止命令あり boolean",
			signed: "監査記録の署名あり boolean",
		},
		documents: [
			doc(
				"CZ7",
				"2026年12月1日施行。装置始動の必要十分条件は、操作講習修了、かつ（装置温度22 C以下または手動冷却稼働）、かつ停止命令がないことである。",
			),
			doc(
				"CZ5",
				observationPolicy +
					"別件の監査業務については、監査記録に署名がある場合に限り監査完了とし、その場合は監査完了とする。監査完了は観測の採否や装置始動の追加条件ではない。この文書は始動の許可規程ではない。",
			),
		],
	},
	{
		id: "studio-access",
		name: "架空制作室への入場",
		keys: {
			registered: "登録済み boolean",
			badge: "認証札あり boolean",
			escort: "引率者あり boolean",
		},
		documents: [
			doc(
				"DK3",
				"2026年12月1日施行。制作室への入場の必要十分条件は登録済みかつ認証札あり。",
			),
			doc(
				"DK6",
				"2026年12月2日施行。制作室への入場の必要十分条件は登録済みかつ（認証札ありまたは引率者あり）。DK3と同格で双方有効、撤回・置換・優先順位の指定はない。",
			),
			doc(
				"DK1",
				observationPolicy +
					"これは観測の扱いだけを定め、入場の許可条件は定めない。",
			),
		],
	},
];
type Value = boolean | string | readonly [number, string];
function q(
	packet: string,
	id: string,
	values: Record<string, Value>,
	decision: Decision,
	expectedAssessments: Record<string, Tri>,
	expectedRoles: Record<string, Role>,
	category: string,
): RoleQuestion {
	return {
		packet,
		id,
		asOf: time,
		question: `この状況で${packets.find((p) => p.id === packet)!.name}を許可できるか。`,
		observations: Object.entries(values).map(([k, v]) =>
			observation(k, v, time),
		),
		expected: {
			decision,
			governingSources: Object.keys(expectedRoles),
			reason: category,
		},
		expectedAssessments,
		expectedRoles,
		category,
		suite: "unseen",
	};
}
const airRoles = {
	AX9: "permission_rule",
	AX1: "supporting_evidence",
} as const;
const vaultRoles = { BV2: "permission_rule_and_support" } as const;
const pressRoles = {
	CZ7: "permission_rule",
	CZ5: "supporting_evidence",
} as const;
const studioRoles = {
	DK3: "permission_rule",
	DK6: "permission_rule",
	DK1: "supporting_evidence",
} as const;
export const unseenQuestions: RoleQuestion[] = [
	q(
		"airlock",
		"AX01",
		{
			zone: "alpha",
			approved: true,
			level: [10, "count"],
			backup: false,
			locked: false,
		},
		"allow",
		{ AX9: "satisfied" },
		airRoles,
		"misleading-title-allow",
	),
	q(
		"airlock",
		"AX02",
		{ zone: "alpha", approved: true, backup: false, locked: false },
		"hold",
		{ AX9: "unknown" },
		airRoles,
		"misleading-title-missing",
	),
	q(
		"airlock",
		"AX03",
		{ zone: "alpha", approved: false, backup: false, locked: false },
		"deny",
		{ AX9: "violated" },
		airRoles,
		"misleading-title-deny",
	),
	q(
		"mixed-vault",
		"BV01",
		{ hall: "u", ready: true, witness: true, quarantine: false },
		"allow",
		{ BV2: "satisfied" },
		vaultRoles,
		"mixed-document-or-missing",
	),
	q(
		"mixed-vault",
		"BV02",
		{ hall: "u", ready: true, certificate: true, witness: false },
		"hold",
		{ BV2: "unknown" },
		vaultRoles,
		"mixed-document-missing",
	),
	q(
		"mixed-vault",
		"BV03",
		{
			hall: "u",
			ready: true,
			certificate: true,
			witness: false,
			quarantine: true,
		},
		"deny",
		{ BV2: "violated" },
		vaultRoles,
		"mixed-document-deny",
	),
	q(
		"press-control",
		"CZ01",
		{
			trained: true,
			temperature: [20, "C"],
			manual: false,
			stopped: false,
			signed: false,
		},
		"allow",
		{ CZ7: "satisfied" },
		pressRoles,
		"support-false-permission-true",
	),
	q(
		"press-control",
		"CZ02",
		{ trained: true, manual: false, stopped: false, signed: true },
		"hold",
		{ CZ7: "unknown" },
		pressRoles,
		"support-true-permission-unknown",
	),
	q(
		"press-control",
		"CZ03",
		{
			trained: false,
			temperature: [20, "C"],
			manual: false,
			stopped: false,
			signed: true,
		},
		"deny",
		{ CZ7: "violated" },
		pressRoles,
		"support-true-permission-false",
	),
	q(
		"studio-access",
		"DK01",
		{ registered: true, badge: false, escort: true },
		"hold",
		{ DK3: "violated", DK6: "satisfied" },
		studioRoles,
		"coequal-conflict",
	),
	q(
		"studio-access",
		"DK02",
		{ registered: true, badge: true, escort: false },
		"allow",
		{ DK3: "satisfied", DK6: "satisfied" },
		studioRoles,
		"coequal-allow",
	),
	q(
		"studio-access",
		"DK03",
		{ registered: false, badge: false, escort: true },
		"deny",
		{ DK3: "violated", DK6: "violated" },
		studioRoles,
		"coequal-deny",
	),
];
export const questions = [
	...regressions.map((c) => c.question),
	...unseenQuestions,
];
