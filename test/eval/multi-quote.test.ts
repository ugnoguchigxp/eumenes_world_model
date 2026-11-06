import { expect, test } from "bun:test";
import { loadQuality } from "../../eval/api-quality/dataset.ts";
import { replay } from "../../eval/api-quality/pipeline.ts";
import { matches } from "../../eval/api-quality/scoring.ts";
import { decodeTypedCandidates } from "../../eval/api/typed-wire.ts";
import {
	extractionLimits,
	buildWorldSlice,
	toSliceReceipt,
	planAssertionTransition,
	sourceIdentityKey,
} from "../../src/index.ts";
import {
	applyWorldOperation,
	readWorldSnapshot,
	validateWorldUsage,
	type WorldOperation,
} from "../../src/sqlite.ts";
import { openTestStore } from "../support/sqlite-store.ts";
import { hasher } from "../scenario/world-fixture.ts";

function fixture() {
	const c = loadQuality("independent").find((c) => c.id === "I-lifecycle-09")!,
		f = c.expected[0]!;
	const quoted = {
		subject: { kind: "id", id: f.subjectId },
		predicate: f.predicate,
		payload: f.payload,
		modality: "asserted",
		condition: null,
		validTime: null,
		quotes: c.sources.map((s) => ({
			utteranceId: s.id,
			text: s.text,
			occurrence: 0,
		})),
	};
	const window = c.sources.map((s) => ({
		utteranceId: s.id,
		text: s.text,
		origin: "document_claim" as const,
	}));
	const output = decodeTypedCandidates(
		JSON.stringify({ candidates: [quoted] }),
		window,
	);
	return { c, f, quoted, window, output };
}

test("joint quotes meet the original two-source gold without changing its requirements", () => {
	const { c, f, output } = fixture();
	const p = replay(c, output),
		draft = p.validation.handoff[0]!.draft;
	expect(f.sourceIds).toEqual(["s0", "s1"]);
	expect(matches(draft, f, c)).toBe(true);
	expect(draft.evidence.map((e) => e.source.id)).toEqual(["s0", "s1"]);
	expect(new Set(draft.evidence.map((e) => e.evidenceId)).size).toBe(2);
	expect(replay(c, output).validation.handoff[0]!.draft.evidence).toEqual(
		draft.evidence,
	);
	// This original fixture forgets s0 BEFORE reading. Joint validation must
	// succeed, while the dependency closure must then remove the whole claim.
	expect(c.eraseBeforeRead).toEqual(["s0"]);
	expect(p.queries[0]!.catalog).toEqual([]);
	c.sources.push({ id: "unused", text: "Additional authorized context." });
	const withInput = replay(c, output).validation.handoff[0]!.draft;
	expect(withInput.inputManifest).toHaveLength(3);
	expect(withInput.evidence).toHaveLength(2);
});

test("invalid additional quotes reject the whole candidate, never keep just its good quote", () => {
	const { c, output } = fixture(),
		first = output.candidates[0]!;
	const quotes = first.quotes!;
	for (const bad of [
		[],
		[...quotes, quotes[0]!],
		[quotes[0]!, { ...quotes[1]!, endByte: 999999 }],
		[quotes[0]!, { ...quotes[1]!, utteranceId: "not-supplied" }],
		Array.from(
			{ length: extractionLimits.maxQuotesPerCandidate + 1 },
			() => quotes[0]!,
		),
	]) {
		const p = replay(c, { candidates: [{ ...first, quotes: bad }] });
		expect(p.validation.handoff).toEqual([]);
		expect(p.validation.verdicts[0]!.status).toBe("rejected");
	}
	expect(
		replay(c, { candidates: [{ ...first, quote: quotes[0] }] }).validation
			.handoff,
	).toEqual([]);
});

test("native decoder checks every exact quotation and rejects dual representation", () => {
	const { quoted, window } = fixture();
	expect(() =>
		decodeTypedCandidates(
			JSON.stringify({
				candidates: [
					{
						...quoted,
						quotes: [
							quoted.quotes[0],
							{ ...quoted.quotes[1], text: "invented" },
						],
					},
				],
			}),
			window,
		),
	).toThrow("NOT_EXACT");
	expect(() =>
		decodeTypedCandidates(
			JSON.stringify({ candidates: [{ ...quoted, quote: quoted.quotes[0] }] }),
			window,
		),
	).toThrow();
});

test("two spans of one original keep one evidence root", () => {
	const { c, output } = fixture(),
		first = output.candidates[0]!,
		s = c.sources[0]!;
	const chars = Array.from(s.text),
		split = Buffer.byteLength(
			chars.slice(0, Math.floor(chars.length / 2)).join(""),
		);
	const p = replay(c, {
		candidates: [
			{
				...first,
				quotes: [
					{ utteranceId: s.id, startByte: 0, endByte: split },
					{
						utteranceId: s.id,
						startByte: split,
						endByte: Buffer.byteLength(s.text),
					},
				],
			},
		],
	});
	const draft = p.validation.handoff[0]!.draft;
	expect(draft.evidence).toHaveLength(2);
	expect(new Set(draft.evidence.map((e) => e.rootEvidenceId)).size).toBe(1);
});

