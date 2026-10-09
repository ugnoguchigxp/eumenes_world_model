import {
	asRecord,
	checkEpochMs,
	checkId,
	checkPredicate,
	checkRevision,
	checkSafeInteger,
	checkScope,
	checkTypedValue,
	checkVersionString,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
	type ScopeRef,
	type SourceRef,
	type TypedValue,
} from "../../../contracts/index.ts";
import {
	checkConditionSpec,
	checkValidTime,
	type ConditionSpec,
	type ValidTime,
} from "../../conditions/contracts/index.ts";
import {
	checkEvidenceList,
	checkSourceRef,
	type Evidence,
} from "./evidence.ts";

/** Where the claim came from. Never inferred from confidence. */
export const origins = [
	"runtime_observation",
	"user_report",
	"document_claim",
	"model_hypothesis",
] as const;
export type Origin = (typeof origins)[number];
export const lifecycles = [
	"candidate",
	"active",
	"disputed",
	"superseded",
	"retracted",
	"invalidated",
] as const;
export type Lifecycle = (typeof lifecycles)[number];
/** Current-ness is computed separately from lifecycle. */
export const freshnessStates = ["fresh", "stale", "unknown"] as const;
export type Freshness = (typeof freshnessStates)[number];

export const relationKinds = [
	"increases",
	"decreases",
	"causes",
	"enables",
	"inhibits",
	"correlates_with",
	"depends_on",
	"part_of",
	"serves_goal",
	"related_to",
] as const;
export type RelationKind = (typeof relationKinds)[number];

/** Exactly one of a typed value or a relation. */
export type Payload =
	| { readonly kind: "value"; readonly value: TypedValue }
	| {
			readonly kind: "relation";
			readonly relation: RelationKind;
			readonly objectId: string;
	  };

export interface AssertionRef {
	readonly id: string;
	readonly revision: number;
}
export interface FreshnessPolicy {
	readonly maxAgeMs: number;
}

export interface AssertionDraft {
	readonly id: string;
	readonly revision: number;
	readonly scope: ScopeRef;
	readonly subjectId: string;
	readonly predicate: string;
	readonly payload: Payload;
	readonly evidence: readonly Evidence[];
	/** Extra input dependencies beyond cited evidence sources. */
	readonly inputManifest: readonly SourceRef[];
	readonly origin: Origin;
	/** Optional; when present it must be "candidate". */
	readonly lifecycle?: "candidate";
	readonly observedAt?: number;
	readonly recordedAt: number;
	readonly validTime?: ValidTime;
	readonly freshnessPolicy: FreshnessPolicy;
	readonly condition: ConditionSpec;
	readonly supersedes: readonly AssertionRef[];
	readonly contradicts: readonly AssertionRef[];
	readonly interpretationVersion: string;
}

export interface Assertion extends Omit<AssertionDraft, "lifecycle"> {
	readonly lifecycle: Lifecycle;
	/** Sorted unique root evidence IDs. A count source, not a probability. */
	readonly rootEvidenceIds: readonly string[];
}

export const draftKeys = [
	"id",
	"revision",
	"scope",
	"subjectId",
	"predicate",
	"payload",
	"evidence",
	"inputManifest",
	"origin",
	"lifecycle",
	"observedAt",
	"recordedAt",
	"validTime",
	"freshnessPolicy",
	"condition",
	"supersedes",
	"contradicts",
	"interpretationVersion",
] as const;

export function checkAssertionRef(
	value: unknown,
	path: string,
): Checked<AssertionRef> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const extra = firstUnknownKey(object, ["id", "revision"]);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const id = checkId(object["id"], `${path}.id`);
	if (!id.ok) return id;
	const revision = checkRevision(object["revision"], `${path}.revision`);
	if (!revision.ok) return revision;
	return ok({ id: id.value, revision: revision.value });
}

export function checkAssertionRefList(
	value: unknown,
	path: string,
	max = 64,
): Checked<readonly AssertionRef[]> {
	if (!Array.isArray(value)) return fail("INVALID_INPUT", path);
	if (value.length > max) return fail("LIMIT_EXCEEDED", path);
	const items: AssertionRef[] = [];
	for (let i = 0; i < value.length; i++) {
		const item = checkAssertionRef(value[i], `${path}[${i}]`);
		if (!item.ok) return item;
		items.push(item.value);
	}
	return ok(items);
}

function checkPayload(value: unknown, path: string): Checked<Payload> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	if (object["kind"] === "value") {
		const extra = firstUnknownKey(object, ["kind", "value"]);
		if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
		const typed = checkTypedValue(object["value"], `${path}.value`);
		return typed.ok ? ok({ kind: "value", value: typed.value }) : typed;
	}
	if (object["kind"] === "relation") {
		const extra = firstUnknownKey(object, ["kind", "relation", "objectId"]);
		if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
		if (!relationKinds.includes(object["relation"] as RelationKind))
			return fail("INVALID_INPUT", `${path}.relation`);
		const objectId = checkId(object["objectId"], `${path}.objectId`);
		if (!objectId.ok) return objectId;
		return ok({
			kind: "relation",
			relation: object["relation"] as RelationKind,
			objectId: objectId.value,
		});
	}
	return fail("INVALID_INPUT", `${path}.kind`);
}

