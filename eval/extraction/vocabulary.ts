/**
 * Shared vocabulary of the synthetic dataset: the entity names and the
 * per-split filler strings. Used by the generator (to build cases) and by the
 * skeleton check (to normalize them away). Pure data: no I/O.
 */

export interface Thing {
	readonly id: string;
	readonly name: string;
}

export const things: readonly Thing[] = [
	{ id: "ent-voice", name: "音声サービス" },
	{ id: "ent-search", name: "検索機能" },
	{ id: "ent-notify", name: "通知機能" },
	{ id: "ent-sync", name: "同期機能" },
	{ id: "ent-translate", name: "翻訳機能" },
	{ id: "ent-record", name: "記録機能" },
	{ id: "ent-reserve", name: "予約機能" },
	{ id: "ent-share", name: "共有機能" },
	{ id: "ent-auth", name: "認証機能" },
	{ id: "ent-analyze", name: "分析機能" },
];

export const people: readonly Thing[] = [
	{ id: "ent-sato", name: "佐藤" },
	{ id: "ent-suzuki", name: "鈴木" },
	{ id: "ent-takahashi", name: "高橋" },
	{ id: "ent-ito", name: "伊藤" },
	{ id: "ent-watanabe", name: "渡辺" },
];

/** The two same-name people and the out-of-Scope person. */
export const tanakaNames = ["田中太郎", "田中花子"] as const;
export const tanakaSurname = "田中";
export const yamadaName = "山田";

/** Lead-in clauses. The two splits use disjoint sets. */
export const devPrefixes: readonly string[] = [
	"確認したところ、",
	"先ほどの報告では、",
	"メモとして、",
	"念のため、",
	"会議で、",
];
export const holdoutPrefixes: readonly string[] = [
	"ちなみに、",
	"補足ですが、",
	"先週の時点で、",
	"現場の話として、",
	"私の理解では、",
];

/** Filler utterances of the multi-evidence group, disjoint per split. */
export const devDecoys: readonly string[] = [
	"こんにちは、よろしくお願いします。",
	"ありがとう、助かりました。",
	"それでは次の話題に進みましょう。",
	"少し休憩してから続けます。",
];
export const holdoutDecoys: readonly string[] = [
	"了解です、続けてください。",
	"ご確認いただきありがとうございます。",
	"では、次の議題に移ります。",
	"いったん席を外します。",
];
