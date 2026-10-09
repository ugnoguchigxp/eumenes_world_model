/**
 * Deterministic generator of the P4-05 synthetic Japanese dataset. No clock,
 * randomness or I/O: the same templates always give the same 200 cases.
 * `bun eval/extraction/generate.ts` rewrites dataset.v2.json (then run
 * `bunx oxfmt --write eval/extraction/dataset.v2.json`) and prints the
 * new digest. Run it only when creating a NEW dataset version; the committed
 * output is pinned by DATASET_SHA256 and gold answers must exist before any
 * model run.
 *
 * Dataset v2: every group has separate template families for dev and
 * holdout, so no sentence structure of the holdout appears in dev
 * (`skeleton.ts` checks this). The v1 generator, whose two splits shared their
 * templates, is retired together with its data.
 */
import { writeFileSync } from "node:fs";
import {
	DATASET_VERSION,
	casesPerGroupPerSplit,
	codePointLength,
	datasetDigest,
	groups,
	splits,
	stableStringify,
	type CandidatePayload,
	type Dataset,
	type DatasetEntity,
	type EntitySetName,
	type EvalCase,
	type EvalUtterance,
	type Gold,
	type GoldCandidate,
	type GoldCondition,
	type GoldQuote,
	type GoldValidTime,
	type Group,
	type ModelModality,
	type ReferenceCandidate,
	type Split,
} from "./dataset.ts";
import {
	devDecoys,
	devPrefixes,
	holdoutDecoys,
	holdoutPrefixes,
	people,
	things,
	type Thing,
} from "./vocabulary.ts";

const predicates = [
	"available",
	"latency_ms",
	"owner",
	"depends_on",
	"responsible_for",
] as const;

const entity = (
	id: string,
	displayName: string,
	aliases: readonly string[],
): DatasetEntity => ({
	id,
	revision: 1,
	displayName,
	aliases,
	externalRefs: [],
});

const baseEntities: readonly DatasetEntity[] = [
	...things.map((t) => entity(t.id, t.name, [t.name])),
	...people.map((p) =>
		entity(p.id, `${p.name}さん`, [p.name, `${p.name}さん`]),
	),
];
const sameNameEntities: readonly DatasetEntity[] = [
	...baseEntities,
	entity("ent-tanaka-1", "田中太郎", ["田中太郎", "田中太郎さん", "田中"]),
	entity("ent-tanaka-2", "田中花子", ["田中花子", "田中花子さん", "田中"]),
];
const foreignEntities: readonly DatasetEntity[] = [
	entity("ent-yamada", "山田さん", ["山田", "山田さん"]),
	entity("ent-confidential", "機密連携機能", ["機密連携機能"]),
];

interface Ctx {
	readonly n: number;
	readonly k: number;
	readonly S: Thing;
	readonly S2: Thing;
	readonly P: Thing;
	readonly P2: Thing;
	readonly num: number;
	readonly alt: number;
	readonly prefix: string;
	readonly split: Split;
}

const makeCtx = (k: number, split: Split): Ctx => {
	const n = k * 2 + (split === "holdout" ? 1 : 0);
	// The second half of each split (n >= 10) shifts the picks, so no two
	// cases of one group share their wording.
	const f = Math.floor(n / 10);
	const prefixList = split === "dev" ? devPrefixes : holdoutPrefixes;
	return {
		n,
		k,
		S: things[(n * 3 + 1 + f) % things.length]!,
		S2: things[(n * 3 + 5 + 2 * f) % things.length]!,
		P: people[(n + f) % people.length]!,
		P2: people[(n + 2 + f) % people.length]!,
		num: 120 + n * 15,
		alt: 120 + n * 15 + 45,
		prefix: prefixList[n % prefixList.length]!,
		split,
	};
};

/** Locates `needle` in utterance `index` as a code point span. */
function quoteOf(
	utterances: readonly EvalUtterance[],
	index: number,
	needle: string,
): GoldQuote {
	const utterance = utterances[index]!;
	const at = utterance.text.indexOf(needle);
	if (at < 0 || utterance.text.indexOf(needle, at + 1) >= 0)
		throw new Error(`needle not unique: ${needle}`);
	const startCp = codePointLength(utterance.text.slice(0, at));
	return {
		utteranceId: utterance.utteranceId,
		startCp,
		endCp: startCp + codePointLength(needle),
	};
}

