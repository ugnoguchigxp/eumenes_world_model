import {
	CANONICAL_VERSION,
	canonicalDigest,
	type CanonicalHasher,
} from "../../contracts/index.ts";
import {
	addInput,
	getAssertion,
	getHead,
	getInputRevision,
	insertAssertion,
	insertEvidence,
	insertInputs,
	applyTransition,
} from "../../domains/assertions/sqlite.ts";
import {
	applyMergePlan,
	applySplitPlan,
	registerEntity,
} from "../../domains/identity/sqlite.ts";
import {
	getOperation,
	recordOperation,
} from "../../domains/lifecycle/sqlite.ts";
import {
	insertOutcome,
	insertPrediction,
} from "../../domains/scenarios/sqlite.ts";
import {
	requireTransaction,
	WorldIntegrityError,
	type WorldDb,
} from "../../infrastructure/sqlite/db.ts";
import { operationDigest } from "./digest.ts";
import {
	blockedResult,
	checkAccess,
	ledgerGuards,
	parseEnvelope,
	rejectedResult,
} from "./checks.ts";
import {
	applyForget,
	applyReopen,
	forgetProgress,
	precheckForget,
	precheckReopen,
} from "./forget.ts";
import {
	bindScope,
	precheckAssertionRows,
	precheckTransitionPlan,
} from "./prechecks.ts";
import { applyInvalidate, resolveInvalidations } from "./invalidate.ts";
import {
	applyHeadChanges,
	hasMissingContradictionTarget,
} from "./projection.ts";
import {
	applyRestore,
	precheckRestore,
	restoreProgress,
	type Refusal,
} from "./restore.ts";
import {
	applyReceive,
	applySettle,
	precheckReceive,
	precheckSettle,
} from "./settle.ts";
import {
	type WorldOperationInput,
	type WorldOperationResult,
} from "./types.ts";

export interface ApplyDeps {
	/** Synchronous SHA-256 supplied by the host; World never hides IO in it. */
	readonly hasher: CanonicalHasher;
}

type Rejection = { readonly status: "rejected"; readonly reasonCode: string };
const isRejection = (value: unknown): value is Rejection =>
	typeof value === "object" &&
	value !== null &&
	(value as { status?: unknown }).status === "rejected";

/** After the first DML a rejection means an inconsistent ledger: roll back. */
function must(result: unknown, stage: string): void {
	if (isRejection(result))
		throw new WorldIntegrityError(`${stage}:${result.reasonCode}`);
}

const receiptRef = (input: WorldOperationInput, hasher: CanonicalHasher) => {
	const digest = canonicalDigest(
		[input.scope.principal, input.scope.scopeKey, input.operationKey],
		hasher,
	);
	if (!digest.ok) throw new WorldIntegrityError("RECEIPT_REF");
	return `rcpt-${digest.value.slice("sha256:".length, "sha256:".length + 32)}`;
};

