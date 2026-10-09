import {
	asRecord,
	canonicalDigest,
	type CanonicalHasher,
	checkId,
	compareDependentRef,
	type DependentKind,
	type DependentRef,
	type ScopeRef,
} from "../../contracts/index.ts";
import {
	deleteAssertions,
	getAssertion,
	listAssertionsBySourceKeys,
	listAssertionRevisionsBySubject,
	listAssertionsReferencingEntities,
} from "../../domains/assertions/sqlite.ts";
import {
	deleteEntities,
	listMergedMembersOf,
} from "../../domains/identity/sqlite.ts";
import {
	advanceCheckpoint,
	countCheckpointsByKindPrefix,
	deleteCheckpoint,
	deleteInbox,
	deleteManifests,
	getManifest,
	listManifestsBySourceKeys,
	feedKeyOf,
	getCheckpoint,
	protectedKinds,
	type FeedRef,
} from "../../domains/extraction/sqlite.ts";
import {
	beginForget,
	checkTargetRef,
	closeGate,
	completeForget,
	countDoneTargets,
	countPendingTargets,
	getForget,
	getGate,
	getTombstone,
	insertTombstone,
	listPendingTargets,
	markTargetsDone,
	maxForgetChunk,
	countAllPendingTargets,
	openGate,
	recordForgetChunk,
	saveForgetTargets,
	tombstoneReasons,
} from "../../domains/lifecycle/sqlite.ts";
import { deleteProjectionFor } from "../../domains/projection/sqlite.ts";
import {
	deletePredictionsAndOutcomes,
	listPredictionsByBasisAssertion,
	listPredictionsReferencingEntities,
} from "../../domains/scenarios/sqlite.ts";
import {
	WorldIntegrityError,
	type WorldDb,
} from "../../infrastructure/sqlite/db.ts";
import type { AssertionRef } from "../../domains/assertions/index.ts";
import { rejectedResult } from "./checks.ts";
import { removeHeads } from "./projection.ts";
import {
	RESTORE_GATE_REASON,
	type ForgetProgress,
	type HostChecks,
	type WorldOperation,
} from "./types.ts";

type Op = Extract<WorldOperation, { kind: "forget.chunk" }>;
type Rejection = { readonly status: "rejected"; readonly reasonCode: string };
interface Context {
	readonly hasher: import("../../contracts/index.ts").CanonicalHasher;
	readonly clock: number;
	readonly hostChecks: HostChecks;
	/**
	 * Set by restore for forgets it derives from the journal: their external
	 * deletion belongs to the restore procedure, not to a host confirmation.
	 */
	readonly derived?: boolean;
}

/** Dependents read per target; more than this keeps the target pending. */
const discoverLimit = 500;
/** Newly discovered targets one chunk may persist before it stops expanding. */
const discoverBudget = 4000;

const must = (
	result: { status: string; reasonCode?: string },
	stage: string,
) => {
	if (result.status === "rejected")
		throw new WorldIntegrityError(`${stage}:${result.reasonCode}`);
};

/** Reads only: every foreseeable refusal, before the first DML. */
export function precheckForget(
	db: WorldDb,
	op: Op,
	scope: ScopeRef,
): Rejection | null {
	if (
		!checkId(op.forgetId).ok ||
		!tombstoneReasons.includes(op.reasonCode) ||
		!Array.isArray(op.roots) ||
		op.roots.length > maxForgetChunk ||
		!op.roots.every((root) => asRecord(root) && checkTargetRef(root).ok)
	)
		return rejectedResult("INVALID_INPUT");
	const existing = getForget(db, scope, op.forgetId);
	if (existing && existing.reasonCode !== op.reasonCode)
		return rejectedResult("FORGET_REASON_CONFLICT");
	// A finished forget accepts no further roots (they would be dropped while
	// the result still said "complete"); an unseen forget needs something to do.
	if (existing?.state === "complete")
		return rejectedResult("FORGET_ALREADY_COMPLETE");
	if (!existing && op.roots.length === 0)
		return rejectedResult("INVALID_INPUT");
	return null;
}

type EntityIndex = ReadonlyMap<
	string,
	{
		members: { ids: readonly string[]; truncated: boolean };
		mentions: { refs: readonly AssertionRef[]; truncated: boolean };
		predictions: {
			refs: readonly { id: string; revision: number }[];
			truncated: boolean;
		};
	}