const subjectOf = (thing: Thing) => ({ kind: "id", id: thing.id }) as const;
const idRef = (thing: Thing) => ({ kind: "id", id: thing.id }) as const;
const bool = (value: boolean): CandidatePayload => ({
	kind: "value",
	value: { kind: "boolean", value },
});
const ms = (value: number): CandidatePayload => ({
	kind: "value",
	value: { kind: "number", value, unit: "ms" },
});
const entityValue = (thing: Thing): CandidatePayload => ({
	kind: "value",
	value: { kind: "entity", entityId: thing.id },
});
const depends = (thing: Thing): CandidatePayload => ({
	kind: "relation",
	relation: "depends_on",
	object: idRef(thing),
});

interface Fact {
	readonly subject: GoldCandidate["subject"];
	readonly predicate: string;
	readonly payload: CandidatePayload;
}
const avail = (s: Thing, value = true): Fact => ({
	subject: subjectOf(s),
	predicate: "available",
	payload: bool(value),
});
const latency = (s: Thing, value: number): Fact => ({
	subject: subjectOf(s),
	predicate: "latency_ms",
	payload: ms(value),
});
const owner = (s: Thing, p: Thing): Fact => ({
	subject: subjectOf(s),
	predicate: "owner",
	payload: entityValue(p),
});
const dependsOn = (s: Thing, o: Thing): Fact => ({
	subject: subjectOf(s),
	predicate: "depends_on",
	payload: depends(o),
});

const unconditional: GoldCondition = { kind: "unspecified" };

const candidate = (
	fact: Fact,
	quote: GoldQuote,
	extra: Partial<Pick<GoldCandidate, "altQuotes" | "validTime">> &
		Partial<{ condition: GoldCondition }> = {},
): GoldCandidate => ({
	subject: fact.subject,
	predicate: fact.predicate,
	payload: fact.payload,
	quote,
	condition: extra.condition ?? unconditional,
	...(extra.altQuotes === undefined ? {} : { altQuotes: extra.altQuotes }),
	...(extra.validTime === undefined ? {} : { validTime: extra.validTime }),
});

const adopt = (
	c: GoldCandidate,
	treatment: "asserted" | "reported" = "asserted",
): Gold => ({
	outcome: "adopt",
	treatment,
	...(treatment === "reported" ? { classification: "reported" as const } : {}),
	candidate: c,
	reference: [{ modality: treatment, candidate: c }],
});
const hold = (
	reason: Extract<Gold, { outcome: "hold" }>["reason"],
	reference: readonly ReferenceCandidate[],
	classification?: "negated" | "hypothetical",
): Gold => ({
	outcome: "hold",
	reason,
	...(classification === undefined ? {} : { classification }),
	reference,
});
const ref = (
	modality: ModelModality,
	c: GoldCandidate,
): ReferenceCandidate => ({ modality, candidate: c });

interface Draft {
	readonly texts: readonly string[];
	readonly origins?: readonly ("user_report" | "document_claim")[];
	readonly gold: (utterances: readonly EvalUtterance[]) => Gold;
	readonly entitySet?: EntitySetName;
	readonly forgotten?: (utterances: readonly EvalUtterance[]) => {
		utteranceIds: readonly string[];
		claim: GoldCandidate;
	};
}

/** A single sentence utterance whose sentence is the claim. */
const single = (
	text: string,
	build: (quote: GoldQuote) => Gold,
	sentence = text,
): Draft => ({
	texts: [text],
	gold: (u) => build(quoteOf(u, 0, sentence)),
});

// ---------------------------------------------------------------- groups
//
// Every group has two disjoint template families, one per split. The dev
// family is the original v1 wording; the holdout family uses other sentence
// structures (register, word order, vocabulary), so that tuning a prompt on
// dev cannot teach the holdout templates. `skeleton.ts` and the test suite
// check that no normalized sentence is shared by the two splits.

