/** Synthetic first responses and explicit host selections, not model results. */
import type { PipelineCase } from "./types.ts";

export const PIPELINE_NOW = 1_791_500_000_000;
const quote = (id: string, text: string) => ({
	utteranceId: id,
	startByte: 0,
	endByte: Buffer.byteLength(text),
});
const value = (
	subjectId: string,
	predicate: string,
	text: string,
	id: string,
	source: string,
) => ({
	subject: { kind: "id", id: subjectId },
	predicate,
	payload: { kind: "value", value: { kind: "string", value: text } },
	quote: quote(id, source),
	modality: "asserted",
});

function chain(
	id: string,
	names: readonly string[],
	reverse = false,
): PipelineCase {
	const sources = [
		{ id: "s0", text: `${names[0]}の表示色は青。` },
		{ id: "s1", text: `${names[0]}の説明文は公開済み。` },
		{ id: "s2", text: `${names[0]}の利用案内は毎週更新される。` },
		{ id: "s3", text: `${names[0]}の導入窓口は別部署。` },
		{ id: "s4", text: `${names[0]}は${names[1]}に依存する。` },
		{ id: "s5", text: `${names[1]}の担当者は${names[2]}。` },
	];
	const candidates: unknown[] = sources
		.slice(0, 4)
		.map((source, i) =>
			value("entry", `detail-${i}`, source.text, source.id, source.text),
		);
	candidates.push({
		subject: { kind: "id", id: "entry" },
		predicate: "dependency",
		payload: {
			kind: "relation",
			relation: "depends_on",
			object: { kind: "id", id: "backend" },
		},
		quote: quote("s4", sources[4]!.text),
		modality: "asserted",
	});
	candidates.push({
		subject: { kind: "id", id: "backend" },
		predicate: "owner",
		payload: { kind: "value", value: { kind: "entity", entityId: "person" } },
		quote: quote("s5", sources[5]!.text),
		modality: "asserted",
	});
	return {
		id,
		entities: ["entry", "backend", "person"].map((key, i) => ({
			id: key,
			displayName: names[i]!,
			aliases: [],
		})),
		sources: reverse ? [...sources].reverse() : sources,
		rawOutput: { candidates },
		adoptIndexes: [0, 1, 2, 3, 4, 5],
		queries: [
			{
				id: `${id}-chain`,
				asOf: PIPELINE_NOW,
				maxBytes: 4096,
				subjectIds: ["entry"],
				selectedIndexes: [4, 5],
				observations: [],
				expectedEvidenceIds: ["s4", "s5"],
			},
		],
	};
}

const dated: PipelineCase = (() => {
	const boundary = PIPELINE_NOW + 1000;
	const sources = [
		{
			id: "old",
			text: `混雑度load(count)が5以上のとき、定員は10人。有効期間の終了はUTC epoch ms ${boundary}で、終了時点を含まない。`,
		},
		{
			id: "new",
			text: `混雑度load(count)が5以上のとき、定員は12人。有効期間の開始はUTC epoch ms ${boundary}で、開始時点を含む。`,
		},
	];
	return {
		id: "dated-values",
		entities: [{ id: "room", displayName: "会議室", aliases: [] }],
		sources,
		rawOutput: {
			candidates: sources.map((source, i) => ({
				...value(
					"room",
					"capacity",
					i === 0 ? "10人" : "12人",
					source.id,
					source.text,
				),
				condition: {
					kind: "expression",
					expression: {
						kind: "compare",
						key: "load",
						op: "gte",
						value: { kind: "number", value: 5, unit: "count" },
					},
				},
				validTime: {
					kind: "period",
					precision: "exact",
					original: source.text,
					...(i === 0
						? { end: { earliest: boundary, latest: boundary } }
						: { start: { earliest: boundary, latest: boundary } }),
				},
			})),
		},
		adoptIndexes: [0, 1],
		queries: [PIPELINE_NOW, boundary].map((asOf, i) => ({
			id: `time-${i}`,
			asOf,
			maxBytes: 8192,
			subjectIds: ["room"],
			selectedIndexes: [i],
			observations: [
				{
					observationId: "load-1",
					key: "load",
					value: { kind: "number", value: 6, unit: "count" },
					observedAt: PIPELINE_NOW - 1,
					version: "1",
					priority: 1,
				},
			],
			expectedEvidenceIds: [sources[i]!.id],
		})),
	};
})();

export const pipelineCases: readonly PipelineCase[] = [
	chain("service-chain", ["検索API", "索引API", "佐藤"]),
	chain("warehouse-chain", ["出荷端末", "在庫台帳", "管理担当"], true),
	chain("observatory-chain", ["観測装置Ω", "集計器Λ", "運用当番"]),
	dated,
];