/** Foreseeable rejections that need only reads. Null means the DML may begin. */
function precheck(
	db: WorldDb,
	input: WorldOperationInput,
	deps: ApplyDeps,
): Refusal | null {
	const op = input.operation;
	switch (op.kind) {
		case "restore.begin":
		case "restore.register":
		case "restore.reconcile":
		case "restore.finish":
		case "rebuild":
			return precheckRestore(db, op, input.scope, {
				hasher: deps.hasher,
				clock: input.clock,
				hostChecks: input.hostChecks,
			});
		case "assertion.register": {
			const scoped = bindScope(input.scope, op.assertion?.scope);
			if (scoped) return scoped;
			const id = (op.assertion as { id?: unknown }).id;
			if (typeof id !== "string") return rejectedResult("INVALID_INPUT");
			const rows = precheckAssertionRows(op.assertion);
			if (rows) return rows;
			if (getHead(db, input.scope, id))
				return rejectedResult("REVISION_CONFLICT");
			if (hasMissingContradictionTarget(db, input.scope, [op.assertion]))
				return rejectedResult("CONTRADICTION_TARGET_NOT_FOUND");
			return null;
		}
		case "assertion.transition": {
			const plan = op.plan;
			if (typeof plan?.id !== "string") return rejectedResult("INVALID_INPUT");
			const scoped =
				bindScope(input.scope, plan.scope) ??
				(op.replacement ? bindScope(input.scope, op.replacement.scope) : null);
			if (scoped) return scoped;
			const head = getHead(db, input.scope, plan.id);
			if (!head) return rejectedResult("ASSERTION_NOT_FOUND");
			if (head.currentRevision !== plan.expectedRevision)
				return rejectedResult("REVISION_CONFLICT");
			const consistent = precheckTransitionPlan(
				db,
				input.scope,
				plan,
				op.replacement,
			);
			if (consistent) return consistent;
			if (
				op.replacement &&
				hasMissingContradictionTarget(db, input.scope, [op.replacement])
			)
				return rejectedResult("CONTRADICTION_TARGET_NOT_FOUND");
			if (plan.reasonSource) {
				// The reason source becomes an input of the next revision: the same
				// source at another revision would be a conflicting dependency.
				const recorded = getInputRevision(
					db,
					input.scope,
					{ id: plan.id, revision: plan.expectedRevision },
					plan.reasonSource,
				);
				if (recorded !== undefined && recorded !== plan.reasonSource.revision)
					return rejectedResult("CONFLICTING_INPUT_REVISIONS");
			}
			return null;
		}
		case "prediction.register": {
			const basis = op.input?.basis;
			if (
				basis !== undefined &&
				!getAssertion(db, input.scope, basis.assertionId, basis.revision)
			)
				return rejectedResult("BASIS_NOT_FOUND");
			return null;
		}
		case "inbox.receive":
			return precheckReceive(op, input.scope, input.hostChecks);
		case "candidate.settle":
			return precheckSettle(db, op, input.scope, input.hostChecks);
		case "invalidate": {
			const resolved = resolveInvalidations(db, op, input.scope);
			return "status" in resolved ? resolved : null;
		}
		case "forget.chunk":
			return precheckForget(db, op, input.scope);
		case "forget.reopen":
			return precheckReopen(db, op, input.scope, deps.hasher);
		default:
			return null;
	}
}

function applyLedger(
	db: WorldDb,
	input: WorldOperationInput,
	deps: ApplyDeps,
): Refusal | null {
	const op = input.operation;
	const scope = input.scope;
	const context = {
		hasher: deps.hasher,
		clock: input.clock,
		hostChecks: input.hostChecks,
	};
	switch (op.kind) {
		case "entity.register": {
			const result = registerEntity(db, scope, op.entity);
			return result.status === "rejected" ? result : null;
		}
		case "entity.merge": {
			const result = applyMergePlan(db, scope, op.plan);
			return result.status === "rejected" ? result : null;
		}
		case "entity.split": {
			const result = applySplitPlan(db, scope, op.plan);
			return result.status === "rejected" ? result : null;
		}
		case "assertion.register": {
			// The first ledger call may reject before any DML; later ones may not.
			const first = insertAssertion(db, op.assertion);
			if (first.status === "rejected") return first;
			const ref = { id: op.assertion.id, revision: op.assertion.revision };
			must(insertEvidence(db, scope, ref, op.assertion.evidence), "EVIDENCE");
			must(insertInputs(db, scope, ref, op.assertion.inputManifest), "INPUTS");
			applyHeadChanges(db, scope, context, [{ next: op.assertion }]);
			return null;
		}
		case "assertion.transition": {
			const old = getAssertion(db, scope, op.plan.id);
			const first = applyTransition(db, op.plan, op.replacement);
			if (first.status === "rejected") return first;
			if (op.replacement) {
				const ref = {
					id: op.replacement.id,
					revision: op.replacement.revision,
				};
				must(
					insertEvidence(db, scope, ref, op.replacement.evidence),
					"EVIDENCE",
				);
				must(
					insertInputs(db, scope, ref, op.replacement.inputManifest),
					"INPUTS",
				);
			}
			if (op.plan.reasonSource)
				must(
					addInput(
						db,
						scope,
						{ id: op.plan.id, revision: op.plan.nextRevision },
						op.plan.reasonSource,
					),
					"REASON_SOURCE",
				);
			const next = getAssertion(db, scope, op.plan.id);
			if (!old || !next) throw new WorldIntegrityError("HEAD_WITHOUT_ROW");
			applyHeadChanges(db, scope, context, [{ old, next }]);
			return null;
		}
		case "prediction.register": {
			const result = insertPrediction(db, scope, op.input);
			return result.status === "rejected" ? result : null;
		}
		case "outcome.register": {
			const result = insertOutcome(db, scope, op.input);
			return result.status === "rejected" ? result : null;
		}
		case "inbox.receive":
			return applyReceive(db, op, scope, input.hostChecks);
		case "candidate.settle":
			return applySettle(db, op, scope, context);
		case "invalidate":
			return applyInvalidate(db, op, scope, context);
		case "forget.chunk":
			return applyForget(db, op, scope, context);
		case "forget.reopen":
			return applyReopen(db, op, scope, context);
		case "restore.begin":
		case "restore.register":
		case "restore.reconcile":
		case "restore.finish":
		case "rebuild":
			return applyRestore(db, op, scope, context);
		default:
			return rejectedResult("OPERATION_NOT_IMPLEMENTED");
	}
}