const pickBySplit = <T>(c: Ctx, dev: readonly T[], holdout: readonly T[]): T =>
	(c.split === "dev" ? dev : holdout)[c.k % 5]!;

function negation(c: Ctx): Draft {
	const { S, S2, P, num } = c;
	const [s, fact] = pickBySplit<[string, Fact]>(
		c,
		[
			[`${S.name}は使えない。`, avail(S)],
			[`${S.name}の応答時間は${num}ミリ秒ではない。`, latency(S, num)],
			[`${S.name}は${S2.name}に依存していない。`, dependsOn(S, S2)],
			[`${P.name}さんは${S.name}の担当ではない。`, owner(S, P)],
			[`${S.name}はまだ使えるようになっていない。`, avail(S)],
		],
		[
			[`${S.name}の利用は現時点では不可能です。`, avail(S)],
			[
				`${S.name}の応答時間が${num}ミリ秒に達することはありません。`,
				latency(S, num),
			],
			[`${S2.name}への依存は${S.name}にはありません。`, dependsOn(S, S2)],
			[`${S.name}の担当者が${P.name}さんだという話は誤りです。`, owner(S, P)],
			[
				`${S.name}は未提供のままで、利用できる状態にはなっていません。`,
				avail(S),
			],
		],
	);
	return single(
		c.prefix + s,
		(q) => hold("negated", [ref("negated", candidate(fact, q))], "negated"),
		s,
	);
}

function hypothesis(c: Ctx): Draft {
	const { S, S2, P, num } = c;
	const [text, fact] = pickBySplit<[string, Fact]>(
		c,
		[
			[`もし${S.name}が使えるなら、導入を考えたい。`, avail(S)],
			[
				`${S.name}の応答時間が${num}ミリ秒になれば、十分だと思う。`,
				latency(S, num),
			],
			[
				`仮に${S.name}が${S2.name}に依存しているとしたら、障害の影響が大きい。`,
				dependsOn(S, S2),
			],
			[`${S.name}が使えるようになったら、教えてください。`, avail(S)],
			[`${P.name}さんが${S.name}の担当だったら、安心なのに。`, owner(S, P)],
		],
		[
			[
				`万が一${S.name}が利用可能になった場合には、すぐに連絡をお願いします。`,
				avail(S),
			],
			[
				`${S.name}の応答時間が${num}ミリ秒を下回るとすれば、採用を検討します。`,
				latency(S, num),
			],
			[
				`${S.name}が${S2.name}に頼っていると仮定すると、${S2.name}の停止時に困ります。`,
				dependsOn(S, S2),
			],
			[
				`${P.name}さんが${S.name}を受け持ってくれるなら、助かります。`,
				owner(S, P),
			],
			[
				`もしも${S.name}が使えるものとして考えるなら、日程を短縮できそうです。`,
				avail(S),
			],
		],
	);
	return single(text, (q) =>
		hold(
			"hypothetical",
			[ref("hypothetical", candidate(fact, q))],
			"hypothetical",
		),
	);
}

function hearsay(c: Ctx): Draft {
	const { S, S2, P, num } = c;
	const [text, fact] = pickBySplit<[string, Fact]>(
		c,
		[
			[`${P.name}さんによると、${S.name}は使えるそうだ。`, avail(S)],
			[
				`${P.name}さんは、${S.name}の応答時間は${num}ミリ秒だと言っていた。`,
				latency(S, num),
			],
			[`${S.name}は${S2.name}に依存しているらしい。`, dependsOn(S, S2)],
			[`噂では、${S.name}の担当は${P.name}さんだという。`, owner(S, P)],
			[
				`${P.name}さんの話では、${S.name}は使えないとのことだ。`,
				avail(S, false),
			],
		],
		[
			[
				`${P.name}さんから聞いた話ですが、${S.name}は利用可能になったようです。`,
				avail(S),
			],
			[
				`${S.name}の応答時間は${num}ミリ秒前後になると${P.name}さんが話していました。`,
				latency(S, num),
			],
			[
				`${S2.name}に${S.name}が依存しているという話を耳にしました。`,
				dependsOn(S, S2),
			],
			[
				`伝え聞いたところでは、${P.name}さんが${S.name}を見ているそうです。`,
				owner(S, P),
			],
			[
				`${P.name}さんいわく、${S.name}はもう利用できなくなったらしいです。`,
				avail(S, false),
			],
		],
	);
	return single(text, (q) => adopt(candidate(fact, q), "reported"));
}

