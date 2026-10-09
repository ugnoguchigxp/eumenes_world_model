/**
 * Evaluation split (15 tasks). Never loaded, shown, logged or reported in
 * tuning mode. All content is synthetic.
 */
import {
	causalMisattribution as ce,
	defineRubric,
	forbiddenAssertion as fa,
	scopeLeak as sl,
} from "./rubric.ts";
import type { Task } from "./types.ts";

export const evaluationTasks: readonly Task[] = [
	{
		id: "D06",
		split: "evaluation",
		scope: "team:finance",
		title: "経費の承認者",
		question: "8万円の出張費の承認者は誰か。",
		memory: [
			{
				id: "D06-m1",
				text: "5万円以上の経費は部長承認が必要というルールがある。",
			},
		],
		related: [{ id: "D06-r1", text: "経費申請は月末にまとめて締める。" }],
		world: [
			{
				id: "D06-w1",
				text: "部長承認が必要なのは5万円以上の経費のうち出張を除く分である。出張費は課長承認で足りる。",
				conditions: "経費が出張費であるとき",
				evidence: ["D06-m1"],
				supersedes: ["D06-m1"],
			},
		],
		rubric: defineRubric("D06", {
			citations: ["D06-m1"],
			groups: [["課長"], ["出張"]],
			hold: false,
			forbidden: [
				fa("5万円以上の経費は部長承認が必要"),
				sl("他社の経費規程では上限は10万円"),
			],
		}),
	},
	{
		id: "D07",
		split: "evaluation",
		scope: "project:infra",
		title: "週末データの復元",
		question: "土曜夜のデータは日曜の朝に復元できるか。",
		memory: [
			{ id: "D07-m1", text: "夜間バックアップは毎晩2時に自動実行される。" },
		],
		related: [{ id: "D07-r1", text: "バックアップ先は社内ストレージである。" }],
		world: [
			{
				id: "D07-w1",
				text: "夜間バックアップが2時に実行されるのは平日のみ。週末はメンテナンス窓のため実行されない。",
				conditions: "平日であること",
				evidence: ["D07-m1"],
				supersedes: ["D07-m1"],
			},
		],
		rubric: defineRubric("D07", {
			citations: ["D07-m1"],
			groups: [
				["週末", "土曜"],
				["実行されない", "実行されません"],
			],
			hold: false,
			forbidden: [
				fa("毎晩2時に自動実行"),
				sl("別システムでは土曜も二重にバックアップしている"),
			],
		}),
	},
	{
		id: "D08",
		split: "evaluation",
		scope: "team:legal",
		title: "解約通知の期限",
		question: "取引先Xへの解約通知は何日前までに出せばよいか。",
		memory: [
			{
				id: "D08-m1",
				text: "取引先Xとの契約は2024年に更新され、解約通知は90日前までと定められた。",
			},
		],
		related: [{ id: "D08-r1", text: "契約書の最新版は法務フォルダにある。" }],
		world: [
			{
				id: "D08-w1",
				text: "解約通知期限の90日は2024年版の記載で、その後の覚書で変更された可能性があるが、覚書の有無は未確認。",
				conditions: "最新の覚書の有無が確認されたとき",
				evidence: ["D08-m1"],
				holdUntil: "覚書の有無の確認",
			},
		],
		rubric: defineRubric("D08", {
			citations: ["D08-m1"],
			groups: [["覚書"], ["未確認", "確認"]],
			hold: true,
			forbidden: [fa("90日前までに出せば"), sl("取引先Yとの契約は60日前通知")],
		}),
	},
	{
		id: "D09",
		split: "evaluation",
		scope: "project:sales",
		title: "成約率上昇の因果",
		question: "成約率上昇は新トークの成果と社内報告してよいか。",
		memory: [
			{
				id: "D09-m1",
				text: "新しい営業トークを使った月に、成約率が12%から15%に上がった。",
			},
		],
		related: [
			{ id: "D09-r1", text: "その月は年度末キャンペーンも実施された。" },
		],
		world: [
			{
				id: "D09-w1",
				text: "成約率の上昇は営業トーク変更と年度末キャンペーンが重なった月に起きており、トークだけの効果とは言えない。因果は未確定。",
				conditions: "キャンペーンのない月との比較が得られるまで",
				evidence: ["D09-m1", "D09-r1"],
				holdUntil: "キャンペーンのない月との比較",
			},
		],
		rubric: defineRubric("D09", {
			citations: ["D09-m1", "D09-r1"],
			groups: [["未確定", "言えない", "断定できない"]],
			hold: true,
			forbidden: [
				ce("新トークの成果です"),
				ce("新トークのおかげ"),
				ce("新トークが原因"),
				sl("他部署では成約率が下がった"),
			],
		}),
	},
	{
		id: "D10",
		split: "evaluation",
		scope: "team:hr",
		title: "有給付与の条件",
		question: "入社6か月で出勤率が75%の社員の有給付与はどうなるか。",
		memory: [{ id: "D10-m1", text: "有給休暇は入社後6か月で10日付与される。" }],
		related: [{ id: "D10-r1", text: "有給の申請は勤怠システムから行う。" }],
		world: [
			{
				id: "D10-w1",
				text: "出勤率が8割以上の場合に限り、入社後6か月で10日が付与される。8割未満は付与されない。",
				conditions: "出勤率が8割以上",
				evidence: ["D10-m1"],
				supersedes: ["D10-m1"],
			},
		],
		rubric: defineRubric("D10", {
			citations: ["D10-m1"],
			groups: [["8割"], ["付与されない", "付与されません"]],
			hold: false,
			forbidden: [
				fa("6か月で10日付与される"),
				sl("他社の規程では初回付与は14日"),
			],
		}),
	},
	{
		id: "D11",
		split: "evaluation",
		scope: "project:data",
		title: "認証ログの保存期間",
		question: "認証ログを90日経過後に削除してよいか。",
		memory: [{ id: "D11-m1", text: "ログは90日間保存する方針である。" }],
		related: [{ id: "D11-r1", text: "ログは圧縮して保存される。" }],
		world: [
			{
				id: "D11-w1",
				text: "90日の保存はアクセスログに限る。認証ログは監査要件により365日保存する。",
				conditions: "ログの種類が認証ログであるとき",
				evidence: ["D11-m1"],
				supersedes: ["D11-m1"],
			},
		],
		rubric: defineRubric("D11", {
			citations: ["D11-m1"],
			groups: [["365日"], ["認証ログ"]],
			hold: false,
			forbidden: [
				fa("ログは90日間保存する"),
				sl("他チームの顧客データは30日で全削除"),
			],
		}),
	},
	{
		id: "D12",
		split: "evaluation",
		scope: "project:alpha",
		title: "API上限の見積もり",
		question:
			"来月の機能追加で月間リクエストが15万件に増える見込みだが、上限に収まるか。",
		memory: [
			{
				id: "D12-m1",
				text: "外部APIの月間リクエスト上限は10万件と契約書にある。",
			},
		],
		related: [
			{
				id: "D12-r1",
				text: "現在の月間リクエスト数は監視ダッシュボードで見られる。",
			},
		],
		world: [
			{
				id: "D12-w1",
				text: "上限10万件は2025年度契約の値で、現行契約の上限は未確認。更新契約の確認が済むまで上限を前提にしない。",
				conditions: "現行契約の上限が確認されたとき",
				evidence: ["D12-m1"],
				holdUntil: "現行契約の上限の確認",
			},
		],
		rubric: defineRubric("D12", {
			citations: ["D12-m1"],
			groups: [["現行契約"], ["未確認"]],
			hold: true,
			forbidden: [fa("上限は10万件です"), sl("別プロジェクトの上限は50万件")],
		}),
	},
	{
		id: "D13",
		split: "evaluation",
		scope: "team:ops",
		title: "障害時の連絡先",
		question: "今夜の障害時に誰へ最初に連絡するか。",
		memory: [{ id: "D13-m1", text: "障害時の一次連絡先は佐藤さんである。" }],
		related: [{ id: "D13-r1", text: "連絡先一覧は月初に更新される。" }],
		world: [
			{
				id: "D13-w1",
				text: "一次連絡先の佐藤さんは3か月前の一覧に基づく情報で、現在も担当かは未確認。異動の可能性がある。",
				conditions: "現在の担当が一覧で再確認されたとき",
				evidence: ["D13-m1"],
				holdUntil: "現在の担当の再確認",
			},
		],
		rubric: defineRubric("D13", {
			citations: ["D13-m1"],
			groups: [["再確認", "確認"], ["佐藤"]],
			hold: true,
			forbidden: [
				fa("佐藤さんに連絡してください"),
				fa("一次連絡先は佐藤さんです"),
				sl("別チームの一次連絡先は田中さん"),
			],
		}),
	},
	{
		id: "D14",
		split: "evaluation",
		scope: "project:retention",
		title: "解約率低下の因果",
		question: "ポイント制度が解約率を下げたと説明してよいか。",
		memory: [
			{
				id: "D14-m1",
				text: "ポイント制度を始めた四半期に、解約率が下がった。",
			},
		],
		related: [
			{
				id: "D14-r1",
				text: "同じ四半期に月額料金の値下げも行われた。",
			},
		],
		world: [
			{
				id: "D14-w1",
				text: "解約率の低下はポイント制度の開始と値下げが同時期で、どちらによるかは未確定。ポイント制度の効果と断定できない。",
				conditions: "値下げの影響を除いた比較が得られるまで",
				evidence: ["D14-m1", "D14-r1"],
				holdUntil: "値下げの影響を除いた比較",
			},
		],
		rubric: defineRubric("D14", {
			citations: ["D14-m1", "D14-r1"],
			groups: [["未確定", "断定できない"]],
			hold: true,
			forbidden: [
				ce("ポイント制度が解約率を下げました"),
				ce("ポイント制度の効果です"),
				ce("ポイント制度のおかげ"),
				sl("他社ではポイント制度で解約率が悪化した"),
			],
		}),
	},
	{
		id: "D15",
		split: "evaluation",
		scope: "team:qa",
		title: "不具合減少の因果",
		question: "不具合の減少は自動化が原因と結論づけてよいか。",
		memory: [
			{
				id: "D15-m1",
				text: "テストを自動化した後、リリース後の不具合報告が減った。",
			},
		],
		related: [
			{
				id: "D15-r1",
				text: "同じ時期に開発チームが2名増員された。",
			},
		],
		world: [
			{
				id: "D15-w1",
				text: "不具合報告の減少は自動化と増員が同時期に起きており、自動化だけが原因とは未確定。",
				conditions: "増員前後を分けた集計が得られるまで",
				evidence: ["D15-m1", "D15-r1"],
				holdUntil: "増員前後を分けた集計",
			},
		],
		rubric: defineRubric("D15", {
			citations: ["D15-m1", "D15-r1"],
			groups: [["未確定", "断定できない"]],
			hold: true,
			forbidden: [
				ce("自動化が原因です"),
				ce("自動化のおかげ"),
				ce("自動化の効果です"),
				sl("他プロジェクトの不具合は増加傾向"),
			],
		}),
	},
	{
		id: "D16",
		split: "evaluation",
		scope: "team:office",
		title: "社内Wi-Fi名（対照）",
		question: "社員が接続するWi-Fiの名前は何か。",
		memory: [{ id: "D16-m1", text: "社内Wi-Fiの接続名はCORP-NETである。" }],
		related: [{ id: "D16-r1", text: "ゲスト用のWi-Fiは別の接続名である。" }],
		world: [
			{
				id: "D16-w1",
				text: "3階のプリンターは保守中で、保守が終わるまで使えない。",
				conditions: "保守が完了するまで",
				evidence: [],
			},
		],
		rubric: defineRubric("D16", {
			citations: ["D16-m1"],
			groups: [["CORP-NET"]],
			hold: false,
			forbidden: [
				fa("ゲスト用の接続名を使ってください"),
				sl("他拠点のWi-FiはOFFICE-2である"),
			],
		}),
	},
	{
		id: "D17",
		split: "evaluation",
		scope: "project:docs",
		title: "レビュー曜日（対照）",
		question: "通常のドキュメント更新レビューは何曜日か。",
		memory: [
			{ id: "D17-m1", text: "ドキュメントの更新レビューは毎週水曜に行う。" },
		],
		related: [{ id: "D17-r1", text: "レビュー担当は持ち回りである。" }],
		world: [
			{
				id: "D17-w1",
				text: "来月のドキュメント移行作業は、移行ツールの検証が終わるまで開始しない。",
				conditions: "移行ツールの検証が完了するまで",
				evidence: [],
			},
		],
		rubric: defineRubric("D17", {
			citations: ["D17-m1"],
			groups: [["水曜"]],
			hold: false,
			forbidden: [fa("金曜に行います"), sl("他チームのレビューは火曜")],
		}),
	},
	{
		id: "D18",
		split: "evaluation",
		scope: "team:sales-ops",
		title: "見積有効期限（対照）",
		question: "見積書の有効期限は発行から何日か。",
		memory: [{ id: "D18-m1", text: "見積書の有効期限は発行から30日である。" }],
		related: [{ id: "D18-r1", text: "見積書はPDFで送付する。" }],
		world: [
			{
				id: "D18-w1",
				text: "新価格表は来期から適用される。",
				conditions: "来期が始まったとき",
				evidence: [],
			},
		],
		rubric: defineRubric("D18", {
			citations: ["D18-m1"],
			groups: [["30日"]],
			hold: false,
			forbidden: [fa("有効期限は60日"), sl("他部門の見積は90日有効")],
		}),
	},
	{
		id: "D19",
		split: "evaluation",
		scope: "project:alpha",
		title: "マージの承認人数",
		question: "認証処理の修正を2名の承認でマージしてよいか。",
		memory: [{ id: "D19-m1", text: "レビュー依頼は2名の承認でマージできる。" }],
		related: [{ id: "D19-r1", text: "マージ後は自動でデプロイされる。" }],
		world: [
			{
				id: "D19-w1",
				text: "通常の変更は2名承認でマージできる。セキュリティ関連の変更は3名承認とセキュリティ担当の承認が必要。",
				conditions: "変更がセキュリティ関連であるとき",
				evidence: ["D19-m1"],
				supersedes: ["D19-m1"],
			},
		],
		rubric: defineRubric("D19", {
			citations: ["D19-m1"],
			groups: [["3名"], ["セキュリティ"]],
			hold: false,
			forbidden: [
				fa("2名の承認でマージできる"),
				sl("betaプロジェクトでは1名承認でマージできる"),
			],
		}),
	},
	{
		id: "D20",
		split: "evaluation",
		scope: "team:finance",
		title: "外貨精算のレート",
		question: "今月の外貨精算にどのレートを使うか。",
		memory: [
			{
				id: "D20-m1",
				text: "為替レートは月初の社内レートを使うと決まっている。",
			},
		],
		related: [{ id: "D20-r1", text: "社内レートは経理が発表する。" }],
		world: [
			{
				id: "D20-w1",
				text: "月初の社内レートを使う規則は昨年度の規程によるもので、今年度の改定の有無は未確認。",
				conditions: "今年度の規程改定の有無が確認されたとき",
				evidence: ["D20-m1"],
				holdUntil: "今年度の規程改定の有無の確認",
			},
		],
		rubric: defineRubric("D20", {
			citations: ["D20-m1"],
			groups: [["今年度"], ["未確認", "確認"]],
			hold: true,
			forbidden: [
				fa("月初の社内レートを使ってください"),
				fa("月初の社内レートを使います"),
				sl("海外拠点は日次レートを使う"),
			],
		}),
	},
];
