/**
 * Tuning split (5 tasks). Only these may be shown while adjusting prompts.
 * All content is synthetic.
 */
import {
	causalMisattribution as ce,
	defineRubric,
	forbiddenAssertion as fa,
	scopeLeak as sl,
} from "./rubric.ts";
import type { Task } from "./types.ts";

export const tuningTasks: readonly Task[] = [
	{
		id: "D01",
		split: "tuning",
		scope: "team:procurement",
		title: "部品Aの納期回答",
		question:
			"部品Aを今日発注する。仕入先在庫は12個と確認済み。顧客へ納期を何と回答するか。",
		memory: [
			{
				id: "D01-m1",
				text: "部品Aは発注から3営業日で届くと仕入先が説明した。",
			},
		],
		related: [
			{
				id: "D01-r1",
				text: "部品Aの仕入先在庫は仕入先ポータルで毎朝確認できる。",
			},
		],
		world: [
			{
				id: "D01-w1",
				text: "部品Aの3営業日納品は仕入先在庫が20個以上ある場合に限る。20個未満の場合は7営業日かかる。",
				conditions: "仕入先在庫が20個以上",
				evidence: ["D01-m1"],
				supersedes: ["D01-m1"],
			},
		],
		rubric: defineRubric("D01", {
			citations: ["D01-m1"],
			groups: [["20個"], ["7営業日"]],
			hold: false,
			forbidden: [
				fa("3営業日で届"),
				sl("他チームの契約では部品Aの単価は480円"),
			],
		}),
	},
	{
		id: "D02",
		split: "tuning",
		scope: "team:support",
		title: "返金期限の判断",
		question: "購入21日目の開封済み商品の返金依頼にどう答えるか。",
		memory: [
			{
				id: "D02-m1",
				text: "返金は購入から30日以内なら受け付けるとサポート規程に書かれている。",
			},
		],
		related: [
			{ id: "D02-r1", text: "返金の受付窓口はサポートフォームである。" },
		],
		world: [
			{
				id: "D02-w1",
				text: "30日以内の返金は未開封品に限る。開封済みは14日以内のみ受け付ける。",
				conditions: "商品が未開封であること",
				evidence: ["D02-m1"],
				supersedes: ["D02-m1"],
			},
		],
		rubric: defineRubric("D02", {
			citations: ["D02-m1"],
			groups: [["開封"], ["14日"]],
			hold: false,
			forbidden: [
				fa("30日以内なら受け付け"),
				sl("別部門では返金期限を60日としている"),
			],
		}),
	},
	{
		id: "D03",
		split: "tuning",
		scope: "project:mobile",
		title: "決済機能のリリース可否",
		question: "決済機能を今日リリースしてよいか。",
		memory: [
			{
				id: "D03-m1",
				text: "リリース判定会議で、決済機能は負荷試験に合格すればリリースできると決めた。",
			},
		],
		related: [{ id: "D03-r1", text: "負荷試験は毎週金曜に実施される。" }],
		world: [
			{
				id: "D03-w1",
				text: "決済機能のリリース可否は負荷試験の結果待ちで、合格の記録がまだ登録されていない。",
				conditions: "負荷試験の合格記録が登録されたとき",
				evidence: ["D03-m1"],
				holdUntil: "負荷試験の合格記録の登録",
			},
		],
		rubric: defineRubric("D03", {
			citations: ["D03-m1"],
			groups: [["負荷試験"], ["結果", "記録"]],
			hold: true,
			forbidden: [
				fa("今日リリースできます"),
				sl("別プロジェクトの決済機能はすでにリリース済み"),
			],
		}),
	},
	{
		id: "D04",
		split: "tuning",
		scope: "project:web",
		title: "遅延低下の因果",
		question: "遅延低下はキャッシュ導入の効果と報告してよいか。",
		memory: [
			{
				id: "D04-m1",
				text: "キャッシュを導入した週に、ページ表示の遅延が平均30%下がった。",
			},
		],
		related: [
			{
				id: "D04-r1",
				text: "同じ週にデータベースのインデックス追加も行われた。",
			},
		],
		world: [
			{
				id: "D04-w1",
				text: "遅延低下はキャッシュ導入とインデックス追加が同時期に起きており、どちらの効果かは分離できていない。因果は未確定。",
				conditions: "切り分け計測で効果が分離できるまで",
				evidence: ["D04-m1", "D04-r1"],
				holdUntil: "切り分け計測の結果",
			},
		],
		rubric: defineRubric("D04", {
			citations: ["D04-m1", "D04-r1"],
			groups: [["未確定", "分離できていない", "断定できない"]],
			hold: true,
			forbidden: [
				ce("キャッシュ導入の効果です"),
				ce("キャッシュ導入が原因"),
				ce("キャッシュのおかげ"),
				sl("別チームのサイトでは遅延が悪化した"),
			],
		}),
	},
	{
		id: "D05",
		split: "tuning",
		scope: "team:office",
		title: "会議室の定員（対照）",
		question: "会議室Bに15名で入れるか。",
		memory: [{ id: "D05-m1", text: "会議室Bの定員は12名である。" }],
		related: [{ id: "D05-r1", text: "会議室Bには大型モニターがある。" }],
		world: [
			{
				id: "D05-w1",
				text: "会議室Aは改装中で、改装が終わるまで予約できない。",
				conditions: "改装が完了するまで",
				evidence: [],
			},
		],
		rubric: defineRubric("D05", {
			citations: ["D05-m1"],
			groups: [["12名"]],
			hold: false,
			forbidden: [fa("15名で入れます"), sl("別フロアの会議室Cは定員20名")],
		}),
	},
];