>;

/**
 * One pass for every entity target of a batch: members, mentioning assertions
 * (payload values and condition operands) and predictions are each found with
 * a single scan of the Scope, so the cost does not grow with the target count.
 */
function indexEntities(
	db: WorldDb,
	scope: ScopeRef,
	targets: readonly DependentRef[],
): EntityIndex {
	const ids = [
		...new Set(targets.filter((t) => t.kind === "entity").map((t) => t.id)),
	];
	if (ids.length === 0) return new Map();
	const members = listMergedMembersOf(db, scope, ids, discoverLimit);
	const mentions = listAssertionsReferencingEntities(
		db,
		scope,
		ids,
		discoverLimit,
	);
	const predictions = listPredictionsReferencingEntities(
		db,
		scope,
		ids,
		discoverLimit,
	);
	return new Map(
		ids.map((id) => [
			id,
			{
				members: members.get(id) ?? { ids: [], truncated: false },
				mentions: mentions.get(id) ?? { refs: [], truncated: false },
				predictions: predictions.get(id) ?? { refs: [], truncated: false },
			},
		]),
	);
}

/** Reverse dependencies of one target, read from the ledger (bounded). */
function discover(
	db: WorldDb,
	scope: ScopeRef,
	target: DependentRef,
	entities: EntityIndex,
): { readonly refs: DependentRef[]; readonly truncated: boolean } {
	const refs: DependentRef[] = [];
	let truncated = false;
	switch (target.kind) {
		case "source":
		case "state": {
			const assertions = listAssertionsBySourceKeys(
				db,
				scope,
				[target.id],
				discoverLimit,
			);
			for (const ref of assertions.refs)
				refs.push({ kind: "assertion", id: ref.id, revision: ref.revision });
			const manifests = listManifestsBySourceKeys(
				db,
				scope,
				[target.id],
				discoverLimit,
			);
			for (const id of manifests.manifestIds)
				refs.push({ kind: "manifest", id, revision: 1 });
			truncated = assertions.truncated || manifests.truncated;
			break;
		}
		case "assertion": {
			const predictions = listPredictionsByBasisAssertion(
				db,
				scope,
				target.id,
				discoverLimit,
			);
			for (const stored of predictions.items)
				refs.push({
					kind: "prediction",
					id: stored.prediction.predictionId,
					revision: stored.prediction.revision,
				});
			truncated = predictions.truncated;
			break;
		}
		case "entity": {
			const found = entities.get(target.id);
			// Entities merged into this one must go with it (their payload is
			// already folded into the representative, and the row would dangle).
			for (const id of found?.members.ids ?? [])
				refs.push({ kind: "entity", id, revision: 1 });
			// Every revision of every assertion that ever had this subject: a
			// supersede may have moved the subject, leaving old payload behind.
			const about = listAssertionRevisionsBySubject(
				db,
				scope,
				target.id,
				discoverLimit,
			);
			for (const ref of about.refs)
				refs.push({ kind: "assertion", id: ref.id, revision: ref.revision });
			for (const ref of found?.predictions.refs ?? [])
				refs.push({ kind: "prediction", id: ref.id, revision: ref.revision });
			// Assertions that only mention the entity (relation object, entity
			// reference value or condition operand) also carry its identity.
			for (const ref of found?.mentions.refs ?? [])
				refs.push({ kind: "assertion", id: ref.id, revision: ref.revision });
			truncated =
				about.truncated ||
				(found?.members.truncated ?? false) ||
				(found?.mentions.truncated ?? false) ||
				(found?.predictions.truncated ?? false);
			break;
		}
		case "manifest": {
			const eventId = getManifest(db, scope, target.id)?.eventId;
			if (eventId !== undefined)
				refs.push({ kind: "candidate", id: eventId, revision: 1 });
			break;
		}
		default:
			break;
	}
	return { refs, truncated };
}

const idsOf = (refs: readonly DependentRef[], kind: DependentKind) => [
	...new Set(refs.filter((ref) => ref.kind === kind).map((ref) => ref.id)),
];

