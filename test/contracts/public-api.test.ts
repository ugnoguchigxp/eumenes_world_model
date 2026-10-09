import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import * as api from "../../src/index.ts";
import { input as assertionInput } from "../../src/domains/assertions/test/helpers.ts";
import {
	A,
	NOW,
	rec,
	sliceInput,
	snapshot,
	state,
} from "../../src/domains/projection/test/helpers.ts";
import { walk } from "../../scripts/files.ts";

const root = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const fixture = JSON.parse(read("fixtures/world-v1/cases.json"));
const executable = JSON.parse(read("fixtures/world-v1/executable.json"));
const sha: api.CanonicalHasher = (b) =>
	createHash("sha256").update(b).digest("hex");

describe("P1-11 public surface", () => {
	test("the public value surface is an explicit allowlist (no internal parsers)", () => {
		const contracts = [
			"CANONICAL_VERSION",
			"WORLD_CONTRACT_VERSION",
			"asRecord",
			"canonicalBytes",
			"canonicalDigest",
			"checkBoolean",
			"checkContractVersion",
			"checkDependentRef",
			"checkDigest",
			"checkEpochMs",
			"checkFiniteNumber",
			"checkId",
			"checkOpaque",
			"checkOperationKey",
			"checkPredicate",
			"checkRevision",
			"checkSafeInteger",
			"checkScope",
			"checkTypedValue",
			"checkVersionString",
			"citedBytes",
			"compareDependentRef",
			"dependentKey",
			"dependentKinds",
			"fail",
			"failureCodes",
			"firstUnknownKey",
			"isWellFormed",
			"limits",
			"ok",
			"sameScope",
			"utf8Length",
		];
		const operations = [
			"and3",
			"assessFreshness",
			"assessOutcome",
			"buildProjection",
			"buildWorldSlice",
			"checkDependencies",
			"compareGaps",
			"compareScenarios",
			"compareValidity",
			"evaluateConditions",
			"explainRelevance",
			"findResearchGaps",
			"groupEvidenceRoots",
			"normalizeAlias",
			"not3",
			"or3",
			"planAssertionTransition",
			"planForget",
			"planInvalidation",
			"planMerge",
			"planSplit",
			"prepareExtraction",
			"resolveEntity",
			"terminalLifecycles",
			"toSliceReceipt",
			"traceInfluence",
			"transitionTable",
			"validateAssertion",
			"validateCandidate",
			"validateCandidates",
			"validateSliceUsage",
		];
		expect(Object.keys(api).sort()).toEqual(
			[...contracts, ...operations].sort(),
		);
		for (const name of operations)
			expect(typeof (api as Record<string, unknown>)[name]).not.toBe(
				"undefined",
			);
		// No SQL, host entry or internal composition helper leaks through.
		for (const name of Object.keys(api))
			expect(name).not.toMatch(
				/^(applyWorldOperation|readWorldSnapshot|migrations|planScopeEpoch|composeEffect|edgesFromEntries|checkGraphInput|checkStates|checkWindow|checkConditions)$/,
			);
	});
	test("every versioned public input accepts v1 and rejects v2 as UNSUPPORTED_CONTRACT_VERSION", () => {
		const slice = api.buildWorldSlice(sliceInput([rec("a1")]), sha);
		if (!slice.ok) throw new Error("slice");
		const receipt = api.toSliceReceipt(slice.value);
		const graph = {
			scope: A,
			authorized: true,
			asOf: NOW,
			maxAgeMs: 60_000,
			observations: [],
			edges: [],
			entityId: "X",
		};
		const outcomeConditions = {
			subjectId: "svc",
			metric: "latency",
			unit: "ms",
			statistic: "p95",
			configuration: "c",
			inputProfile: "p",
		};
		// resolveEntity/planMerge/planSplit carry no contractVersion field today
		// (identity inputs are version-less); they are not part of this table.
		const cases: [string, (version: number) => unknown][] = [
			[
				"evaluateConditions",
				(v) =>
					api.evaluateConditions({
						contractVersion: v,
						asOf: NOW,
						authorized: true,
						maxAgeMs: 1000,
						observations: [],
					}),
			],
			[
				"compareValidity",
				(v) =>
					api.compareValidity({
						contractVersion: v,
						validTime: { kind: "instant", at: NOW },
						asOf: NOW,
					}),
			],
			[
				"planForget",
				(v) =>
					api.planForget({
						contractVersion: v,
						scope: A,
						roots: [{ kind: "source", id: "s1", revision: 1 }],
						edges: [],
						budget: 10,
					}),
			],
			[
				"planInvalidation",
				(v) =>
					api.planInvalidation({
						contractVersion: v,
						scope: A,
						roots: [{ kind: "source", id: "s1", revision: 1 }],
						edges: [],
						budget: 10,
					}),
			],
			[
				"planAssertionTransition",
				(v) =>
					api.planAssertionTransition({
						contractVersion: v,
						scope: A,
						current: {
							id: "claim-1",
							revision: 3,
							scope: A,
							lifecycle: "candidate",
							origin: "user_report",
						},
						expectedRevision: 3,
						request: {
							action: "adopt",
							adoption: { kind: "rule", ruleId: "rule-1" },
							subjectConfirmedByHost: true,
						},
						registeredAdoptionRules: ["rule-1"],
					}),
			],
			[
				"validateAssertion",
				(v) =>
					api.validateAssertion(
						{ ...assertionInput(), contractVersion: v },
						sha,
					),
			],
			[
				"groupEvidenceRoots",
				(v) => api.groupEvidenceRoots({ contractVersion: v, evidence: [] }),
			],
			[
				"buildProjection",
				(v) =>
					api.buildProjection(
						{ contractVersion: v, snapshot: snapshot([rec("a1")]) },
						sha,
					),
			],
			[
				"buildWorldSlice",
				(v) =>
					api.buildWorldSlice(
						{ ...sliceInput([rec("a1")]), contractVersion: v },
						sha,
					),
			],
			[
				"validateSliceUsage",
				(v) =>
					api.validateSliceUsage({
						contractVersion: v,
						receipt,
						current: {
							scope: A,
							authorized: true,
							worldEnabled: true,
							scopeEpoch: 7,
							policyRevision: "policy-1",
							forgetEpoch: "forget-1",
							restoreEpoch: "restore-1",
							interpretationVersion: "interp-1",
							assertions: [{ id: "a1", revision: 1, lifecycle: "active" }],
							sources: [state()],
						},
					}),
			],
			[
				"explainRelevance",
				(v) => api.explainRelevance({ ...graph, contractVersion: v }),
			],
			[
				"traceInfluence",
				(v) =>
					api.traceInfluence({
						...graph,
						contractVersion: v,
						direction: "forward",
					}),
			],
			[
				"checkDependencies",
				(v) => api.checkDependencies({ ...graph, contractVersion: v }),
			],
			[
				"findResearchGaps",
				(v) => {
					const { entityId: _entityId, ...noEntity } = graph;
					return api.findResearchGaps({ ...noEntity, contractVersion: v });
				},
			],
			[
				"compareScenarios",
				(v) =>
					api.compareScenarios({
						...graph,
						contractVersion: v,
						direction: "forward",
						overlays: [
							{ overlayId: "A", addEdges: [], removeEdgeIds: [] },
							{ overlayId: "B", addEdges: [], removeEdgeIds: [] },
						],
					}),
			],
			[
				"assessOutcome",
				(v) =>
					api.assessOutcome({
						contractVersion: v,
						scope: A,
						prediction: {
							kind: "quantitative",
							predictionId: "p1",
							revision: 1,
							comparisonId: "c1",
							conditions: outcomeConditions,
							baselineRef: "b1",
							baselineValue: 100,
							expectedWindow: { startMs: NOW, endMs: NOW + 1000 },
							expectedDirection: "decreases",
							measurementTolerance: 2,
							origin: "user_report",
							intervention: "i",
						},
						observations: [],
					}),
			],
			[
				"prepareExtraction",
				(v) =>
					api.prepareExtraction({
						contractVersion: v,
						scope: A,
						utterances: [],
						sources: { states: [] },
					}),
			],
			[
				"validateCandidates",
				(v) =>
					api.validateCandidates(
						{
							contractVersion: v,
							scope: A,
							window: [],
							manifest: { dependencies: [] },
							sources: { states: [] },
							entities: [],
							assigned: {
								recordedAt: NOW,
								interpretationVersion: "i1",
								freshnessMaxAgeMs: 1000,
								items: [],
							},
							modelOutput: { candidates: [] },
						},
						sha,
					),
			],
		];
		const code = (r: unknown) => {
			const x = r as {
				ok?: boolean;
				code?: string;
				status?: string;
				reasonCode?: string;
			};
			return x.ok === false
				? x.code
				: x.status === "rejected"
					? x.reasonCode
					: "ACCEPTED";
		};
		for (const [name, call] of cases) {
			expect([name, code(call(2))]).toEqual([
				name,
				"UNSUPPORTED_CONTRACT_VERSION",
			]);
			expect([name, code(call(1))]).not.toEqual([
				name,
				"UNSUPPORTED_CONTRACT_VERSION",
			]);
			// The valid shape must really be valid (version is the only varying part).
			const ok1 = call(1) as { ok?: boolean };
			expect([name, ok1.ok !== false]).toEqual([name, true]);
		}
	});
	test("A02 executable fixture: same meaning -> same digest; order -> different", () => {
		const c = executable.canonical;
		const d = (v: unknown) => api.canonicalDigest(v, sha);
		expect(d(c.a)).toEqual(d(c.sameMeaning));
		expect(d(c.a)).not.toEqual(d(c.differentOrder));
	});
	test("A04 executable fixture: NOT table", () => {
		for (const [input, expected] of executable.tri.not)
			expect(api.not3(input)).toBe(expected);
	});
});

describe("A01-A20 coverage index", () => {
	test("every case id has an existing test file whose source names the id", () => {
		expect(fixture.cases.map((c: { caseId: string }) => c.caseId)).toEqual(
			Array.from(
				{ length: 20 },
				(_, i) => `A${String(i + 1).padStart(2, "0")}`,
			),
		);
		for (const c of fixture.cases) {
			const source = read(c.test);
			expect(source).toMatch(new RegExp(`${c.caseId}([^0-9]|$)`));
			expect(source).toMatch(/\btest(\.each)?\(/);
		}
	});
	test("no domain test directory is empty", () => {
		for (const domain of readdirSync(resolve(root, "src/domains"))) {
			const tests = walk(resolve(root, "src/domains", domain)).filter((f) =>
				f.endsWith(".test.ts"),
			);
			expect(tests.length).toBeGreaterThan(0);
		}
	});
});
