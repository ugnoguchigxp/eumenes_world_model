import { asRecord, checkId, type ScopeRef } from "../../contracts/index.ts";
import {
	invalidationReasons,
	planAssertionTransition,
	terminalLifecycles,
	type TransitionPlan,
} from "../../domains/assertions/index.ts";
import {
	applyTransition,
	getAssertion,
	getHead,
	listAssertionsBySourceKeys,
} from "../../domains/assertions/sqlite.ts";
import {
	WorldIntegrityError,
	type WorldDb,
} from "../../infrastructure/sqlite/db.ts";
import { rejectedResult } from "./checks.ts";
import { applyHeadChanges, type HeadChange } from "./projection.ts";
import {
	maxInvalidateTargets,
	type HostChecks,
	type WorldOperation,
} from "./types.ts";

type Op = Extract<WorldOperation, { kind: "invalidate" }>;
type Rejection = { readonly status: "rejected"; readonly reasonCode: string };
interface Context {
	readonly hasher: import("../../contracts/index.ts").CanonicalHasher;
	readonly clock: number;
	readonly hostChecks: HostChecks;
}

/**
 * Reads only. Resolves every target to a pure TransitionPlan (or a refusal),
 * so no rejection is possible once the first DML has run.
 */
export function resolveInvalidations(
	db: WorldDb,
	op: Op,
	scope: ScopeRef,
): { readonly plans: readonly TransitionPlan[] } | Rejection {
	if (
		!invalidationReasons.includes(op.reasonCode) ||
		!Array.isArray(op.targets) ||
		op.targets.length > maxInvalidateTargets ||
		(op.sourceKeys !== undefined &&
			(!Array.isArray(op.sourceKeys) ||
				op.sourceKeys.length > 100 ||
				!op.sourceKeys.every((key) => typeof key === "string" && key !== "")))
	)
		return rejectedResult("INVALID_INPUT");
	const wanted = new Map<string, number | undefined>();
	for (const target of op.targets) {
		if (
			!asRecord(target) ||
			!checkId(target.id).ok ||
			!Number.isSafeInteger(target.expectedRevision) ||
			target.expectedRevision < 1 ||
			wanted.has(target.id)
		)
			return rejectedResult("INVALID_INPUT");
		wanted.set(target.id, target.expectedRevision);
	}
	if (op.sourceKeys && op.sourceKeys.length > 0) {
		const found = listAssertionsBySourceKeys(db, scope, op.sourceKeys, 500);
		if (found.truncated) return rejectedResult("LIMIT_EXCEEDED");
		// Only HEAD revisions that still depend on the source: an older revision
		// that cited it must not stop a head that no longer does.
		for (const ref of found.refs)
			if (
				!wanted.has(ref.id) &&
				getHead(db, scope, ref.id)?.currentRevision === ref.revision
			)
				wanted.set(ref.id, undefined);
	}
	if (wanted.size > maxInvalidateTargets * 10)
		return rejectedResult("LIMIT_EXCEEDED");
	if (wanted.size === 0 && op.targets.length === 0 && !op.sourceKeys?.length)
		return rejectedResult("INVALID_INPUT");

	const plans: TransitionPlan[] = [];
	for (const [id, expected] of [...wanted].sort(([a], [b]) =>
		a < b ? -1 : 1,
	)) {
		const head = getHead(db, scope, id);
		if (!head) {
			if (expected !== undefined) return rejectedResult("ASSERTION_NOT_FOUND");
			continue;
		}
		if (expected !== undefined && head.currentRevision !== expected)
			return rejectedResult("REVISION_CONFLICT");
		const current = getAssertion(db, scope, id, head.currentRevision);
		if (!current) throw new WorldIntegrityError("HEAD_WITHOUT_ROW");
		if (terminalLifecycles.includes(current.lifecycle)) {
			// Explicitly named terminal assertion is a caller error; a source
			// sweep simply skips what is already stopped.
			if (expected !== undefined) return rejectedResult("TERMINAL_STATE");
			continue;
		}
		const planned = planAssertionTransition({
			contractVersion: 1,
			scope,
			current: {
				id,
				revision: current.revision,
				scope,
				lifecycle: current.lifecycle,
				origin: current.origin,
			},
			expectedRevision: current.revision,
			request: { action: "invalidate", reasonCode: op.reasonCode },
			registeredAdoptionRules: [],
		});
		if (!planned.ok) return rejectedResult(planned.code);
		if (planned.value.status === "rejected")
			return rejectedResult(planned.value.reasonCode);
		plans.push(planned.value.plan);
	}
	return { plans };
}

/** Old revisions stop first, then the projection and epoch are rebuilt once. */
export function applyInvalidate(
	db: WorldDb,
	op: Op,
	scope: ScopeRef,
	context: Context,
): Rejection | null {
	const resolved = resolveInvalidations(db, op, scope);
	if ("status" in resolved) return resolved;
	const changes: HeadChange[] = [];
	for (const plan of resolved.plans) {
		const old = getAssertion(db, scope, plan.id);
		const result = applyTransition(db, plan);
		if (result.status === "rejected")
			throw new WorldIntegrityError(`INVALIDATE:${result.reasonCode}`);
		const next = getAssertion(db, scope, plan.id);
		if (!old || !next) throw new WorldIntegrityError("HEAD_WITHOUT_ROW");
		changes.push({ old, next });
	}
	if (changes.length > 0) applyHeadChanges(db, scope, context, changes);
	return null;
}
