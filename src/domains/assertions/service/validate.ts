import {
	asRecord,
	canonicalBytes,
	checkContractVersion,
	checkScope,
	citedBytes,
	fail,
	firstUnknownKey,
	ok,
	sameScope,
	type CanonicalHasher,
	type Checked,
	type ScopeRef,
	type SourceRef,
	type SourceState,
} from "../../../contracts/index.ts";
import { type Condition } from "../../conditions/index.ts";
import { resolveEntity } from "../../identity/index.ts";
import {
	checkAssertionDraft,
	type Assertion,
	type AssertionDraft,
	type Freshness,
	type FreshnessPolicy,
	type Origin,
} from "../contracts/assertion.ts";
import {
	checkSourceState,
	maxManifestSources,
	sourceIdentityKey,
	sourceInputKey,
	type Evidence,
	type EvidenceKind,
} from "../contracts/evidence.ts";
import {
	hasRootConflict,
	rootsOf,
	type EvidenceRoots,
} from "./evidence-roots.ts";

export type AssertionRejectCode =
	| "SCOPE_NOT_PERMITTED"
	| "SOURCE_NOT_AVAILABLE"
	| "SOURCE_VERSION_MISMATCH"
	| "SOURCE_DIGEST_MISMATCH"
	| "QUOTE_UNVERIFIABLE"
	| "QUOTE_OUT_OF_RANGE"
	| "QUOTE_DIGEST_MISSING"
	| "QUOTE_DIGEST_MISMATCH"
	| "ORIGIN_EVIDENCE_MISMATCH"
	| "MISSING_OBSERVED_AT"
	| "UNCONDITIONAL_WITHOUT_EVIDENCE"
	| "SUBJECT_NOT_RESOLVED"
	| "OBJECT_NOT_RESOLVED"
	| "MANIFEST_LIMIT_EXCEEDED"
	| "INVALID_SUPERSEDES"
	| "SELF_CONTRADICTION"
	| "ROOT_LABEL_CONFLICT";

/** Upper bound on host-verified source states parsed per call. */
export const maxSourceStates = 2000;

export type ValidateResult =
	| {
			readonly status: "valid";
			readonly assertion: Assertion;
			readonly evidenceRoots: EvidenceRoots;
	  }
	| {
			readonly status: "rejected";
			/** Sorted unique codes; no content, names or counts. */
			readonly reasonCodes: readonly AssertionRejectCode[];
	  };

/** Evidence kind that can back each origin. Summaries back none of them. */
const originEvidence: Readonly<Record<Origin, EvidenceKind | undefined>> = {
	runtime_observation: "runtime_measurement",
	user_report: "user_statement",
	document_claim: "document",
	model_hypothesis: undefined,
};

const encoder = new TextEncoder();
const bare = (digest: string) =>
	digest.startsWith("sha256:") ? digest.slice(7) : digest;

function findState(
	ref: SourceRef,
	scope: ScopeRef,
	states: readonly SourceState[],
): SourceState | undefined {
	const key = sourceIdentityKey(ref);
	return states.find(
		(state) =>
			sourceIdentityKey(state) === key &&
			sameScope(scope, {
				principal: state.principal,
				scopeKey: state.scopeKey,
			}),
	);
}

/** Freshness is measured from observation time and policy, never retrieval. */
export function assessFreshness(
	observedAt: number | undefined,
	policy: FreshnessPolicy,
	asOf: number,
): Freshness {
	// Fail closed: a missing, non-integer or non-finite number is never "fresh"
	// (NaN comparisons are false and would otherwise fall through to fresh).
	if (
		observedAt === undefined ||
		!Number.isSafeInteger(observedAt) ||
		!Number.isSafeInteger(asOf) ||
		!Number.isSafeInteger(policy?.maxAgeMs) ||
		policy.maxAgeMs < 0 ||
		observedAt > asOf
	)
		return "unknown";
	return asOf - observedAt > policy.maxAgeMs ? "stale" : "fresh";
}

