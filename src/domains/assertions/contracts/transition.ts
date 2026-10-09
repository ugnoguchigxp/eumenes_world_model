import {
	asRecord,
	checkContractVersion,
	checkId,
	checkOpaque,
	checkRevision,
	checkScope,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
	type ScopeRef,
	type SourceRef,
} from "../../../contracts/index.ts";
import {
	checkAssertionRefList,
	lifecycles,
	origins,
	type AssertionRef,
	type Lifecycle,
	type Origin,
} from "./assertion.ts";
import { checkSourceRef } from "./evidence.ts";

export const transitionActions = [
	"adopt",
	"dispute",
	"resolve",
	"supersede",
	"retract",
	"invalidate",
] as const;
export type TransitionAction = (typeof transitionActions)[number];

export const terminalLifecycles: readonly Lifecycle[] = [
	"superseded",
	"retracted",
	"invalidated",
];

/**
 * The single transition table (C4): action -> allowed current lifecycles and
 * the lifecycle it leads to. Every other (state, action) pair is forbidden.
 */
export const transitionTable: Readonly<
	Record<
		TransitionAction,
		{ readonly from: readonly Lifecycle[]; readonly to: Lifecycle }
	>
> = {
	adopt: { from: ["candidate"], to: "active" },
	dispute: { from: ["active"], to: "disputed" },
	resolve: { from: ["disputed"], to: "active" },
	supersede: {
		from: ["candidate", "active", "disputed"],
		to: "superseded",
	},
	retract: { from: ["candidate", "active", "disputed"], to: "retracted" },
	invalidate: {
		from: ["candidate", "active", "disputed"],
		to: "invalidated",
	},
};

export const invalidationReasons = [
	"INPUT_VERSION_INVALIDATED",
	"SOURCE_RETRACTED",
	"AUTHORIZATION_FAILED",
	"RESTORE_CHECK_FAILED",
] as const;
export type InvalidationReason = (typeof invalidationReasons)[number];

/** Adoption is a registered deterministic rule or an explicit operation. */
export type Adoption =
	| { readonly kind: "rule"; readonly ruleId: string }
	| { readonly kind: "explicit"; readonly operationId: string };

export type TransitionRequest =
	| {
			readonly action: "adopt";
			readonly adoption: Adoption;
			/** Host confirmed the subject/scope; the model cannot assert this. */
			readonly subjectConfirmedByHost: boolean;
	  }
	| {
			readonly action: "dispute";
			readonly contradicts: readonly AssertionRef[];
	  }
	| {
			readonly action: "resolve";
			readonly resolution: { readonly id: string; readonly revision: number };
			readonly reasonCode: string;
	  }
	| { readonly action: "supersede"; readonly replacementRevision: number }
	| { readonly action: "retract"; readonly reasonSource: SourceRef }
	| { readonly action: "invalidate"; readonly reasonCode: InvalidationReason };

export interface CurrentAssertion {
	readonly id: string;
	readonly revision: number;
	readonly scope: ScopeRef;
	readonly lifecycle: Lifecycle;
	readonly origin: Origin;
}
export interface TransitionInput {
	readonly scope: ScopeRef;
	readonly current: CurrentAssertion;
	/** Revision the caller based the request on. */
	readonly expectedRevision: number;
	readonly request: TransitionRequest;
	/** Host-registered deterministic adoption rule IDs. */
	readonly registeredAdoptionRules: readonly string[];
}

export type TransitionRejectCode =
	| "SCOPE_NOT_PERMITTED"
	| "REVISION_CONFLICT"
	| "TERMINAL_STATE"
	| "TRANSITION_NOT_ALLOWED"
	| "ADOPTION_RULE_NOT_REGISTERED"
	| "HOST_CONFIRMATION_REQUIRED"
	| "SELF_CONTRADICTION"
	| "REPLACEMENT_REVISION_MISMATCH";

