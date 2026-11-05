/** Replay through the package's actual public validation and SQLite APIs. */
import { createHash } from "node:crypto";
import {
	buildWorldSlice,
	canonicalBytes,
	citedBytes,
	evaluateConditions,
	planAssertionTransition,
	prepareExtraction,
	validateCandidates,
	toSliceReceipt,
	type Assertion,
	type SourceState,
	type ProjectionSnapshot,
} from "../../src/index.ts";
import {
	applyWorldOperation,
	readAssertionHistory,
	readWorldSnapshot,
	validateWorldUsage,
	type WorldOperation,
	type SnapshotCoverage,
} from "../../src/sqlite.ts";
import { openTestStore } from "../../test/support/sqlite-store.ts";
import { PIPELINE_NOW } from "./fixtures.ts";
import type { PipelineCase, Presentation } from "./types.ts";

const hash = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const bytes = (text: string) => Buffer.byteLength(text);
const unique = (ids: readonly string[]) => [...new Set(ids)].sort();

const emptyPresentation = (
	status: string,
	reasonCodes: readonly string[],
): Presentation => ({
	status,
	reasonCodes,
	text: "",
	bytes: 0,
	plainText: "",
	plainEvidenceIds: [],
	evidenceIds: [],
	units: [],
	evaluations: [],
});

function render(
	snapshot: ProjectionSnapshot,
	request: unknown,
	maxBytes: number,
	assertions: readonly Assertion[],
	states: readonly SourceState[],
	observations: PipelineCase["queries"][number]["observations"],
	retrievalCoverage: SnapshotCoverage,
): Presentation {
	let budget = Math.min(maxBytes, 8192);
	// Repeated pure rendering only: reducing bytes never retries a model or
	// rewrites a claim. Each iteration shrinks the cap; every unit stays whole.
	for (
		let step = 0;
		step <= snapshot.assertions.length + 1 && budget > 0;
		step++
	) {
		const built = buildWorldSlice(
			{
				contractVersion: 1,
				snapshot,
				request: { ...(request as object), maxBytes: budget },
			},
			hash,
		);
		if (!built.ok) return emptyPresentation("rejected", [built.code]);
		const slice = built.value;
		if (slice.units.length === 0)
			return emptyPresentation(slice.status, slice.reasonCodes);
		const quotes = slice.units.flatMap((unit) => {
			const assertion = assertions.find(
				(a) => a.id === unit.assertionId && a.revision === unit.revision,
			);
			if (!assertion) throw new Error("presentation assertion missing");
			return assertion.evidence.map((evidence) => {
				const state = states.find(
					(s) =>
						s.id === evidence.source.id &&
						s.revision === evidence.source.revision &&
						s.digest === evidence.source.digest,
				);
				if (!state?.content || !evidence.source.range)
					throw new Error("presentation source missing");
				const quoted = citedBytes(state.content, evidence.source.range);
				if (!quoted.ok) throw new Error("presentation quote invalid");
				return {
					assertionId: unit.assertionId,
					sourceId: state.id,
					range: evidence.source.range,
					text: new TextDecoder().decode(quoted.value),
				};
			});
		});
		const evaluations = slice.units.map((unit) => {
			const evaluated = evaluateConditions({
				contractVersion: 1,
				authorized: true,
				asOf: snapshot.asOf,
				maxAgeMs: 86_400_000,
				condition: unit.condition,
				...(unit.validTime === undefined ? {} : { validTime: unit.validTime }),
				observations,
			});
			if (!evaluated.ok) throw new Error(`condition context:${evaluated.code}`);
			return { assertionId: unit.assertionId, result: evaluated.value };
		});
		// Both views carry exactly the same material, including conditions,
		// validity, quotes, versions, adoption state and evaluation reasons.
		// Lossless wire factoring: source versions stay in the shared catalog;
		// units reference exact entries instead of repeating source hashes.
		const sourceKey = (value: unknown) => {
			const encoded = canonicalBytes(value);
			if (!encoded.ok) throw new Error("invalid source catalog entry");
			return hash(encoded.value);
		};
		const catalog = new Map(
			slice.sourceVersions.map((source, index) => [sourceKey(source), index]),
		);
		const wireUnits = slice.units.map((unit) => ({
			...unit,
			sources: unit.sources.map((source) => {
				const index = catalog.get(sourceKey(source));
				if (index === undefined) throw new Error("source missing from catalog");
				return index;
			}),
		}));
		const material = {
			format: "indexed-sources/1",
			retrievalCoverage,
			complete: !retrievalCoverage.partial && slice.completeness.complete,
			slice: { ...slice, units: wireUnits },
			quotes,
			evaluations,
		};
		const text = JSON.stringify({ kind: "world", ...material });
		const plainText = JSON.stringify({ kind: "plain", ...material });
		const size = Math.max(bytes(text), bytes(plainText));
		if (size <= maxBytes) {
			const evidenceIds = unique(quotes.map((quote) => quote.sourceId));
			return {
				receipt: toSliceReceipt(slice),
				status: slice.status,
				reasonCodes: slice.reasonCodes,
				text,
				bytes: size,
				plainText,
				plainEvidenceIds: evidenceIds,
				evidenceIds,
				units: slice.units,
				evaluations,
			};
		}
		budget -= size - maxBytes;
	}
	return emptyPresentation("overflow", ["PRESENTATION_EXCEEDS_BUDGET"]);
}