function otherPerson(c: Ctx): Draft {
	const { S, S2, P, P2 } = c;
	const v = Math.floor(c.k / 2);
	if (c.k % 2 === 0) {
		// [text, the sentence the claim is quoted from]
		const devVariants: [string, string][] = [
			[`${S.name}の担当は私ではなく${P.name}さんです。`, ""],
			[`${S.name}を管理しているのは${P.name}さんで、私ではありません。`, ""],
			[
				`${P.name}さんが${S.name}の担当で、${P2.name}さんは関係ありません。`,
				"",
			],
			[
				`${S.name}の担当は${P.name}さんだ。${P2.name}さんではない。`,
				`${S.name}の担当は${P.name}さんだ。`,
			],
			[`${S.name}は${P.name}さんの管轄で、${P2.name}さんの管轄ではない。`, ""],
		];
		const holdoutVariants: [string, string][] = [
			[
				`${S.name}を見ているのは${P.name}さんであって、自分ではありません。`,
				"",
			],
			[
				`${P.name}さんが${S.name}の責任者です。${P2.name}さんは担当外です。`,
				`${P.name}さんが${S.name}の責任者です。`,
			],
			[`私ではなく${P.name}さんが${S.name}を担当しています。`, ""],
			[
				`${P2.name}さんではなく、${P.name}さんが${S.name}の担当者に決まっています。`,
				"",
			],
			[
				`${S.name}の運用は${P.name}さんの役割で、私も${P2.name}さんも関わっていません。`,
				"",
			],
		];
		const [text, sentence] = (
			c.split === "dev" ? devVariants : holdoutVariants
		)[v]!;
		return single(
			text,
			(q) => adopt(candidate(owner(S, P), q)),
			sentence === "" ? text : sentence,
		);
	}
	const yamada = { kind: "alias", text: "山田" } as const;
	const subject = (predicate: string, payload: CandidatePayload): Fact => ({
		subject: yamada,
		predicate,
		payload,
	});
	const variants = pickBySplit<[string, Fact]>(
		{ ...c, k: v },
		[
			[
				`山田さんの業務は${S.name}に依存している。`,
				subject("depends_on", depends(S)),
			],
			[
				`山田さんは${S.name}を担当している。`,
				subject("responsible_for", entityValue(S)),
			],
			[
				`山田さんの担当範囲は${S.name}に依存している。`,
				subject("depends_on", depends(S)),
			],
			[
				`山田さんは${S.name}を日常的に担当している。`,
				subject("responsible_for", entityValue(S)),
			],
			[
				`山田さんの業務は${S2.name}に依存している。`,
				subject("depends_on", depends(S2)),
			],
		],
		[
			[
				`山田さんの部署では${S.name}を前提に作業しています。`,
				subject("depends_on", depends(S)),
			],
			[
				`${S.name}の管理者は山田さんです。`,
				subject("responsible_for", entityValue(S)),
			],
			[
				`山田さんのチームは${S.name}なしでは仕事が進みません。`,
				subject("depends_on", depends(S)),
			],
			[
				`山田さんが${S.name}の担当に就いています。`,
				subject("responsible_for", entityValue(S)),
			],
			[
				`山田さんの案件は${S2.name}を使って進めています。`,
				subject("depends_on", depends(S2)),
			],
		],
	);
	const [text, fact] = variants;
	return single(text, (q) =>
		hold("unresolved_subject", [ref("asserted", candidate(fact, q))]),
	);
}