export interface TransitionPlan {
	readonly action: TransitionAction;
	readonly id: string;
	readonly scope: ScopeRef;
	readonly from: Lifecycle;
	readonly to: Lifecycle;
	readonly expectedRevision: number;
	readonly nextRevision: number;
	/** Lifecycle carried by the next revision. */
	readonly nextLifecycle: Lifecycle;
	/** Older revisions whose use stops with this plan. */
	readonly stopsUseOf: readonly AssertionRef[];
	/** New revision links back to what it replaces (supersede only). */
	readonly supersedes: readonly AssertionRef[];
	readonly contradicts: readonly AssertionRef[];
	readonly adoption?: Adoption;
	readonly resolution?: { readonly id: string; readonly revision: number };
	readonly reasonSource?: SourceRef;
	readonly reasonCode?: string;
}
export type TransitionResult =
	| { readonly status: "planned"; readonly plan: TransitionPlan }
	| { readonly status: "rejected"; readonly reasonCode: TransitionRejectCode };

function strict(
	object: Record<string, unknown>,
	keys: readonly string[],
	path: string,
) {
	const extra = firstUnknownKey(object, keys);
	return extra === undefined
		? undefined
		: fail("INVALID_INPUT", `${path}.${extra}`);
}

function checkAdoption(value: unknown, path: string): Checked<Adoption> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	if (object["kind"] === "rule") {
		const bad = strict(object, ["kind", "ruleId"], path);
		if (bad) return bad;
		const ruleId = checkId(object["ruleId"], `${path}.ruleId`);
		return ruleId.ok ? ok({ kind: "rule", ruleId: ruleId.value }) : ruleId;
	}
	if (object["kind"] === "explicit") {
		const bad = strict(object, ["kind", "operationId"], path);
		if (bad) return bad;
		const operationId = checkId(object["operationId"], `${path}.operationId`);
		return operationId.ok
			? ok({ kind: "explicit", operationId: operationId.value })
			: operationId;
	}
	return fail("INVALID_INPUT", `${path}.kind`);
}

export function checkTransitionRequest(
	value: unknown,
	path = "request",
): Checked<TransitionRequest> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	switch (object["action"]) {
		case "adopt": {
			const bad = strict(
				object,
				["action", "adoption", "subjectConfirmedByHost"],
				path,
			);
			if (bad) return bad;
			const adoption = checkAdoption(object["adoption"], `${path}.adoption`);
			if (!adoption.ok) return adoption;
			if (typeof object["subjectConfirmedByHost"] !== "boolean")
				return fail("INVALID_INPUT", `${path}.subjectConfirmedByHost`);
			return ok({
				action: "adopt",
				adoption: adoption.value,
				subjectConfirmedByHost: object["subjectConfirmedByHost"],
			});
		}
		case "dispute": {
			const bad = strict(object, ["action", "contradicts"], path);
			if (bad) return bad;
			const refs = checkAssertionRefList(
				object["contradicts"],
				`${path}.contradicts`,
			);
			if (!refs.ok) return refs;
			if (refs.value.length === 0)
				return fail("INVALID_INPUT", `${path}.contradicts`);
			// A set: duplicates collapse and the order is canonical, so the same
			// set always yields the same plan (and canonical operation digest).
			const unique = new Map(
				refs.value.map((ref) => [JSON.stringify([ref.id, ref.revision]), ref]),
			);
			const contradicts = [...unique.values()].sort((a, b) =>
				a.id !== b.id ? (a.id < b.id ? -1 : 1) : a.revision - b.revision,
			);
			return ok({ action: "dispute", contradicts });
		}
		case "resolve": {
			const bad = strict(object, ["action", "resolution", "reasonCode"], path);
			if (bad) return bad;
			const resolution = asRecord(object["resolution"]);
			if (!resolution) return fail("INVALID_INPUT", `${path}.resolution`);
			const resolutionBad = strict(
				resolution,
				["id", "revision"],
				`${path}.resolution`,
			);
			if (resolutionBad) return resolutionBad;
			const id = checkId(resolution["id"], `${path}.resolution.id`);
			if (!id.ok) return id;
			const revision = checkRevision(
				resolution["revision"],
				`${path}.resolution.revision`,
			);
			if (!revision.ok) return revision;
			const reason = checkOpaque(object["reasonCode"], `${path}.reasonCode`);
			if (!reason.ok) return reason;
			return ok({
				action: "resolve",
				resolution: { id: id.value, revision: revision.value },
				reasonCode: reason.value,
			});
		}
		case "supersede": {
			const bad = strict(object, ["action", "replacementRevision"], path);
			if (bad) return bad;
			const revision = checkRevision(
				object["replacementRevision"],
				`${path}.replacementRevision`,
			);
			return revision.ok
				? ok({ action: "supersede", replacementRevision: revision.value })
				: revision;
		}
		case "retract": {
			const bad = strict(object, ["action", "reasonSource"], path);
			if (bad) return bad;
			const source = checkSourceRef(
				object["reasonSource"],
				`${path}.reasonSource`,
			);
			return source.ok
				? ok({ action: "retract", reasonSource: source.value })
				: source;
		}
		case "invalidate": {
			const bad = strict(object, ["action", "reasonCode"], path);
			if (bad) return bad;
			if (
				!invalidationReasons.includes(
					object["reasonCode"] as InvalidationReason,
				)
			)
				return fail("INVALID_INPUT", `${path}.reasonCode`);
			return ok({
				action: "invalidate",
				reasonCode: object["reasonCode"] as InvalidationReason,
			});
		}
		default:
			return fail("INVALID_INPUT", `${path}.action`);
	}
}