function checkSource(
	ref: SourceRef,
	scope: ScopeRef,
	states: readonly SourceState[],
	hasher: CanonicalHasher,
	quoteDigest: string | undefined,
	codes: Set<AssertionRejectCode>,
) {
	const state = findState(ref, scope, states);
	// Another Scope's source is indistinguishable from a missing one.
	if (!state || state.status !== "available") {
		codes.add("SOURCE_NOT_AVAILABLE");
		return;
	}
	if (state.revision !== ref.revision) codes.add("SOURCE_VERSION_MISMATCH");
	if (state.digest !== ref.digest) codes.add("SOURCE_DIGEST_MISMATCH");
	if (
		state.content !== undefined &&
		bare(hasher(encoder.encode(state.content))) !== bare(state.digest)
	)
		codes.add("SOURCE_DIGEST_MISMATCH");
	if (!ref.range) return;
	if (state.content === undefined) {
		codes.add("QUOTE_UNVERIFIABLE");
		return;
	}
	const bytes = citedBytes(state.content, ref.range);
	if (!bytes.ok) {
		codes.add("QUOTE_OUT_OF_RANGE");
		return;
	}
	if (quoteDigest === undefined) codes.add("QUOTE_DIGEST_MISSING");
	else if (bare(hasher(bytes.value)) !== bare(quoteDigest))
		codes.add("QUOTE_DIGEST_MISMATCH");
}

function checkOrigin(draft: AssertionDraft, codes: Set<AssertionRejectCode>) {
	const needed = originEvidence[draft.origin];
	if (needed !== undefined) {
		const backed = draft.evidence.some(
			(item) => item.stance === "supports" && item.kind === needed,
		);
		if (!backed) codes.add("ORIGIN_EVIDENCE_MISMATCH");
	}
	if (draft.origin === "runtime_observation" && draft.observedAt === undefined)
		codes.add("MISSING_OBSERVED_AT");
}

function mergedManifest(draft: AssertionDraft): readonly SourceRef[] {
	const map = new Map<string, SourceRef>();
	for (const ref of draft.inputManifest) {
		const { range: _range, ...whole } = ref;
		map.set(sourceInputKey(ref), whole);
	}
	for (const ref of rootsOf(draft.evidence).inputs)
		map.set(sourceInputKey(ref), ref);
	return [...map.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([, ref]) => ref);
}

function conditionEntityIds(node: Condition, out: Set<string>) {
	switch (node.kind) {
		case "compare":
			if (node.value.kind === "entity") out.add(node.value.entityId);
			return;
		case "all":
		case "any":
			for (const item of node.items) conditionEntityIds(item, out);
			return;
		case "not":
			conditionEntityIds(node.item, out);
			return;
		default:
			return;
	}
}
/** Entity ids named by a value payload or by a condition compare operand. */
function referencedEntityIds(draft: AssertionDraft): readonly string[] {
	const ids = new Set<string>();
	if (draft.payload.kind === "value" && draft.payload.value.kind === "entity")
		ids.add(draft.payload.value.entityId);
	if (draft.condition.kind === "expression")
		conditionEntityIds(draft.condition.expression, ids);
	return [...ids].sort();
}

/**
 * Resolution runs through identity's strict parser: malformed or oversized
 * entity data is a caller error (failure), never "the subject does not exist".
 */
function resolves(
	scope: ScopeRef,
	id: string,
	entities: unknown,
): Checked<boolean> {
	const result = resolveEntity({ scope, query: { kind: "id", id } }, entities);
	if (!result.ok) return fail(result.code, "entities");
	return ok(
		result.value.status === "resolved" &&
			result.value.entityId === id &&
			result.value.via === "id",
	);
}

/**
 * Validates one assertion draft against host-verified source states.
 *
 * Input: `{ contractVersion: 1, scope, draft, sources: { states }, entities }`.
 * `hasher` is the injected synchronous SHA-256 (hex). Structural problems are
 * `{ ok: false }`; semantic problems are `{ status: "rejected" }`. Models can
 * only produce candidates: the result lifecycle is always "candidate".
 */