/**
 * C8 coordinated write. Runs inside the host's transaction and never opens,
 * commits or rolls one back. "applied"/"no_op" means applied in the CURRENT
 * transaction; the host commits after its own follow-up steps. Rejections are
 * decided before any DML; anything unexpected afterwards throws so the host
 * rolls everything back.
 */
export function applyWorldOperation(
	db: WorldDb,
	rawInput: unknown,
	deps: ApplyDeps,
): WorldOperationResult {
	requireTransaction(db);
	const parsed = parseEnvelope(rawInput);
	if (!parsed.ok) return rejectedResult(parsed.code);
	const input = parsed.value;
	const access = checkAccess(
		input.access,
		input.scope,
		input.hostChecks.policyRevision,
	);
	if (access === "SCOPE_NOT_PERMITTED") return rejectedResult(access);
	const forgetting =
		input.operation.kind === "forget.chunk" ||
		input.operation.kind === "forget.reopen";
	// Restore steps run while the gate is closed by design; they carry no
	// source versions and are checked by their own precheck.
	const restoring = input.operation.kind.startsWith("restore.");
	// Deleting must never wait on a policy change, the gate, a model or World ON/OFF.
	if (access === "POLICY_CHANGED" && !forgetting) return blockedResult(access);

	// Current gate / tombstone / source state is re-checked even for a resend.
	if (!forgetting && !restoring) {
		const guard = ledgerGuards(db, input);
		if (guard) return guard;
	}

	const digest = operationDigest(input, deps.hasher);
	if (!digest.ok) return rejectedResult(digest.code);

	const existing = getOperation(db, input.scope, input.operationKey);
	if (existing) {
		if (
			existing.payloadDigest !== digest.value ||
			existing.canonicalVersion !== CANONICAL_VERSION
		)
			return rejectedResult("OPERATION_KEY_CONFLICT");
		// The operation's own advanced expectedRevision is deliberately not checked.
		return withProgress(db, input, {
			status: "no_op",
			receipt: { ref: existing.receiptRef },
		});
	}

	const refused = precheck(db, input, deps);
	if (refused) return refused;
	const refusedByLedger = applyLedger(db, input, deps);
	if (refusedByLedger) return refusedByLedger;

	const ref = receiptRef(input, deps.hasher);
	must(
		recordOperation(db, input.scope, {
			operationKey: input.operationKey,
			kind: input.operation.kind,
			payloadDigest: digest.value,
			canonicalVersion: CANONICAL_VERSION,
			resultStatus: "applied",
			receiptRef: ref,
		}),
		"OPERATION",
	);
	return withProgress(db, input, { status: "applied", receipt: { ref } });
}

/** forget.chunk reports the whole forget's state next to the chunk result. */
function withProgress(
	db: WorldDb,
	input: WorldOperationInput,
	result: Extract<WorldOperationResult, { receipt: unknown }>,
): WorldOperationResult {
	if (input.operation.kind.startsWith("restore.")) {
		const restore = restoreProgress(db, input.operation, input.scope);
		return restore ? { ...result, restore } : result;
	}
	if (
		input.operation.kind !== "forget.chunk" &&
		input.operation.kind !== "forget.reopen"
	)
		return result;
	const forget = forgetProgress(db, input.scope, input.operation.forgetId);
	return forget ? { ...result, forget } : result;
}