function sameName(c: Ctx): Draft {
	const { S } = c;
	const v = Math.floor(c.k / 2);
	const tanaka1 = { id: "ent-tanaka-1", name: "田中太郎" };
	const tanaka2 = { id: "ent-tanaka-2", name: "田中花子" };
	const resp = (who: Thing): Fact => ({
		subject: subjectOf(who),
		predicate: "responsible_for",
		payload: entityValue(S),
	});
	const dep = (who: Thing): Fact => ({
		subject: subjectOf(who),
		predicate: "depends_on",
		payload: depends(S),
	});
	const at = <T>(dev: readonly T[], holdout: readonly T[]): T =>
		(c.split === "dev" ? dev : holdout)[v]!;
	if (c.k % 2 === 0) {
		const [text, fact] = at<[string, Fact]>(
			[
				[`${tanaka1.name}さんは${S.name}を担当している。`, resp(tanaka1)],
				[`${tanaka2.name}さんは${S.name}を担当している。`, resp(tanaka2)],
				[`${tanaka1.name}さんの業務は${S.name}に依存している。`, dep(tanaka1)],
				[`${tanaka2.name}さんの業務は${S.name}に依存している。`, dep(tanaka2)],
				[`${tanaka2.name}さんは${S.name}の担当者だ。`, resp(tanaka2)],
			],
			[
				[
					`${S.name}を受け持っているのは${tanaka1.name}さんです。`,
					resp(tanaka1),
				],
				[`${S.name}の運用は${tanaka2.name}さんが行っています。`, resp(tanaka2)],
				[
					`${tanaka1.name}さんの仕事は${S.name}がないと成り立ちません。`,
					dep(tanaka1),
				],
				[
					`${S.name}がなければ${tanaka2.name}さんの作業は止まります。`,
					dep(tanaka2),
				],
				[`${tanaka1.name}さんが${S.name}の責任者です。`, resp(tanaka1)],
			],
		);
		return {
			...single(text, (q) => adopt(candidate(fact, q))),
			entitySet: "sameName",
		};
	}
	const tanaka = { kind: "alias", text: "田中" } as const;
	const [text, fact] = at<[string, Fact]>(
		[
			[
				`田中さんは${S.name}を担当している。`,
				{ ...resp(tanaka1), subject: tanaka },
			],
			[
				`田中さんは${S.name}を毎日確認している。`,
				{ ...resp(tanaka2), subject: tanaka },
			],
			[
				`田中さんの業務は${S.name}に依存している。`,
				{ ...dep(tanaka1), subject: tanaka },
			],
			[
				`田中さんの担当範囲は${S.name}に依存している。`,
				{ ...dep(tanaka2), subject: tanaka },
			],
			[
				`田中さんは${S.name}の担当者だ。`,
				{ ...resp(tanaka2), subject: tanaka },
			],
		],
		[
			[
				`${S.name}を引き受けているのは田中さんです。`,
				{ ...resp(tanaka1), subject: tanaka },
			],
			[
				`田中さんが${S.name}の状況を毎朝チェックしています。`,
				{ ...resp(tanaka2), subject: tanaka },
			],
			[
				`田中さんの仕事は${S.name}がないと回りません。`,
				{ ...dep(tanaka1), subject: tanaka },
			],
			[
				`${S.name}が止まると田中さんの作業も止まります。`,
				{ ...dep(tanaka2), subject: tanaka },
			],
			[
				`田中さんが${S.name}の責任を負っています。`,
				{ ...resp(tanaka2), subject: tanaka },
			],
		],
	);
	return {
		...single(text, (q) =>
			hold("ambiguous_subject", [ref("asserted", candidate(fact, q))]),
		),
		entitySet: "sameName",
	};
}

const utc = (year: number, month: number, day = 1) =>
	Date.UTC(year, month - 1, day);
const monthBound = (year: number, month: number) => ({
	earliest: utc(year, month),
	latest: utc(year, month + 1),
});