/** Query/gold are never used to validate candidates or make adoption decisions. */
export function replayCase(input: PipelineCase) {
	const recordedAt = input.recordedAt ?? PIPELINE_NOW;
	const scope = { principal: "pipeline-eval", scopeKey: input.id };
	const access = {
		principal: scope.principal,
		scopeKeys: [scope.scopeKey],
		purpose: "world",
		policyRevision: "pipeline-policy-1",
	};
	const states: SourceState[] = input.sources.map((source) => ({
		namespace: "pipeline",
		kind: "message",
		id: source.id,
		revision: "1",
		digest: `sha256:${hash(Buffer.from(source.text))}`,
		...scope,
		status: "available",
		content: source.text,
	}));
	const entities = input.entities.map((entity) => ({
		...entity,
		scope,
		revision: 1,
		externalRefs: [],
	}));
	const prepared = prepareExtraction(
		{
			contractVersion: 1,
			scope,
			utterances: states.map((state) => ({
				utteranceId: state.id,
				source: {
					namespace: state.namespace,
					kind: state.kind,
					id: state.id,
					revision: state.revision,
					digest: state.digest,
				},
				confirmed: true,
				origin: "document_claim",
				rootEvidenceId: `root-${state.id}`,
			})),
			sources: { states },
		},
		hash,
	);
	if (
		!prepared.ok ||
		prepared.value.status !== "prepared" ||
		prepared.value.deferred.length > 0
	)
		throw new Error("pipeline source preparation incomplete");
	const context = {
		contractVersion: 1,
		scope,
		window: prepared.value.window,
		manifest: prepared.value.manifest,
		sources: { states },
		entities,
		assigned: {
			recordedAt,
			interpretationVersion: "pipeline-1",
			freshnessMaxAgeMs: 86_400_000,
			items: Array.from({ length: 8 }, (_, i) => ({
				assertionId: `claim-${i}`,
				evidenceId: `evidence-${i}`,
			})),
		},
		modelOutput: input.rawOutput,
	};
	const checked = validateCandidates(context, hash);
	if (!checked.ok) throw new Error(`pipeline validation:${checked.code}`);
	const selected = validateCandidates(
		{ ...context, selectedIndexes: checked.value.acceptedIndexes },
		hash,
	);
	if (!selected.ok) throw new Error(`pipeline selection:${selected.code}`);
	const validation = selected.value;
	const hostChecks = {
		sourceSnapshot: { states },
		policyRevision: access.policyRevision,
		forgetEpoch: "f1",
		restoreEpoch: "r1",
	};
	const envelope = { contractVersion: 1, scope, access, hostChecks };
	const store = openTestStore();
	try {
		const stored: Assertion[] = [];
		const adopted: Assertion[] = [];
		store.write((db) => {
			let operationNumber = 0;
			const apply = (operation: WorldOperation) => {
				const result = applyWorldOperation(
					db,
					{
						...envelope,
						clock: recordedAt,
						operationKey: `op-${operationNumber++}`,
						operation,
					},
					{ hasher: hash },
				);
				if (result.status !== "applied")
					throw new Error(
						`pipeline operation:${"reasonCode" in result ? result.reasonCode : result.status}`,
					);
			};
			for (const entity of input.entities)
				apply({
					kind: "entity.register",
					entity: { ...entity, externalRefs: [] },
				});
			const feed = {
				kind: "pipeline",
				scopeKeys: [scope.scopeKey],
				cursorRestoreEpoch: "r1",
			};
			apply({
				kind: "inbox.receive",
				feed,
				event: {
					eventId: "event-1",
					seq: 1,
					payload: { kind: "fixture-replay" },
				},
				receivedCursor: "received-1",
			});
			const candidates: Assertion[] = validation.handoff.map(({ draft }) => ({
				...draft,
				lifecycle: "candidate",
				rootEvidenceIds: unique(draft.evidence.map((e) => e.rootEvidenceId)),
			}));
			if (validation.status === "rejected")
				apply({
					kind: "candidate.settle",
					feed,
					eventId: "event-1",
					disposition: "rejected",
					assertions: [],
					appliedCursor: "applied-1",
				});
			else
				apply({
					kind: "candidate.settle",
					feed,
					eventId: "event-1",
					disposition: "applied",
					manifest: {
						manifestId: "manifest-1",
						dependencies: prepared.value.manifest.dependencies,
					},
					assertions: candidates,
					appliedCursor: "applied-1",
				});
			for (const candidate of candidates) {
				const history = readAssertionHistory(db, {
					...envelope,
					assertionId: candidate.id,
				});
				if (
					history.status !== "ready" ||
					history.truncated ||
					history.revisions.length !== 1 ||
					history.revisions[0]!.lifecycle !== "candidate"
				)
					throw new Error("pipeline candidate persistence mismatch");
				stored.push(history.revisions[0]!);
			}
			for (const verdict of validation.handoff) {
				if (!input.adoptIndexes.includes(verdict.index)) continue;
				const candidate = candidates.find((c) => c.id === verdict.draft.id)!;
				const plan = planAssertionTransition({
					contractVersion: 1,
					scope,
					current: {
						id: candidate.id,
						revision: candidate.revision,
						scope: candidate.scope,
						lifecycle: candidate.lifecycle,
						origin: candidate.origin,
					},
					expectedRevision: candidate.revision,
					request: {
						action: "adopt",
						adoption: {
							kind: "explicit",
							operationId: `explicit-${candidate.id}`,
						},
						subjectConfirmedByHost: true,
					},
					registeredAdoptionRules: [],
				});
				if (!plan.ok || plan.value.status !== "planned")
					throw new Error("pipeline adoption rejected");
				apply({ kind: "assertion.transition", plan: plan.value.plan });
				const history = readAssertionHistory(db, {
					...envelope,
					assertionId: candidate.id,
				});
				if (
					history.status !== "ready" ||
					history.truncated ||
					!history.revisions[0]
				)
					throw new Error("pipeline stored history unavailable");
				adopted.push(history.revisions[0]);
			}
			for (const operation of input.beforeReadOperations ?? [])
				apply(operation);
		});
		const evidenceIds = (assertions: readonly Assertion[]) =>
			unique(assertions.flatMap((a) => a.evidence.map((e) => e.source.id)));
		const stages = {
			supplied: states.map((s) => s.id).sort(),
			validated: evidenceIds(stored),
			stored: evidenceIds(stored),
			adopted: evidenceIds(adopted),
		};
		const queries = input.queries.map((query) =>
			store.read((db) => {
				const read = readWorldSnapshot(db, {
					...envelope,
					asOf: query.asOf,
					focus: { subjectIds: query.subjectIds, depth: query.depth ?? 2 },
				});
				if (read.status !== "ready")
					throw new Error(`pipeline read:${read.reasonCode}`);
				const assertions = read.snapshot.assertions;
				const subject = render(
					read.snapshot,
					{ focusSubjectIds: query.subjectIds },
					query.maxBytes,
					assertions,
					states,
					query.observations,
					read.coverage,
				);
				const focusAssertionRefs = query.selectedIndexes.map((index) => {
					const assertion = assertions.find((a) => a.id === `claim-${index}`);
					return { id: `claim-${index}`, revision: assertion?.revision ?? 1 };
				});
				const selected =
					query.selectedIndexes.length === 0
						? emptyPresentation("empty", ["NO_SELECTED_ASSERTIONS"])
						: render(
								read.snapshot,
								{ focusAssertionRefs },
								query.maxBytes,
								assertions,
								states,
								query.observations,
								read.coverage,
							);
				const history = input.sources.map((source) => ({
					id: source.id,
					text: source.text,
				}));
				while (
					history.length > 0 &&
					bytes(JSON.stringify({ kind: "raw", sources: history })) >
						query.maxBytes
				)
					history.shift();
				const text = JSON.stringify({ kind: "raw", sources: history });
				const raw = {
					text: bytes(text) <= query.maxBytes ? text : "",
					bytes: bytes(text) <= query.maxBytes ? bytes(text) : 0,
					evidenceIds: history.map((s) => s.id),
				};
				const arms = { raw, subject, selected };
				const expected = unique(query.expectedEvidenceIds);
				const recall = (ids: readonly string[]) => ({
					numerator: expected.filter((id) => ids.includes(id)).length,
					denominator: expected.length,
				});
				return {
					id: query.id,
					catalog: assertions
						.filter((a) => a.lifecycle === "active")
						.map((a) => ({
							id: a.id,
							revision: a.revision,
							subjectId: a.subjectId,
							predicate: a.predicate,
							payload: a.payload,
							condition: a.condition,
							validTime: a.validTime,
							sources: a.evidence.map((e) => e.source.id),
						})),
					coverage: read.coverage,
					retrieved: evidenceIds(assertions),
					arms,
					recall: {
						raw: recall(raw.evidenceIds),
						subject: recall(subject.evidenceIds),
						selected: recall(selected.evidenceIds),
					},
					missing: {
						supplied: expected.filter((id) => !stages.supplied.includes(id)),
						validated: expected.filter((id) => !stages.validated.includes(id)),
						stored: expected.filter((id) => !stages.stored.includes(id)),
						adopted: expected.filter((id) => !stages.adopted.includes(id)),
						retrieved: expected.filter(
							(id) => !evidenceIds(assertions).includes(id),
						),
						displayed: expected.filter(
							(id) => !selected.evidenceIds.includes(id),
						),
					},
				};
			}),
		);
		const checkedQueries = queries.map((query) => {
			const check = (p: Presentation) => {
				if (!p.receipt) return { ...p, usage: null };
				const usage = store.write((db) =>
					validateWorldUsage(db, p.receipt, envelope),
				);
				if (usage.status !== "valid")
					throw new Error(`pipeline usage:${JSON.stringify(usage)}`);
				return { ...p, usage };
			};
			return {
				...query,
				arms: {
					...query.arms,
					subject: check(query.arms.subject),
					selected: check(query.arms.selected),
				},
			};
		});
		return { input, validation, stages, queries: checkedQueries };
	} finally {
		store.close();
	}
}