/** Raw parse bound for a source-ref list (not the unique-manifest limit). */
export const maxRawSourceRefs = 1024;

export function checkSourceRefList(
	value: unknown,
	path: string,
): Checked<readonly SourceRef[]> {
	if (!Array.isArray(value)) return fail("INVALID_INPUT", path);
	// Only a parsing bound: the 32-UNIQUE-source limit is judged on the merged,
	// de-duplicated manifest (MANIFEST_LIMIT_EXCEEDED), the same rule for every list.
	if (value.length > maxRawSourceRefs) return fail("LIMIT_EXCEEDED", path);
	const items: SourceRef[] = [];
	for (let i = 0; i < value.length; i++) {
		const item = checkSourceRef(value[i], `${path}[${i}]`);
		if (!item.ok) return item;
		items.push(item.value);
	}
	return ok(items);
}

/** Strict parse of an unknown draft. Unknown fields (e.g. confidence) fail. */
export function checkAssertionDraft(
	value: unknown,
	path = "draft",
): Checked<AssertionDraft> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const extra = firstUnknownKey(object, draftKeys);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const id = checkId(object["id"], `${path}.id`);
	if (!id.ok) return id;
	const revision = checkRevision(object["revision"], `${path}.revision`);
	if (!revision.ok) return revision;
	const scope = checkScope(object["scope"], `${path}.scope`);
	if (!scope.ok) return scope;
	const subjectId = checkId(object["subjectId"], `${path}.subjectId`);
	if (!subjectId.ok) return subjectId;
	const predicate = checkPredicate(object["predicate"], `${path}.predicate`);
	if (!predicate.ok) return predicate;
	const payload = checkPayload(object["payload"], `${path}.payload`);
	if (!payload.ok) return payload;
	const evidence = checkEvidenceList(object["evidence"], `${path}.evidence`);
	if (!evidence.ok) return evidence;
	const inputManifest = checkSourceRefList(
		object["inputManifest"],
		`${path}.inputManifest`,
	);
	if (!inputManifest.ok) return inputManifest;
	if (!origins.includes(object["origin"] as Origin))
		return fail("INVALID_INPUT", `${path}.origin`);
	if (object["lifecycle"] !== undefined && object["lifecycle"] !== "candidate")
		return fail("INVALID_INPUT", `${path}.lifecycle`);
	const recordedAt = checkEpochMs(object["recordedAt"], `${path}.recordedAt`);
	if (!recordedAt.ok) return recordedAt;
	const policyObject = asRecord(object["freshnessPolicy"]);
	if (!policyObject) return fail("INVALID_INPUT", `${path}.freshnessPolicy`);
	const policyExtra = firstUnknownKey(policyObject, ["maxAgeMs"]);
	if (policyExtra !== undefined)
		return fail("INVALID_INPUT", `${path}.freshnessPolicy.${policyExtra}`);
	const maxAge = checkSafeInteger(
		policyObject["maxAgeMs"],
		`${path}.freshnessPolicy.maxAgeMs`,
	);
	if (!maxAge.ok) return maxAge;
	if (maxAge.value < 0)
		return fail("INVALID_INPUT", `${path}.freshnessPolicy.maxAgeMs`);
	const condition = checkConditionSpec(
		// Only an absent condition means unspecified; null is rejected like elsewhere.
		object["condition"] === undefined
			? { kind: "unspecified" }
			: object["condition"],
		`${path}.condition`,
	);
	if (!condition.ok) return condition;
	const supersedes = checkAssertionRefList(
		object["supersedes"],
		`${path}.supersedes`,
	);
	if (!supersedes.ok) return supersedes;
	const contradicts = checkAssertionRefList(
		object["contradicts"],
		`${path}.contradicts`,
	);
	if (!contradicts.ok) return contradicts;
	const interpretationVersion = checkVersionString(
		object["interpretationVersion"],
		`${path}.interpretationVersion`,
	);
	if (!interpretationVersion.ok) return interpretationVersion;
	let draft: AssertionDraft = {
		id: id.value,
		revision: revision.value,
		scope: scope.value,
		subjectId: subjectId.value,
		predicate: predicate.value,
		payload: payload.value,
		evidence: evidence.value,
		inputManifest: inputManifest.value,
		origin: object["origin"] as Origin,
		recordedAt: recordedAt.value,
		freshnessPolicy: { maxAgeMs: maxAge.value },
		condition: condition.value,
		supersedes: supersedes.value,
		contradicts: contradicts.value,
		interpretationVersion: interpretationVersion.value,
	};
	if (object["lifecycle"] !== undefined)
		draft = { ...draft, lifecycle: "candidate" };
	if (object["observedAt"] !== undefined) {
		const observedAt = checkEpochMs(object["observedAt"], `${path}.observedAt`);
		if (!observedAt.ok) return observedAt;
		draft = { ...draft, observedAt: observedAt.value };
	}
	if (object["validTime"] !== undefined) {
		const validTime = checkValidTime(object["validTime"], `${path}.validTime`);
		if (!validTime.ok) return validTime;
		draft = { ...draft, validTime: validTime.value };
	}
	return ok(draft);
}