function period(c: Ctx): Draft {
	const { S } = c;
	const m = (c.n % 9) + 1;
	const day = (c.n % 27) + 1;
	const year = 2020 + (c.n % 6);
	const v = c.k % 5;
	const dev = c.split === "dev";
	let text: string;
	let phrase: string;
	let validTime: GoldValidTime;
	if (v === 0) {
		phrase = dev ? `2026年${m}月から` : `2026年${m}月以降`;
		text = dev
			? `${S.name}は${phrase}使える。`
			: `${S.name}は${phrase}、利用できます。`;
		validTime = {
			precision: "month",
			original: phrase,
			start: monthBound(2026, m),
		};
	} else if (v === 1) {
		phrase = dev ? `2026年${m + 2}月まで` : `2026年${m + 2}月末まで`;
		text = dev
			? `${S.name}は${phrase}使える。`
			: `${S.name}の提供期間は${phrase}です。`;
		validTime = {
			precision: "month",
			original: phrase,
			end: monthBound(2026, m + 3),
		};
	} else if (v === 2) {
		phrase = `2026年${m}月から2026年${m + 2}月まで`;
		text = dev
			? `${S.name}は${phrase}使える。`
			: `${S.name}を使える期間は、${phrase}です。`;
		validTime = {
			precision: "month",
			original: phrase,
			start: monthBound(2026, m),
			end: monthBound(2026, m + 3),
		};
	} else if (v === 3) {
		phrase = dev ? `2026年${m}月${day}日から` : `2026年${m}月${day}日付`;
		text = dev
			? `${S.name}は${phrase}使える。`
			: `${S.name}は${phrase}で利用可能になります。`;
		validTime = {
			precision: "day",
			original: phrase,
			start: { earliest: utc(2026, m, day), latest: utc(2026, m, day + 1) },
		};
	} else {
		phrase = dev ? `${year}年から` : `${year}年`;
		text = dev
			? `${S.name}は${phrase}使える。`
			: `${S.name}の利用開始は${phrase}です。`;
		validTime = {
			precision: "year",
			original: phrase,
			start: { earliest: utc(year, 1), latest: utc(year + 1, 1) },
		};
	}
	return single(text, (q) => adopt(candidate(avail(S), q, { validTime })));
}

function conditionMismatch(c: Ctx): Draft {
	const { S, num } = c;
	const cmp = (key: string, value: object): GoldCondition => ({
		kind: "expression",
		expression: { kind: "compare", key, op: "eq", value },
	});
	const yes = { kind: "boolean", value: true };
	const [text, fact, condition] = pickBySplit<[string, Fact, GoldCondition]>(
		c,
		[
			[
				`${S.name}はWi-Fiに接続している間だけ使える。`,
				avail(S),
				cmp("wifi_connected", yes),
			],
			[
				`${S.name}は登録ユーザーなら使える。`,
				avail(S),
				cmp("registered_user", yes),
			],
			[
				`${S.name}は夜間のみ、応答時間が${num}ミリ秒になる。`,
				latency(S, num),
				cmp("time_of_day", { kind: "string", value: "night" }),
			],
			[
				`${S.name}は管理者の許可がある場合に限り使える。`,
				avail(S),
				cmp("admin_permission", yes),
			],
			[
				`${S.name}はプレミアムプランでのみ使える。`,
				avail(S),
				cmp("plan", { kind: "string", value: "premium" }),
			],
		],
		[
			[
				`${S.name}は社内ネットワークにつながっている場合のみ利用できます。`,
				avail(S),
				cmp("intranet_connected", yes),
			],
			[
				`${S.name}は契約済みの利用者であれば使えます。`,
				avail(S),
				cmp("contracted_user", yes),
			],
			[
				`${S.name}の応答時間は、混雑時に限って${num}ミリ秒になります。`,
				latency(S, num),
				cmp("congested", yes),
			],
			[
				`承認が下りた場合にだけ、${S.name}を使えます。`,
				avail(S),
				cmp("approval_granted", yes),
			],
			[
				`${S.name}を使えるのは年間契約のお客様だけです。`,
				avail(S),
				cmp("contract", { kind: "string", value: "annual" }),
			],
		],
	);
	return single(text, (q) => adopt(candidate(fact, q, { condition })));
}