/** Removes the payload rows of processed targets, per owning domain. */
function erase(
	db: WorldDb,
	scope: ScopeRef,
	processed: readonly DependentRef[],
	context: Context,
): { readonly assertions: number } {
	const assertionRefs = processed
		.filter((ref) => ref.kind === "assertion")
		.map((ref) => ({ id: ref.id, revision: ref.revision }));
	if (assertionRefs.length > 0) {
		// Heads are read BEFORE the rows go: they define what leaves the
		// projection (rows, digest sum, refutation lists) incrementally.
		const heads = [...new Set(assertionRefs.map((ref) => ref.id))].flatMap(
			(id) => {
				const head = getAssertion(db, scope, id);
				return head ? [head] : [];
			},
		);
		// Ledger first: the eligibility of the erased heads' disputers is
		// recomputed against the remaining ledger, so a forgotten contradiction
		// target no longer counts as a live head (incremental == rebuild).
		must(deleteAssertions(db, scope, assertionRefs), "ASSERTIONS");
		removeHeads(db, scope, context, heads);
		deleteProjectionFor(db, scope, assertionRefs);
	}
	const scenarioRefs = processed.filter(
		(ref) => ref.kind === "prediction" || ref.kind === "outcome",
	);
	if (scenarioRefs.length > 0)
		deletePredictionsAndOutcomes(db, scope, scenarioRefs);
	const manifestIds = idsOf(processed, "manifest");
	if (manifestIds.length > 0) deleteManifests(db, scope, manifestIds);
	const eventIds = idsOf(processed, "candidate");
	if (eventIds.length > 0) deleteInbox(db, scope, eventIds);
	const entityIds = idsOf(processed, "entity");
	if (entityIds.length > 0)
		must(deleteEntities(db, scope, entityIds), "ENTITIES");
	return { assertions: assertionRefs.length };
}

/**
 * One forget chunk. Order inside the host transaction: close the gate; record
 * the forget; persist roots; for each target of the next batch persist its
 * dependents FIRST; only then erase payload rows, write tombstones and mark
 * targets done. Targets whose dependents could not all be persisted yet stay
 * pending (leaf-first ordering guarantees their dependents go first).
 */
export function applyForget(
	db: WorldDb,
	op: Op,
	scope: ScopeRef,
	context: Context,
): Rejection | null {
	// 1. Gate first, before anything else; closing is idempotent. A restore
	// in progress keeps its own reason: a forget must not break its steps.
	holdGate(db, scope, "FORGET_PENDING", context.hostChecks.restoreEpoch);
	const started = beginForget(db, scope, {
		forgetId: op.forgetId,
		reasonCode: op.reasonCode,
	});
	must(started, "FORGET");
	const operation = getForget(db, scope, op.forgetId)!;
	if (operation.state === "complete") return null;

	const roots = [...op.roots]
		.map((root) => ({ ...root }))
		.sort(compareDependentRef);
	const saved = saveForgetTargets(db, scope, op.forgetId, roots);
	if ("rejected" in saved) throw new WorldIntegrityError("FORGET_ROOTS");

	// Several batches may run in one chunk (dependents found by one batch are
	// next in line) until the chunk holds maxForgetChunk processed targets.
	let processedTotal = 0;
	let discovered = 0;
	while (processedTotal < maxForgetChunk && discovered < discoverBudget) {
		const batch = listPendingTargets(
			db,
			scope,
			op.forgetId,
			maxForgetChunk - processedTotal,
		);
		if (batch.length === 0) break;
		let processed: DependentRef[] = [];
		let addedThisBatch = 0;
		const entities = indexEntities(db, scope, batch);
		for (const target of batch) {
			if (discovered >= discoverBudget) break;
			const found = discover(db, scope, target, entities);
			const fresh = found.refs.filter(
				(ref) => getTombstone(db, scope, ref) === undefined,
			);
			if (fresh.length > 0) {
				const added = saveForgetTargets(db, scope, op.forgetId, fresh);
				if ("rejected" in added) throw new WorldIntegrityError("FORGET_SAVE");
				discovered += added.added;
				addedThisBatch += added.added;
			}
			if (!found.truncated) processed.push(target);
		}
		// A representative may only go together with (or after) its members.
		// Dropping one representative can strand the one above it (a merge
		// chain e-3 into e-2 into e-1), so filter to a fixpoint.
		const memberIndex = listMergedMembersOf(
			db,
			scope,
			processed.filter((ref) => ref.kind === "entity").map((ref) => ref.id),
			discoverLimit,
		);
		for (let changed = true; changed;) {
			changed = false;
			const inBatch = new Set(
				processed.filter((ref) => ref.kind === "entity").map((ref) => ref.id),
			);
			const kept = processed.filter(
				(ref) =>
					ref.kind !== "entity" ||
					(memberIndex.get(ref.id)?.ids ?? []).every((id) => inBatch.has(id)),
			);
			if (kept.length !== processed.length) {
				processed = kept;
				changed = true;
			}
		}
		if (processed.length === 0) {
			// Newly saved dependents are processed by the next pass.
			if (addedThisBatch > 0) continue;
			break;
		}
		erase(db, scope, processed, context);
		for (const target of processed) {
			if (getTombstone(db, scope, target) !== undefined) continue;
			must(
				insertTombstone(db, scope, {
					kind: target.kind,
					id: target.id,
					forgetId: op.forgetId,
					reasonCode: op.reasonCode,
				}),
				"TOMBSTONE",
			);
		}
		markTargetsDone(db, scope, op.forgetId, processed);
		processedTotal += processed.length;
	}
	recordForgetChunk(db, scope, op.forgetId);

	// The projection was kept equal to a rebuild incrementally (removeHeads).
	const remaining = countPendingTargets(db, scope, op.forgetId);
	if (remaining === 0) {
		must(completeForget(db, scope, op.forgetId), "COMPLETE");
		if (context.derived !== true)
			recordAwaiting(db, scope, op.forgetId, context.hasher);
		holdGate(
			db,
			scope,
			completeGateReason(op.forgetId, context.hasher),
			context.hostChecks.restoreEpoch,
		);
	}
	return null;
}

