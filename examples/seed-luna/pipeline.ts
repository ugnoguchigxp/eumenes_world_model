import {
	canonicalBytes,
	validateCandidates,
	type Assertion,
	type Entity,
	type SourceState,
} from "../../src/index.ts";
import {
	applyWorldOperation,
	readAssertionHistory,
	readWorldSnapshot,
	type WorldDb,
	type WorldOperation,
} from "../../src/sqlite.ts";
import {
	hash,
	prepareSeedDocument,
	seedScope,
	type SeedDocument,
} from "../../eval/seed/corpus.ts";
import { bindQuotes } from "./quotes.ts";
import { PROMPT_VERSION } from "./luna.ts";

export function validateOutput(
	document: SeedDocument,
	entity: Entity,
	raw: unknown,
	recordedAt: number,
) {
	const prepared = prepareSeedDocument(document);
	if (!prepared.ok || prepared.value.status !== "prepared")
		throw new Error("example_source_not_prepared");
	const state: SourceState = {
		...document.source,
		...seedScope,
		status: "available",
		content: document.content,
	};
	const binding = bindQuotes(raw, document.source.id, document.content);
	const context = {
		contractVersion: 1,
		scope: seedScope,
		window: prepared.value.window,
		manifest: prepared.value.manifest,
		sources: { states: [state] },
		entities: [entity],
		assigned: {
			recordedAt,
			interpretationVersion: PROMPT_VERSION,
			freshnessMaxAgeMs: 86_400_000,
			items: Array.from({ length: 8 }, (_, index) => ({
				assertionId: `${document.source.id}:claim:${index}`,
				evidenceId: `${document.source.id}:evidence:${index}`,
			})),
		},
		modelOutput: binding.output,
	};
	const checked = validateCandidates(context, hash);
	if (!checked.ok)
		throw new Error(`example_validation_context:${checked.code}`);
	// Host policy for this experiment: retain accepted drafts as CANDIDATES only.
	const selected = validateCandidates(
		{
			...context,
			selectedIndexes: checked.value.acceptedIndexes,
		},
		hash,
	);
	if (!selected.ok) throw new Error(`example_handoff:${selected.code}`);
	const assertions: Assertion[] = selected.value.handoff.map((verdict) => ({
		...verdict.draft,
		lifecycle: "candidate" as const,
		rootEvidenceIds: [
			...new Set(verdict.draft.evidence.map((e) => e.rootEvidenceId)),
		].sort(),
	}));
	return {
		validation: selected.value,
		bindings: binding.bindings,
		state,
		assertions,
	};
}

/** The caller owns the test transaction; the example never creates a DB. */
export function persistCandidates(
	db: WorldDb,
	entity: Entity,
	state: SourceState,
	assertions: readonly Assertion[],
	recordedAt: number,
) {
	const access = {
		principal: seedScope.principal,
		scopeKeys: [seedScope.scopeKey],
		purpose: "world",
		policyRevision: "seed-luna-policy-v1",
	};
	const hostChecks = {
		sourceSnapshot: { states: [state] },
		forgetEpoch: "seed-luna-forget-v1",
		restoreEpoch: "seed-luna-restore-v1",
		policyRevision: access.policyRevision,
	};
	const envelope = { contractVersion: 1, access, scope: seedScope, hostChecks };
	function apply(operationKey: string, operation: WorldOperation) {
		const result = applyWorldOperation(
			db,
			{
				...envelope,
				operationKey,
				clock: recordedAt,
				operation,
			},
			{ hasher: hash },
		);
		if ("reasonCode" in result)
			throw new Error(`example_persist:${result.reasonCode}`);
		return result.status;
	}
	apply(`entity:${entity.id}`, {
		kind: "entity.register",
		entity: {
			id: entity.id,
			displayName: entity.displayName,
			aliases: [],
			externalRefs: [],
		},
	});
	for (const assertion of assertions) {
		const operation = { kind: "assertion.register", assertion } as const;
		if (apply(`claim:${assertion.id}`, operation) !== "applied")
			throw new Error("example_first_write_not_applied");
		if (apply(`claim:${assertion.id}`, operation) !== "no_op")
			throw new Error("example_replay_not_idempotent");
		const history = readAssertionHistory(db, {
			...envelope,
			assertionId: assertion.id,
		});
		if (
			history.status !== "ready" ||
			history.revisions.length !== 1 ||
			hashCanonical(history.revisions[0]) !== hashCanonical(assertion)
		)
			throw new Error("example_persisted_candidate_mismatch");
	}
	const view = readWorldSnapshot(db, { ...envelope, asOf: recordedAt });
	// Snapshot includes unadopted candidates; visibility is not adoption.
	if (
		view.status !== "ready" ||
		view.snapshot.assertions.some(
			(assertion) => assertion.lifecycle !== "candidate",
		)
	)
		throw new Error("example_candidate_auto_adopted");
	return {
		storedCandidates: assertions.length,
		replayNoOp: assertions.length,
		activeAssertions: 0,
	};
}

function hashCanonical(value: unknown) {
	const bytes = canonicalBytes(value);
	if (!bytes.ok) throw new Error("example_invalid_canonical_value");
	return hash(bytes.value);
}