function multiEvidence(c: Ctx): Draft {
	const { S, S2, P, num } = c;
	const dev = c.split === "dev";
	const decoys = dev ? devDecoys : holdoutDecoys;
	const facts: [string, Fact][] = dev
		? [
				[`${S.name}は問題なく使える。`, avail(S)],
				[`${S.name}の応答時間は${num}ミリ秒だ。`, latency(S, num)],
				[`${S.name}は${S2.name}に強く依存している。`, dependsOn(S, S2)],
				[`${S.name}の担当は${P.name}さんだ。`, owner(S, P)],
			]
		: [
				[`${S.name}は支障なく利用できる状態にある。`, avail(S)],
				[`${S.name}の応答時間は${num}ミリ秒になっている。`, latency(S, num)],
				[`${S.name}の動作は${S2.name}に大きく左右される。`, dependsOn(S, S2)],
				[`${S.name}の責任者は${P.name}さんになっている。`, owner(S, P)],
			];
	const [claim, fact] = facts[c.k % 4]!;
	if (c.k % 2 === 0) {
		const at = Math.floor(c.k / 2) % 3;
		const texts = [0, 1, 2].map((i) =>
			i === at ? claim : decoys[(c.n + i) % decoys.length]!,
		);
		return {
			texts,
			gold: (u) => adopt(candidate(fact, quoteOf(u, at, claim))),
		};
	}
	const second = dev
		? `${claim.slice(0, -1)}と確認できる。`
		: `${claim.slice(0, -1)}とのことである。`;
	const support = dev ? `記録でも、${second}` : `資料の記載によれば、${second}`;
	return {
		texts: [claim, support],
		origins: ["user_report", "document_claim"],
		gold: (u) =>
			adopt(
				candidate(fact, quoteOf(u, 0, claim), {
					altQuotes: [quoteOf(u, 1, second)],
				}),
			),
	};
}

function correction(c: Ctx): Draft {
	const { S, S2, P, P2, num, alt } = c;
	const v = c.k % 5;
	const dev = c.split === "dev";
	if (v === 0) {
		const fixed = dev
			? `${S.name}の応答時間は${alt}ミリ秒に訂正します。`
			: `${S.name}の応答時間は正しくは${alt}ミリ秒です。`;
		return {
			texts: dev
				? [`${S.name}の応答時間は${num}ミリ秒です。`, `すみません、${fixed}`]
				: [
						`${S.name}の応答時間は${num}ミリ秒に設定されています。`,
						`数値を間違えていました。${fixed}`,
					],
			gold: (u) => adopt(candidate(latency(S, alt), quoteOf(u, 1, fixed))),
		};
	}
	if (v === 1) {
		const fixed = dev
			? `${S.name}の担当は${P2.name}さんでした。`
			: `${S.name}の運用は${P2.name}さんが行っています。`;
		return {
			texts: dev
				? [`${S.name}の担当は${P.name}さんです。`, `訂正です。${fixed}`]
				: [
						`${S.name}の運用は${P.name}さんが行っています。`,
						`申し訳ありません、間違いでした。${fixed}`,
					],
			gold: (u) => adopt(candidate(owner(S, P2), quoteOf(u, 1, fixed))),
		};
	}
	if (v === 2) {
		const fixed = dev
			? `${S.name}は使えないことが分かった。`
			: `${S.name}は利用できないと判明しました。`;
		return {
			texts: dev
				? [`${S.name}は使える。`, `いや、${fixed}`]
				: [`${S.name}は利用できます。`, `前言を撤回します。${fixed}`],
			gold: (u) => adopt(candidate(avail(S, false), quoteOf(u, 1, fixed))),
		};
	}
	if (v === 3) {
		const old = things[(c.n * 3 + 7 + Math.floor(c.n / 10)) % things.length]!;
		const fixed = dev
			? `${S.name}は${S2.name}に依存している。`
			: `${S.name}が依存しているのは${S2.name}です。`;
		return {
			texts: dev
				? [`${S.name}は${old.name}に依存している。`, `訂正します。${fixed}`]
				: [
						`${S.name}は${old.name}に依存しています。`,
						`誤りがありました。${fixed}`,
					],
			gold: (u) => adopt(candidate(dependsOn(S, S2), quoteOf(u, 1, fixed))),
		};
	}
	const first = dev
		? `${S.name}の担当は${P.name}さんです。`
		: `${S.name}の運用は${P.name}さんが行っています。`;
	return {
		texts: [
			first,
			dev
				? `さっきの${S.name}の担当の話は忘れてください。`
				: `${S.name}の運用に関する先ほどの発言は、なかったことにしてください。`,
		],
		gold: () => hold("forgotten", []),
		forgotten: (u) => ({
			utteranceIds: [u[0]!.utteranceId],
			claim: candidate(owner(S, P), quoteOf(u, 0, first)),
		}),
	};
}