export function checkTransitionInput(value: unknown): Checked<TransitionInput> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", "input");
	const bad = strict(
		object,
		[
			"contractVersion",
			"scope",
			"current",
			"expectedRevision",
			"request",
			"registeredAdoptionRules",
		],
		"input",
	);
	if (bad) return bad;
	const version = checkContractVersion(object["contractVersion"]);
	if (!version.ok) return version;
	const scope = checkScope(object["scope"]);
	if (!scope.ok) return scope;
	const current = asRecord(object["current"]);
	if (!current) return fail("INVALID_INPUT", "current");
	const currentBad = strict(
		current,
		["id", "revision", "scope", "lifecycle", "origin"],
		"current",
	);
	if (currentBad) return currentBad;
	const id = checkId(current["id"], "current.id");
	if (!id.ok) return id;
	const revision = checkRevision(current["revision"], "current.revision");
	if (!revision.ok) return revision;
	const currentScope = checkScope(current["scope"], "current.scope");
	if (!currentScope.ok) return currentScope;
	if (!lifecycles.includes(current["lifecycle"] as Lifecycle))
		return fail("INVALID_INPUT", "current.lifecycle");
	if (!origins.includes(current["origin"] as Origin))
		return fail("INVALID_INPUT", "current.origin");
	const expectedRevision = checkRevision(
		object["expectedRevision"],
		"expectedRevision",
	);
	if (!expectedRevision.ok) return expectedRevision;
	const request = checkTransitionRequest(object["request"]);
	if (!request.ok) return request;
	const rulesValue = object["registeredAdoptionRules"];
	if (!Array.isArray(rulesValue))
		return fail("INVALID_INPUT", "registeredAdoptionRules");
	const rules: string[] = [];
	for (let i = 0; i < rulesValue.length; i++) {
		const rule = checkId(rulesValue[i], `registeredAdoptionRules[${i}]`);
		if (!rule.ok) return rule;
		rules.push(rule.value);
	}
	return ok({
		scope: scope.value,
		current: {
			id: id.value,
			revision: revision.value,
			scope: currentScope.value,
			lifecycle: current["lifecycle"] as Lifecycle,
			origin: current["origin"] as Origin,
		},
		expectedRevision: expectedRevision.value,
		request: request.value,
		registeredAdoptionRules: rules,
	});
}