/** Closes the gate unless a restore already holds it with its own reason. */
function holdGate(
	db: WorldDb,
	scope: ScopeRef,
	reasonCode: string,
	restoreEpoch: string,
): void {
	const gate = getGate(db, scope);
	if (
		gate &&
		gate.state === "closed" &&
		gate.reasonCode === RESTORE_GATE_REASON
	)
		return;
	must(closeGate(db, scope, { reasonCode, restoreEpoch }), "GATE");
}

/** Counts and state only. Nothing here can carry a payload. */
export function forgetProgress(
	db: WorldDb,
	scope: ScopeRef,
	forgetId: string,
): ForgetProgress | undefined {
	const operation = getForget(db, scope, forgetId);
	if (!operation) return undefined;
	return {
		state: operation.state,
		processed: countDoneTargets(db, scope, forgetId),
		pending: countPendingTargets(db, scope, forgetId),
		awaitingConfirmation: countCheckpointsByKindPrefix(
			db,
			scope,
			protectedKinds.awaitingForget,
		),
	};
}

type ReopenOp = Extract<WorldOperation, { kind: "forget.reopen" }>;
export const FORGET_COMPLETE_GATE_REASON = "FORGET_COMPLETE_AWAITING_REOPEN";

/**
 * The gate reason names the forget that closed it (a short digest of its id),
 * so a reopen can only be authorised by that forget's own external-deletion
 * confirmation, never by an older, already reopened forget.
 */
export function completeGateReason(
	forgetId: string,
	hasher: CanonicalHasher,
): string {
	const digest = canonicalDigest(["forget-gate", forgetId], hasher);
	if (!digest.ok) throw new WorldIntegrityError("FORGET_GATE_TAG");
	return `${FORGET_COMPLETE_GATE_REASON}:${digest.value.slice("sha256:".length, "sha256:".length + 32)}`;
}

const AWAITING_EPOCH = "awaiting";

/**
 * A complete forget stays "awaiting confirmation" until the host confirms its
 * external (Memory) deletion. The mark lives in a checkpoint row of a
 * protected feed kind (restore.begin keeps it), keyed by a digest of the id,
 * so a later forget cannot overwrite an earlier forget's open obligation.
 */
function awaitingFeed(forgetId: string, hasher: CanonicalHasher): FeedRef {
	const digest = canonicalDigest(["forget-awaiting", forgetId], hasher);
	if (!digest.ok) throw new WorldIntegrityError("FORGET_AWAITING_KEY");
	return {
		scopeKeys: [],
		kind: `${protectedKinds.awaitingForget}${digest.value.slice("sha256:".length)}`,
	};
}
const awaitingFeedFor = (
	scope: ScopeRef,
	forgetId: string,
	hasher: CanonicalHasher,
): FeedRef => ({
	...awaitingFeed(forgetId, hasher),
	scopeKeys: [scope.scopeKey],
});

