/** Pre-fixed synthetic episodes. References never enter a model request. */
import type { Fact, Job } from "./dataset.ts";

export interface Checkpoint {
	event:
		| "initial"
		| "update"
		| "condition"
		| "observation"
		| "withdraw"
		| "replace"
		| "forget"
		| "late-input";
	job: Job;
	retiredFacts: Fact[];
}
export interface Episode {
	id: string;
	checkpoints: Checkpoint[];
}

export function longitudinalEpisodes(): Episode[] {
	return (
		[
			["booth", "閲覧ブース", "capacity", "person", "定員", "人"],
			["locker", "保管庫", "quota", "count", "保管上限", "個"],
			["room", "実習室", "capacity", "person", "利用上限", "人"],
		] as const
	).map(([id, name, predicate, unit, label, suffix]) => {
		const source = (n: number, text: string) => ({ id: `${id}-s${n}`, text });
		const initial = source(0, `${name}の${label}は10${suffix}。`);
		const update = source(
			1,
			`先の10${suffix}を訂正する。${name}の${label}は12${suffix}。`,
		);
		const condition = source(
			2,
			`${name}の${label}12${suffix}は承認済みの場合だけ適用する。`,
		);
		const withdraw = source(
			3,
			`${name}の${label}について、それまでの記録を撤回する。以前の数値を今後の回答に使わない。`,
		);
		const replacement = source(
			4,
			`撤回後の新しい確認結果として、${name}の${label}は14${suffix}。この値に承認条件はない。`,
		);
		const erased = [initial, update, condition, withdraw, replacement];
		const notice = source(
			5,
			`${name}の${label}に関する過去の資料は忘却済み。現在利用できる数値の記録はない。`,
		);
		const fact = (n: number, s: string): Fact => ({
			subjectId: id!,
			predicate: predicate!,
			modality: "asserted",
			sourceIds: [s],
			payload: {
				kind: "value",
				value: { kind: "number", value: n, unit: unit! },
			},
		});
		const f10 = fact(10, initial.id),
			f12 = fact(12, update.id),
			f14 = fact(14, replacement.id);
		const conditional: Fact = {
			...f12,
			sourceIds: [update.id, condition.id],
			condition: {
				kind: "expression",
				expression: {
					kind: "compare",
					key: "approved",
					op: "eq",
					value: { kind: "boolean", value: true },
				},
			},
		};
		const rows: {
			event: Checkpoint["event"];
			sources: Job["sources"];
			facts: Fact[];
			retired: Fact[];
			approved?: boolean;
			erased?: string[];
		}[] = [
			{ event: "initial", sources: [initial], facts: [f10], retired: [] },
			{
				event: "update",
				sources: [initial, update],
				facts: [f12],
				retired: [f10],
			},
			{
				event: "condition",
				sources: [initial, update, condition],
				facts: [],
				retired: [f10, f12],
			},
			{
				event: "observation",
				sources: [initial, update, condition],
				facts: [conditional],
				retired: [f10],
				approved: true,
			},
			{
				event: "withdraw",
				sources: [initial, update, condition, withdraw],
				facts: [],
				retired: [f10, f12],
			},
			{ event: "replace", sources: erased, facts: [f14], retired: [f10, f12] },
			{
				event: "forget",
				sources: [...erased, notice],
				facts: [],
				retired: [f10, f12, f14],
				erased: erased.map((s) => s.id),
			},
			// Same old source identity arriving after forget; no newly authorized fact.
			{
				event: "late-input",
				sources: [initial, notice],
				facts: [],
				retired: [f10, f12, f14],
				erased: erased.map((s) => s.id),
			},
		];
		return {
			id: id!,
			checkpoints: rows.map((r, i) => ({
				event: r.event,
				retiredFacts: r.retired,
				job: {
					id: `${id}-${i}`,
					split: "evaluation",
					group: "longitudinal",
					purpose: "current",
					entities: [{ id: id!, displayName: name!, aliases: [] }],
					sources: r.sources,
					predicates: [
						{
							name: predicate!,
							meaning: `The subject's maximum permitted quantity; value in ${unit}. Not the observed usage count.`,
							payload: `value:number,unit:${unit}`,
						},
					],
					bindings: [
						{
							key: "approved",
							meaning: "Whether the host confirms approval",
							type: "boolean",
						},
					],
					asOf: 1794000000000 + i * 86400000,
					question: `${name}の現在の${label}はいくつですか。`,
					observations:
						r.approved === undefined
							? []
							: [{ key: "approved", value: r.approved }],
					expected: r.event === "condition" ? [conditional] : r.facts,
					answerFacts: r.facts,
					hold: r.facts.length === 0,
					requiredSources: [...new Set(r.facts.flatMap((f) => f.sourceIds))],
					...(r.erased ? { eraseBeforeRead: r.erased } : {}),
				},
			})),
		};
	});
}