for (const sourceId of ["s0", "s1"])
	test(`joint evidence: changing or forgetting ${sourceId} invalidates the whole stored claim`, () => {
		const { c, output } = fixture(),
			draft = replay(c, output).validation.handoff[0]!.draft;
		const store = openTestStore(),
			scope = draft.scope;
		const sources = draft.inputManifest.map((s) => ({
			...s,
			...scope,
			status: "available" as const,
			content: c.sources.find((c) => c.id === s.id)!.text,
		}));
		const hostChecks = {
			sourceSnapshot: { states: sources },
			forgetEpoch: "f1",
			restoreEpoch: "r1",
			policyRevision: "p1",
		};
		const current = {
			contractVersion: 1,
			access: {
				principal: scope.principal,
				scopeKeys: [scope.scopeKey],
				purpose: "world",
				policyRevision: "p1",
			},
			scope,
			hostChecks,
		};
		const apply = (key: string, operation: WorldOperation) =>
			store.write((db) =>
				applyWorldOperation(
					db,
					{ ...current, operationKey: key, clock: 1793836800000, operation },
					{ hasher },
				),
			);
		try {
			const assertion = {
				...draft,
				lifecycle: "candidate" as const,
				rootEvidenceIds: [
					...new Set(draft.evidence.map((e) => e.rootEvidenceId)),
				],
			};
			expect(
				apply("register", { kind: "assertion.register", assertion }).status,
			).toBe("applied");
			const planned = planAssertionTransition({
				contractVersion: 1,
				scope,
				current: {
					id: draft.id,
					revision: 1,
					scope,
					lifecycle: "candidate",
					origin: draft.origin,
				},
				expectedRevision: 1,
				request: {
					action: "adopt",
					adoption: { kind: "explicit", operationId: "host-approval" },
					subjectConfirmedByHost: true,
				},
				registeredAdoptionRules: [],
			});
			if (!planned.ok || planned.value.status !== "planned")
				throw new Error("PLAN_FAILED");
			expect(
				apply("adopt", {
					kind: "assertion.transition",
					plan: planned.value.plan,
				}).status,
			).toBe("applied");
			const read = store.read((db) =>
				readWorldSnapshot(db, { ...current, asOf: 1793836800000 }),
			);
			if (read.status !== "ready") throw new Error(read.reasonCode);
			const slice = buildWorldSlice(
				{ contractVersion: 1, snapshot: read.snapshot, request: {} },
				hasher,
			);
			if (!slice.ok) throw new Error(slice.code);
			const receipt = toSliceReceipt(slice.value);
			expect(slice.value.units[0]!.sources.map((s) => s.id)).toEqual([
				"s0",
				"s1",
			]);
			const changed = {
				...current,
				hostChecks: {
					...hostChecks,
					sourceSnapshot: {
						states: sources.map((s) =>
							s.id === sourceId ? { ...s, revision: "changed" } : s,
						),
					},
				},
			};
			expect(
				store.write((db) => validateWorldUsage(db, receipt, changed)).status,
			).toBe("blocked");
			for (const status of ["changed", "missing", "forgotten"] as const) {
				const withdrawn = {
					...current,
					hostChecks: {
						...hostChecks,
						sourceSnapshot: {
							states: sources.map((s) =>
								s.id === sourceId ? { ...s, status } : s,
							),
						},
					},
				};
				expect(
					store.write((db) => validateWorldUsage(db, receipt, withdrawn))
						.status,
				).toBe("blocked");
			}
			const ref = draft.inputManifest.find((s) => s.id === sourceId)!;
			expect(
				apply("forget", {
					kind: "forget.chunk",
					forgetId: "forget-source",
					reasonCode: "FORGET_REQUESTED",
					roots: [{ kind: "source", id: sourceIdentityKey(ref), revision: 1 }],
				}),
			).toMatchObject({ status: "applied", forget: { state: "complete" } });
			expect(
				store.write((db) => validateWorldUsage(db, receipt, current)).status,
			).toBe("blocked");
			expect(
				apply("reopen", {
					kind: "forget.reopen",
					forgetId: "forget-source",
					externalDeletionConfirmed: true,
				}).status,
			).toBe("applied");
			const after = store.read((db) =>
				readWorldSnapshot(db, { ...current, asOf: 1793836800000 }),
			);
			expect(after.status).toBe("ready");
			if (after.status === "ready")
				expect(after.snapshot.assertions).toEqual([]);
		} finally {
			store.close();
		}
	});
