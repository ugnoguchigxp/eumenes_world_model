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
	listAssertionsReferencingEntity,
} from "../../domains/assertions/sqlite.ts";
import {
	deleteEntities,
	listMergedMembers,
} from "../../domains/identity/sqlite.ts";
import {
	deleteInbox,
	deleteManifests,
	getManifest,
	listManifestsBySourceKeys,
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
	listPredictionsReferencingEntity,
} from "../../domains/scenarios/sqlite.ts";
import {
	WorldIntegrityError,
	type WorldDb,
} from "../../infrastructure/sqlite/db.ts";
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

/** Reverse dependencies of one target, read from the ledger (bounded). */
function discover(
	db: WorldDb,
	scope: ScopeRef,
	target: DependentRef,
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
			// Entities merged into this one must go with it (their payload is
			// already folded into the representative, and the row would dangle).
			const members = listMergedMembers(db, scope, target.id, discoverLimit);
			for (const id of members.ids)
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
			const predictions = listPredictionsReferencingEntity(
				db,
				scope,
				target.id,
				discoverLimit,
			);
			for (const ref of predictions.refs)
				refs.push({ kind: "prediction", id: ref.id, revision: ref.revision });
			// Assertions that only mention the entity (relation object or entity
			// reference value) also carry its identity in their payload.
			const mentions = listAssertionsReferencingEntity(
				db,
				scope,
				target.id,
				discoverLimit,
			);
			for (const ref of mentions.refs)
				refs.push({ kind: "assertion", id: ref.id, revision: ref.revision });
			truncated =
				about.truncated ||
				members.truncated ||
				mentions.truncated ||
				predictions.truncated;
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
		deleteProjectionFor(db, scope, assertionRefs);
		removeHeads(db, scope, context, heads);
		must(deleteAssertions(db, scope, assertionRefs), "ASSERTIONS");
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
		for (const target of batch) {
			if (discovered >= discoverBudget) break;
			const found = discover(db, scope, target);
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
		for (let changed = true; changed;) {
			changed = false;
			const inBatch = new Set(
				processed.filter((ref) => ref.kind === "entity").map((ref) => ref.id),
			);
			const kept = processed.filter(
				(ref) =>
					ref.kind !== "entity" ||
					listMergedMembers(db, scope, ref.id, discoverLimit).ids.every((id) =>
						inBatch.has(id),
					),
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

/** Reads only. Reopening needs every cleanup step to be demonstrably done. */
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
	if (!gate || gate.state !== "closed")
		return { status: "blocked", reasonCode: "GATE_NOT_CLOSED" };
	// A restore (or another forget) keeps its own gate and its own way back.
	if (!gate.reasonCode.startsWith(`${FORGET_COMPLETE_GATE_REASON}:`))
		return { status: "blocked", reasonCode: "GATE_HELD_BY_OTHER_PROCEDURE" };
	if (gate.reasonCode !== completeGateReason(op.forgetId, hasher))
		return { status: "blocked", reasonCode: "GATE_OWNED_BY_OTHER_FORGET" };
	return null;
}

/**
 * The projection was kept equal to a ledger rebuild by every forget chunk
 * (incremental removal), so completion already implies it is rebuilt.
 */
export function applyReopen(
	db: WorldDb,
	op: ReopenOp,
	scope: ScopeRef,
	context: Context,
): null {
	void op;
	must(
		openGate(db, scope, { restoreEpoch: context.hostChecks.restoreEpoch }),
		"REOPEN",
	);
	return null;
}