export function validateAssertion(
	input: unknown,
	rawHasher: CanonicalHasher,
): Checked<ValidateResult> {
	// A hasher that returns a non-string is a caller error, not a crash.
	if (typeof rawHasher !== "function") return fail("INVALID_INPUT", "hasher");
	if (typeof rawHasher(new Uint8Array()) !== "string")
		return fail("INVALID_INPUT", "hasher");
	const hasher: CanonicalHasher = (bytes) => {
		const out = rawHasher(bytes);
		return typeof out === "string" ? out : "";
	};
	const object = asRecord(input);
	if (!object) return fail("INVALID_INPUT", "input");
	const extra = firstUnknownKey(object, [
		"contractVersion",
		"scope",
		"draft",
		"sources",
		"entities",
	]);
	if (extra !== undefined) return fail("INVALID_INPUT", `input.${extra}`);
	const version = checkContractVersion(object["contractVersion"]);
	if (!version.ok) return version;
	const scope = checkScope(object["scope"]);
	if (!scope.ok) return scope;
	const draft = checkAssertionDraft(object["draft"]);
	if (!draft.ok) return draft;
	const sourcesObject = asRecord(object["sources"]);
	if (!sourcesObject || !Array.isArray(sourcesObject["states"]))
		return fail("INVALID_INPUT", "sources");
	const sourcesExtra = firstUnknownKey(sourcesObject, ["states"]);
	if (sourcesExtra !== undefined)
		return fail("INVALID_INPUT", `sources.${sourcesExtra}`);
	const states: SourceState[] = [];
	if (sourcesObject["states"].length > maxSourceStates)
		return fail("LIMIT_EXCEEDED", "sources.states");
	for (let i = 0; i < sourcesObject["states"].length; i++) {
		const state = checkSourceState(
			sourcesObject["states"][i],
			`sources.states[${i}]`,
		);
		if (!state.ok) return state;
		states.push(state.value);
	}
	// (scope, identity) must be unique: with duplicates the first match would
	// decide and the result would depend on array order.
	const seenStates = new Set<string>();
	for (const [index, state] of states.entries()) {
		const key = JSON.stringify([
			state.principal,
			state.scopeKey,
			sourceIdentityKey(state),
		]);
		if (seenStates.has(key))
			return fail("INVALID_INPUT", `sources.states[${index}]`);
		seenStates.add(key);
	}
	if (!Array.isArray(object["entities"]))
		return fail("INVALID_INPUT", "entities");
	// The serialized draft must be hashable (finite JSON) for later digests.
	const canonical = canonicalBytes(draft.value);
	if (!canonical.ok) return canonical;

	const value = draft.value;
	const codes = new Set<AssertionRejectCode>();
	if (!sameScope(scope.value, value.scope)) {
		return ok({ status: "rejected", reasonCodes: ["SCOPE_NOT_PERMITTED"] });
	}
	for (const item of value.evidence)
		checkSource(
			item.source,
			value.scope,
			states,
			hasher,
			item.quoteDigest,
			codes,
		);
	for (const ref of value.inputManifest) {
		// A manifest entry names a whole source; any range is irrelevant here
		// (mergedManifest drops it as well), so it must not demand a quote digest.
		const { range: _range, ...whole } = ref;
		checkSource(whole, value.scope, states, hasher, undefined, codes);
	}
	if (hasRootConflict(value.evidence)) codes.add("ROOT_LABEL_CONFLICT");
	checkOrigin(value, codes);
	if (value.condition.kind === "explicitly_unconditional") {
		const adoptionId = value.condition.adoptionEvidenceId;
		const backed = value.evidence.some(
			(item: Evidence) =>
				item.evidenceId === adoptionId &&
				item.stance === "supports" &&
				// An assistant summary never backs adoption on its own.
				item.kind !== "assistant_summary",
		);
		if (!backed) codes.add("UNCONDITIONAL_WITHOUT_EVIDENCE");
	}
	if (value.contradicts.some((ref) => ref.id === value.id))
		codes.add("SELF_CONTRADICTION");
	const subject = resolves(value.scope, value.subjectId, object["entities"]);
	if (!subject.ok) return subject;
	if (!subject.value) codes.add("SUBJECT_NOT_RESOLVED");
	if (value.payload.kind === "relation") {
		const target = resolves(
			value.scope,
			value.payload.objectId,
			object["entities"],
		);
		if (!target.ok) return target;
		if (!target.value) codes.add("OBJECT_NOT_RESOLVED");
	}
	// Entity-valued payloads and entity-valued condition operands are
	// references too: they resolve like a relation object (own Scope, by id).
	for (const entityId of referencedEntityIds(value)) {
		const target = resolves(value.scope, entityId, object["entities"]);
		if (!target.ok) return target;
		if (!target.value) codes.add("OBJECT_NOT_RESOLVED");
	}
	const manifest = mergedManifest(value);
	if (manifest.length > maxManifestSources)
		codes.add("MANIFEST_LIMIT_EXCEEDED");
	if (
		value.supersedes.some(
			(ref) => ref.id !== value.id || ref.revision >= value.revision,
		)
	)
		codes.add("INVALID_SUPERSEDES");
	if (codes.size > 0)
		return ok({
			status: "rejected",
			reasonCodes: [...codes].sort(),
		});

	const evidenceRoots = rootsOf(value.evidence);
	const { lifecycle: _lifecycle, ...rest } = value;
	return ok({
		status: "valid",
		assertion: {
			...rest,
			inputManifest: manifest,
			// New assertions always begin as candidates, whatever the origin.
			lifecycle: "candidate",
			rootEvidenceIds: evidenceRoots.roots.map((r) => r.rootEvidenceId),
		},
		evidenceRoots,
	});
}