function ordinary(c: Ctx): Draft {
	const { S, S2, P, num } = c;
	const dev = c.split === "dev";
	const v = c.k % 5;
	if (v === 4) {
		const s = dev
			? `${S.name}は使えますか？`
			: `${S.name}は今すぐ使えるのでしょうか？`;
		return single(
			c.prefix + s,
			(q) => hold("question", [ref("question", candidate(avail(S), q))]),
			s,
		);
	}
	const variants: [string, Fact][] = dev
		? [
				[`${S.name}は使える。`, avail(S)],
				[`${S.name}の応答時間は${num}ミリ秒だ。`, latency(S, num)],
				[`${S.name}は${S2.name}に依存している。`, dependsOn(S, S2)],
				[`${S.name}の担当は${P.name}さんだ。`, owner(S, P)],
			]
		: [
				[`${S.name}は現在も問題なく動いています。`, avail(S)],
				[
					`${S.name}の応答時間を測ったところ${num}ミリ秒でした。`,
					latency(S, num),
				],
				[`${S.name}の動作は${S2.name}を前提としています。`, dependsOn(S, S2)],
				[`${S.name}を担当しているのは${P.name}さんです。`, owner(S, P)],
			];
	const [s, fact] = variants[v]!;
	return single(c.prefix + s, (q) => adopt(candidate(fact, q)), s);
}

const builders: Readonly<Record<Group, (c: Ctx) => Draft>> = {
	negation,
	hypothesis,
	hearsay,
	"other-person": otherPerson,
	"same-name": sameName,
	period,
	"condition-mismatch": conditionMismatch,
	"multi-evidence": multiEvidence,
	correction,
	ordinary,
};

const pad = (n: number) => String(n).padStart(2, "0");

export function buildCases(): EvalCase[] {
	const cases: EvalCase[] = [];
	for (const group of groups) {
		for (const split of splits) {
			for (let k = 0; k < casesPerGroupPerSplit; k++) {
				const draft = builders[group](makeCtx(k, split));
				const utterances: EvalUtterance[] = draft.texts.map((text, i) => ({
					utteranceId: `u-${i + 1}`,
					text,
					origin: draft.origins?.[i] ?? "user_report",
				}));
				const forgotten = draft.forgotten?.(utterances);
				cases.push({
					caseId: `ext-v2-${group}-${split}-${pad(k + 1)}`,
					group,
					split,
					entitySet: draft.entitySet ?? "base",
					utterances,
					...(forgotten === undefined ? {} : { forgotten }),
					gold: draft.gold(utterances),
				});
			}
		}
	}
	return cases;
}

export function buildDataset(): Dataset {
	return {
		version: DATASET_VERSION,
		scope: { principal: "eval-user", scopeKey: "eval-main" },
		foreignScope: { principal: "eval-user", scopeKey: "eval-other" },
		predicates,
		entitySets: { base: baseEntities, sameName: sameNameEntities },
		foreignEntities,
		cases: buildCases(),
	};
}

if (import.meta.main) {
	const dataset = buildDataset();
	const target = new URL("./dataset.v2.json", import.meta.url);
	writeFileSync(
		target,
		`${JSON.stringify(JSON.parse(stableStringify(dataset)), null, "\t")}\n`,
	);
	console.log(`written ${dataset.cases.length} cases`);
	console.log(`DATASET_SHA256 ${datasetDigest(dataset)}`);
}
