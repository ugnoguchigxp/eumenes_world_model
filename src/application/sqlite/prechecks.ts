import {
	asRecord,
	canonicalBytes,
	limits,
	sameScope,
	type ScopeRef,
	type SourceRef,
} from "../../contracts/index.ts";
import {
	sourceInputKey,
	sourceIdentityKey,
	transitionTable,
	type Assertion,
	type TransitionPlan,
} from "../../domains/assertions/index.ts";
import { getAssertion } from "../../domains/assertions/sqlite.ts";
import type { WorldDb } from "../../infrastructure/sqlite/db.ts";
import { rejectedResult } from "./checks.ts";

type Refusal = ReturnType<typeof rejectedResult>;

const scopeOfPayload = (value: unknown): ScopeRef | undefined => {
	const record = asRecord(value);
	return typeof record?.["principal"] === "string" &&
		typeof record["scopeKey"] === "string"
		? { principal: record["principal"], scopeKey: record["scopeKey"] }
		: undefined;
};

/**
 * The write goes to the envelope Scope that access, gate and tombstones were
 * checked for. A payload naming another Scope is refused before any read, so
 * the answer cannot reveal anything about that Scope.
 */
export function bindScope(
	envelope: ScopeRef,
	payloadScope: unknown,
): Refusal | null {
	const scope = scopeOfPayload(payloadScope);
	return scope && sameScope(scope, envelope)
		? null
		: rejectedResult("SCOPE_MISMATCH");
}

/** Evidence and input rows an assertion write will create, validated up front. */
export function precheckAssertionRows(
	assertion: Assertion,
	extraInputs: readonly SourceRef[] = [],
): Refusal | null {
	const evidence = Array.isArray(assertion.evidence) ? assertion.evidence : [];
	if (new Set(evidence.map((item) => item.evidenceId)).size !== evidence.length)
		return rejectedResult("DUPLICATE_EVIDENCE");
	for (const item of evidence)
		if (!canonicalBytes(item).ok) return rejectedResult("LIMIT_EXCEEDED");
	const byIdentity = new Map<string, SourceRef>();
	const seen = new Set<string>();
	const inputs = [
		...(Array.isArray(assertion.inputManifest) ? assertion.inputManifest : []),
		...extraInputs,
	];
	for (const ref of inputs) {
		const full = sourceInputKey(ref);
		if (seen.has(full)) continue;
		seen.add(full);
		const identity = sourceIdentityKey(ref);
		if (byIdentity.has(identity))
			return rejectedResult("CONFLICTING_INPUT_REVISIONS");
		byIdentity.set(identity, ref);
	}
	if (byIdentity.size > limits.manifestDependencies)
		return rejectedResult("LIMIT_EXCEEDED");
	return null;
}

/** The plan must agree with the single transition table and the stored head. */
export function precheckTransitionPlan(
	db: WorldDb,
	scope: ScopeRef,
	plan: TransitionPlan,
	replacement: Assertion | undefined,
): Refusal | null {
	const edge = (
		transitionTable as Record<
			string,
			{ from: readonly string[]; to: string } | undefined
		>
	)[plan.action];
	if (
		!edge ||
		!edge.from.includes(plan.from) ||
		plan.to !== edge.to ||
		plan.nextRevision !== plan.expectedRevision + 1 ||
		plan.nextLifecycle !== (plan.action === "supersede" ? "candidate" : edge.to)
	)
		return rejectedResult("TRANSITION_NOT_ALLOWED");
	const head = getAssertion(db, scope, plan.id);
	if (head && head.lifecycle !== plan.from)
		return rejectedResult("LIFECYCLE_MISMATCH");
	// A dispute must name stored targets, otherwise the incremental projection
	// (which cannot back-fill a later target) would drift from a rebuild.
	for (const target of Array.isArray(plan.contradicts) ? plan.contradicts : [])
		if (!getAssertion(db, scope, target.id, target.revision))
			return rejectedResult("CONTRADICTION_TARGET_NOT_FOUND");
	if (replacement) {
		const refused = precheckAssertionRows(replacement);
		if (refused) return refused;
	}
	return null;
}
