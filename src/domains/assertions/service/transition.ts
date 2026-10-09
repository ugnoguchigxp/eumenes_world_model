import { fail, ok, sameScope, type Checked } from "../../../contracts/index.ts";
import {
	checkTransitionInput,
	terminalLifecycles,
	transitionTable,
	type TransitionPlan,
	type TransitionRejectCode,
	type TransitionResult,
} from "../contracts/transition.ts";

const reject = (reasonCode: TransitionRejectCode): TransitionResult => ({
	status: "rejected",
	reasonCode,
});

/**
 * Plans the next revision for a lifecycle change. Pure; never mutates input.
 * Check order: scope, revision, table edge, edge-specific requirements.
 * The host owns facts this function cannot see: that a dispute's
 * contradicting assertions overlap in subject/predicate/condition, that a
 * retraction's reasonSource is available in the Scope, and that a resolution
 * refers to the disputed claim. The application layer re-checks source
 * availability and tombstones before any write.
 */
export function planAssertionTransition(
	input: unknown,
): Checked<TransitionResult> {
	const parsed = checkTransitionInput(input);
	if (!parsed.ok) return parsed;
	const { scope, current, expectedRevision, request } = parsed.value;
	if (!sameScope(scope, current.scope))
		return ok(reject("SCOPE_NOT_PERMITTED"));
	// A stale request (e.g. a correction of rev1 after rev2 exists) is refused
	// before any table lookup, so it can never revive an older revision.
	if (expectedRevision !== current.revision)
		return ok(reject("REVISION_CONFLICT"));
	const edge = transitionTable[request.action];
	if (!edge.from.includes(current.lifecycle))
		return ok(
			reject(
				terminalLifecycles.includes(current.lifecycle)
					? "TERMINAL_STATE"
					: "TRANSITION_NOT_ALLOWED",
			),
		);
	// The next revision must remain a safe integer (C2).
	if (current.revision >= Number.MAX_SAFE_INTEGER)
		return fail("LIMIT_EXCEEDED", "current.revision");
	const nextRevision = current.revision + 1;
	const self = { id: current.id, revision: current.revision };
	const base = {
		action: request.action,
		id: current.id,
		scope: current.scope,
		from: current.lifecycle,
		to: edge.to,
		expectedRevision,
		nextRevision,
		nextLifecycle: edge.to,
		stopsUseOf: [] as TransitionPlan["stopsUseOf"],
		supersedes: [] as TransitionPlan["supersedes"],
		contradicts: [] as TransitionPlan["contradicts"],
	};
	let plan: TransitionPlan;
	switch (request.action) {
		case "adopt": {
			if (!request.subjectConfirmedByHost)
				return ok(reject("HOST_CONFIRMATION_REQUIRED"));
			if (
				request.adoption.kind === "rule" &&
				!parsed.value.registeredAdoptionRules.includes(request.adoption.ruleId)
			)
				return ok(reject("ADOPTION_RULE_NOT_REGISTERED"));
			plan = { ...base, adoption: request.adoption };
			break;
		}
		case "dispute": {
			if (
				// Any revision of this very assertion (current or older) is not an
				// independent contradiction. Whether a listed assertion really shares
				// subject, predicate and overlapping conditions is a host fact checked
				// before the request is built; this pure function cannot see it.
				request.contradicts.some((ref) => ref.id === current.id)
			)
				return ok(reject("SELF_CONTRADICTION"));
			plan = { ...base, contradicts: request.contradicts };
			break;
		}
		case "resolve":
			plan = {
				...base,
				resolution: request.resolution,
				reasonCode: request.reasonCode,
			};
			break;
		case "supersede": {
			if (request.replacementRevision !== nextRevision)
				return ok(reject("REPLACEMENT_REVISION_MISMATCH"));
			// Old revision stops and the new one points back, in one plan.
			plan = {
				...base,
				nextLifecycle: "candidate",
				stopsUseOf: [self],
				supersedes: [self],
			};
			break;
		}
		case "retract":
			plan = {
				...base,
				stopsUseOf: [self],
				reasonSource: request.reasonSource,
			};
			break;
		case "invalidate":
			plan = {
				...base,
				stopsUseOf: [self],
				reasonCode: request.reasonCode,
			};
			break;
	}
	return ok({ status: "planned", plan });
}