function recordAwaiting(
	db: WorldDb,
	scope: ScopeRef,
	forgetId: string,
	hasher: CanonicalHasher,
): void {
	const saved = advanceCheckpoint(db, scope, {
		feed: awaitingFeedFor(scope, forgetId, hasher),
		restoreEpoch: AWAITING_EPOCH,
		cursorRestoreEpoch: AWAITING_EPOCH,
		receivedCursor: "awaiting",
	});
	if (saved.status === "rejected")
		throw new WorldIntegrityError(`FORGET_AWAITING:${saved.reasonCode}`);
}

function isAwaiting(
	db: WorldDb,
	scope: ScopeRef,
	forgetId: string,
	hasher: CanonicalHasher,
): boolean {
	const key = feedKeyOf(
		scope.principal,
		awaitingFeedFor(scope, forgetId, hasher),
		AWAITING_EPOCH,
	);
	return key !== undefined && getCheckpoint(db, scope, key) !== undefined;
}

/** Forgets that completed but whose external deletion is not yet confirmed. */
export const awaitingConfirmations = (db: WorldDb, scope: ScopeRef): number =>
	countCheckpointsByKindPrefix(db, scope, protectedKinds.awaitingForget);

/**
 * Reads only. Confirming needs every cleanup step to be demonstrably done.
 * Several complete forgets can be open at once: each needs its own
 * confirmation, whatever the gate currently says or who closed it.
 */
export function precheckReopen(
	db: WorldDb,
	op: ReopenOp,
	scope: ScopeRef,
	hasher: CanonicalHasher,
): { status: "rejected" | "blocked"; reasonCode: string } | null {
	if (
		!checkId(op.forgetId).ok ||
		typeof op.externalDeletionConfirmed !== "boolean"
	)
		return rejectedResult("INVALID_INPUT");
	const forget = getForget(db, scope, op.forgetId);
	if (!forget) return rejectedResult("FORGET_NOT_FOUND");
	if (forget.state !== "complete")
		return { status: "blocked", reasonCode: "FORGET_NOT_COMPLETE" };
	if (countAllPendingTargets(db, scope) > 0)
		return { status: "blocked", reasonCode: "FORGET_PENDING" };
	if (op.externalDeletionConfirmed !== true)
		return { status: "blocked", reasonCode: "EXTERNAL_DELETION_UNCONFIRMED" };
	const gate = getGate(db, scope);
	// A gate left by a pre-tracking build names no forget: owner unknown, but
	// the confirmation of any complete forget may reopen it (documented).
	const legacy =
		gate?.state === "closed" && gate.reasonCode === FORGET_COMPLETE_GATE_REASON;
	if (!isAwaiting(db, scope, op.forgetId, hasher) && !legacy)
		return { status: "blocked", reasonCode: "FORGET_NOT_AWAITING" };
	if (!gate || gate.state !== "closed")
		return { status: "blocked", reasonCode: "GATE_NOT_CLOSED" };
	return null;
}

/**
 * Records the confirmation. The Scope reopens only when it is held by a
 * finished forget and no forget is left awaiting confirmation or pending;
 * otherwise (restore, another forget) it stays closed and the result says so.
 * The projection was kept equal to a ledger rebuild by every forget chunk.
 */
export function applyReopen(
	db: WorldDb,
	op: ReopenOp,
	scope: ScopeRef,
	context: Context,
): null {
	deleteCheckpoint(
		db,
		scope,
		awaitingFeedFor(scope, op.forgetId, context.hasher),
		AWAITING_EPOCH,
	);
	const gate = getGate(db, scope);
	const heldByForget =
		gate?.state === "closed" &&
		(gate.reasonCode === FORGET_COMPLETE_GATE_REASON ||
			gate.reasonCode.startsWith(`${FORGET_COMPLETE_GATE_REASON}:`));
	if (
		heldByForget &&
		awaitingConfirmations(db, scope) === 0 &&
		countAllPendingTargets(db, scope) === 0
	)
		must(
			openGate(db, scope, { restoreEpoch: context.hostChecks.restoreEpoch }),
			"REOPEN",
		);
	return null;
}
