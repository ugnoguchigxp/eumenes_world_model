/**
 * P4-05.a (N01): the entity supply contract. Unit checks classify small
 * synthetic datasets (the frozen ext-ja-v2 dataset is never modified), and
 * one runner-level check runs the fixture provider over the dev split to
 * show the manifest, its digest and the summary agree with what was
 * actually sent. Deterministic: no model, no network.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	loadDataset,
	stableStringify,
	type Dataset,
	type DatasetEntity,
	type EvalCase,
	type Gold,
	type SubjectQuery,
} from "../../eval/extraction/dataset.ts";
import { createFixtureProvider } from "../../eval/extraction/fixture-provider.ts";
import {
	runEvaluation,
	type ExtractionProvider,
	type ProviderRequest,
	type ProviderResponse,
} from "../../eval/extraction/runner.ts";
import {
	buildSupplyManifest,
	classifySupply,
	summarizeSupply,
	supplyClasses,
	visibleRequestOf,
} from "../../eval/extraction/supply.ts";

const entity = (
	id: string,
	displayName: string,
	aliases: readonly string[] = [],
	revision = 1,
): DatasetEntity => ({ id, revision, displayName, aliases, externalRefs: [] });

const baseEntities = [
	entity("ent-a", "田中", ["タナカ"], 3),
	entity("ent-b", "佐藤", [], 1),
];
const sameNameEntities = [
	entity("ent-t1", "田中一郎", ["田中"], 2),
	entity("ent-t2", "田中二郎", ["田中"], 5),
];

const adoptGold = (subject: SubjectQuery): Gold => ({
	outcome: "adopt",
	treatment: "asserted",
	candidate: {
		subject,
		predicate: "likes",
		payload: { kind: "value", value: { kind: "string", value: "x" } },
		quote: { utteranceId: "u1", startCp: 0, endCp: 1 },
		condition: { kind: "unspecified" },
	},
	reference: [],
});
const holdGold = (
	reason: Extract<Gold, { outcome: "hold" }>["reason"],
	subject?: SubjectQuery,
): Gold => ({
	outcome: "hold",
	reason,
	reference:
		subject === undefined
			? []
			: [
					{
						modality: "negated",
						candidate: {
							subject,
							predicate: "likes",
							payload: {
								kind: "value",
								value: { kind: "string", value: "x" },
							},
							quote: { utteranceId: "u1", startCp: 0, endCp: 1 },
							condition: { kind: "unspecified" },
						},
					},
				],
});

const syntheticCase = (
	entitySet: EvalCase["entitySet"],
	gold: Gold,
): EvalCase => ({
	caseId: "synthetic-1",
	group: "ordinary",
	split: "dev",
	entitySet,
	utterances: [{ utteranceId: "u1", text: "x", origin: "user_report" }],
	gold,
});

const syntheticDataset = (cases: readonly EvalCase[]): Dataset => ({
	version: "synthetic-v0",
	scope: { principal: "p", scopeKey: "s" },
	foreignScope: { principal: "other", scopeKey: "s" },
	predicates: ["likes"],
	entitySets: { base: baseEntities, sameName: sameNameEntities },
	foreignEntities: [entity("ent-foreign", "他人")],
	cases,
});

describe("classifySupply", () => {
	test("adopt with the subject id supplied is supplied", () => {
		const tc = syntheticCase("base", adoptGold({ kind: "id", id: "ent-a" }));
		expect(classifySupply(syntheticDataset([tc]), tc)).toBe("supplied");
	});

	test("adopt with the subject id missing is a supply shortage", () => {
		const tc = syntheticCase(
			"base",
			adoptGold({ kind: "id", id: "ent-foreign" }),
		);
		expect(classifySupply(syntheticDataset([tc]), tc)).toBe(
			"gold_not_supplied",
		);
	});

	test("alias subject matching exactly one entity is supplied", () => {
		const byAlias = syntheticCase(
			"base",
			adoptGold({ kind: "alias", text: "タナカ" }),
		);
		expect(classifySupply(syntheticDataset([byAlias]), byAlias)).toBe(
			"supplied",
		);
		const byName = syntheticCase(
			"base",
			adoptGold({ kind: "alias", text: "佐藤" }),
		);
		expect(classifySupply(syntheticDataset([byName]), byName)).toBe("supplied");
	});

	test("alias subject matching nothing is a supply shortage", () => {
		const tc = syntheticCase(
			"base",
			adoptGold({ kind: "alias", text: "鈴木" }),
		);
		expect(classifySupply(syntheticDataset([tc]), tc)).toBe(
			"gold_not_supplied",
		);
	});

	test("alias subject matching two entities is ambiguous supply", () => {
		const tc = syntheticCase(
			"sameName",
			adoptGold({ kind: "alias", text: "田中" }),
		);
		expect(classifySupply(syntheticDataset([tc]), tc)).toBe("ambiguous_supply");
	});

	test("unresolved and ambiguous holds are intended holds", () => {
		for (const reason of ["unresolved_subject", "ambiguous_subject"] as const) {
			const tc = syntheticCase(
				"sameName",
				holdGold(reason, { kind: "alias", text: "田中" }),
			);
			expect(classifySupply(syntheticDataset([tc]), tc)).toBe("intended_hold");
		}
	});

	test("other holds are classified by their reference subject", () => {
		const supplied = syntheticCase(
			"base",
			holdGold("negated", { kind: "id", id: "ent-a" }),
		);
		expect(classifySupply(syntheticDataset([supplied]), supplied)).toBe(
			"supplied",
		);
		const missing = syntheticCase(
			"base",
			holdGold("negated", { kind: "id", id: "ent-foreign" }),
		);
		expect(classifySupply(syntheticDataset([missing]), missing)).toBe(
			"gold_not_supplied",
		);
	});
});

describe("buildSupplyManifest", () => {
	test("records revisions, scope, no cap and the request digest", () => {
		const tc = syntheticCase("base", adoptGold({ kind: "id", id: "ent-a" }));
		const dataset = syntheticDataset([tc]);
		const manifest = buildSupplyManifest(dataset, tc);
		expect(manifest.datasetVersion).toBe("synthetic-v0");
		expect(manifest.entitySet).toBe("base");
		expect(manifest.supplied).toEqual([
			{ id: "ent-a", revision: 3 },
			{ id: "ent-b", revision: 1 },
		]);
		expect(manifest.suppliedCount).toBe(2);
		expect(manifest.limit).toBeNull();
		expect(manifest.truncated).toBe(false);
		expect(manifest.scope).toEqual({ principal: "p", scopeKey: "s" });
		const digest = createHash("sha256")
			.update(stableStringify(visibleRequestOf(dataset, tc)))
			.digest("hex");
		expect(manifest.requestDigest).toBe(digest);
		// Foreign entities are validator-only: never supplied to the model.
		expect(manifest.supplied.map((e) => e.id)).not.toContain("ent-foreign");
	});
});

describe("summarizeSupply", () => {
	const evaluation = (matched: boolean) => ({
		caseId: "c",
		group: "ordinary" as const,
		status: "ok" as const,
		accepted: matched ? 1 : 0,
		correctAdopted: matched ? 1 : 0,
		wrongAdopted: 0,
		adoptExpected: true,
		adoptedCorrectly: matched,
		holdExpected: false,
		heldCorrectly: false,
		classification: null,
		classificationCorrect: false,
		violations: [],
		mismatches: [],
	});

	test("only supplied failures are model-attributable", () => {
		const summary = summarizeSupply([
			{
				supplyClass: "supplied",
				status: "timeout",
				evaluation: evaluation(false),
			},
			{
				supplyClass: "supplied",
				status: "ok",
				evaluation: evaluation(true),
			},
			{
				supplyClass: "gold_not_supplied",
				status: "error",
				evaluation: evaluation(false),
			},
			{
				supplyClass: "intended_hold",
				status: "ok",
				evaluation: evaluation(false),
			},
		]);
		expect(summary.counts).toEqual({
			supplied: 2,
			gold_not_supplied: 1,
			intended_hold: 1,
			ambiguous_supply: 0,
		});
		expect(summary.modelAttributableFailures).toBe(1);
	});
});

describe("runner supply wiring (fixture, dev split)", () => {
	test("samples carry manifests and the summary sums to the case count", async () => {
		const dataset = loadDataset();
		const seen: ProviderRequest[] = [];
		const inner = createFixtureProvider(dataset, "oracle");
		const recording: ExtractionProvider = {
			info: inner.info,
			extract(
				request: ProviderRequest,
				signal: AbortSignal,
			): Promise<ProviderResponse> {
				seen.push(request);
				return inner.extract(request, signal);
			},
		};
		const report = await runEvaluation({
			dataset,
			provider: recording,
			split: "dev",
			mode: "tuning",
			promptVersion: "supply-test",
		});
		expect(report.samples.length).toBe(100);
		expect(seen.length).toBe(100);
		for (const sample of report.samples) {
			expect(sample.supply.datasetVersion).toBe(dataset.version);
			expect(sample.supply.suppliedCount).toBeGreaterThan(0);
			expect(sample.supply.limit).toBeNull();
			expect(sample.supply.truncated).toBe(false);
			expect(supplyClasses).toContain(sample.supplyClass);
		}
		// The recorded digest is over exactly what the provider was sent.
		for (const [index, sample] of report.samples.entries()) {
			const request = seen[index]!;
			const visible = {
				window: request.window,
				entities: request.entities,
				predicates: request.predicates,
			};
			expect(sample.supply.requestDigest).toBe(
				createHash("sha256").update(stableStringify(visible)).digest("hex"),
			);
		}
		const total = Object.values(report.supplySummary.counts).reduce(
			(n, c) => n + c,
			0,
		);
		expect(total).toBe(report.samples.length);
		// The oracle fixture matches the gold everywhere: no attributable
		// failure can be counted even over the supplied cases.
		expect(report.supplySummary.modelAttributableFailures).toBe(0);
	});
});
