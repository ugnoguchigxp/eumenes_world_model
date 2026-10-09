import {
	asRecord,
	checkContractVersion,
	checkEpochMs,
	checkId,
	checkPredicate,
	checkScope,
	checkTypedValue,
	checkVersionString,
	canonicalBytes,
	citedBytes,
	fail,
	type Failure,
	firstUnknownKey,
	ok,
	type CanonicalHasher,
	type Checked,
	type ScopeRef,
	type SourceRef,
	type SourceState,
	utf8Length,
} from "../../../contracts/index.ts";
import {
	relationKinds,
	sourceInputKey,
	validateAssertion,
	type AssertionDraft,
	type AssertionRejectCode,
	type Payload,
	type RelationKind,
} from "../../assertions/index.ts";
import { checkConditionSpec, checkValidTime } from "../../conditions/index.ts";
import { resolveEntity } from "../../identity/index.ts";
import { parseEntities } from "../../identity/contracts/index.ts";
import {
	candidateKeys,
	forbiddenModelFields,
	modalities,
	type CandidateReasonCode,
	type CandidateVerdict,
	type Modality,
	type ValidationResult,
} from "../contracts/candidate.ts";
import {
	checkPreparedUtterance,
	checkStates,
	checkWholeSource,
	extractionLimits,
	type PreparedUtterance,
} from "../contracts/manifest.ts";
import { findState } from "./states.ts";

interface Assigned {
	readonly recordedAt: number;
	readonly interpretationVersion: string;
	readonly freshnessMaxAgeMs: number;
	readonly items: readonly { assertionId: string; evidenceId: string }[];
}
interface Context {
	readonly scope: ScopeRef;
	readonly window: readonly PreparedUtterance[];
	readonly dependencies: readonly SourceRef[];
	readonly states: readonly SourceState[];
	readonly entities: unknown;
	readonly assigned: Assigned;
	readonly rest: Record<string, unknown>;
}

const contextKeys = [
	"contractVersion",
	"scope",
	"window",
	"manifest",
	"sources",
	"entities",
	"assigned",
];

function parseAssigned(value: unknown): Checked<Assigned> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", "assigned");
	const extra = firstUnknownKey(object, [
		"recordedAt",
		"interpretationVersion",
		"freshnessMaxAgeMs",
		"items",
	]);
	if (extra !== undefined) return fail("INVALID_INPUT", `assigned.${extra}`);
	const recordedAt = checkEpochMs(object["recordedAt"], "assigned.recordedAt");
	if (!recordedAt.ok) return recordedAt;
	const version = checkVersionString(
		object["interpretationVersion"],
		"assigned.interpretationVersion",
	);
	if (!version.ok) return version;
	const age = object["freshnessMaxAgeMs"];
	if (typeof age !== "number" || !Number.isSafeInteger(age) || age < 0)
		return fail("INVALID_INPUT", "assigned.freshnessMaxAgeMs");
	const list = object["items"];
	if (!Array.isArray(list) || list.length > extractionLimits.maxRawCandidates)
		return fail("INVALID_INPUT", "assigned.items");
	const items: { assertionId: string; evidenceId: string }[] = [];
	const seenAssertions = new Set<string>();
	const seenEvidence = new Set<string>();
	for (let i = 0; i < list.length; i++) {
		const item = asRecord(list[i]);
		if (!item) return fail("INVALID_INPUT", `assigned.items[${i}]`);
		const extraItem = firstUnknownKey(item, ["assertionId", "evidenceId"]);
		if (extraItem !== undefined)
			return fail("INVALID_INPUT", `assigned.items[${i}].${extraItem}`);
		const assertionId = checkId(item["assertionId"], `assigned.items[${i}]`);
		if (!assertionId.ok) return assertionId;
		const evidenceId = checkId(item["evidenceId"], `assigned.items[${i}]`);
		if (!evidenceId.ok) return evidenceId;
		// Two accepted drafts must never share an id/revision.
		if (
			seenAssertions.has(assertionId.value) ||
			seenEvidence.has(evidenceId.value)
		)
			return fail("INVALID_INPUT", `assigned.items[${i}]`);
		seenAssertions.add(assertionId.value);
		seenEvidence.add(evidenceId.value);
		items.push({
			assertionId: assertionId.value,
			evidenceId: evidenceId.value,
		});
	}
	return ok({
		recordedAt: recordedAt.value,
		interpretationVersion: version.value,
		freshnessMaxAgeMs: age,
		items,
	});
}

function parseContext(
	input: unknown,
	extraKeys: readonly string[],
): Checked<Context> {
	const object = asRecord(input);
	if (!object) return fail("INVALID_INPUT", "input");
	const extra = firstUnknownKey(object, [...contextKeys, ...extraKeys]);
	if (extra !== undefined) return fail("INVALID_INPUT", `input.${extra}`);
	const version = checkContractVersion(object["contractVersion"]);
	if (!version.ok) return version;
	const scope = checkScope(object["scope"]);
	if (!scope.ok) return scope;
	const windowRaw = object["window"];
	if (
		!Array.isArray(windowRaw) ||
		windowRaw.length > extractionLimits.maxUtterances
	)
		return fail("INVALID_INPUT", "input.window");
	const window: PreparedUtterance[] = [];
	const ids = new Set<string>();
	for (let i = 0; i < windowRaw.length; i++) {
		const item = checkPreparedUtterance(
			windowRaw[i],
			`input.window[${i}]`,
			false,
		);
		if (!item.ok) return item;
		if (ids.has(item.value.utteranceId))
			return fail("INVALID_INPUT", `input.window[${i}].utteranceId`);
		ids.add(item.value.utteranceId);
		window.push(item.value);
	}
	const manifest = asRecord(object["manifest"]);
	if (!manifest || !Array.isArray(manifest["dependencies"]))
		return fail("INVALID_INPUT", "input.manifest");
	const manifestExtra = firstUnknownKey(manifest, ["dependencies"]);
	if (manifestExtra !== undefined)
		return fail("INVALID_INPUT", `input.manifest.${manifestExtra}`);
	if (manifest["dependencies"].length > extractionLimits.maxRawManifestEntries)
		return fail("LIMIT_EXCEEDED", "input.manifest.dependencies");
	// De-duplicated and sorted, so the handoff manifest is permutation-stable;
	// the 32-entry limit counts unique dependencies only.
	const unique = new Map<string, SourceRef>();
	for (let i = 0; i < manifest["dependencies"].length; i++) {
		const ref = checkWholeSource(
			manifest["dependencies"][i],
			`input.manifest.dependencies[${i}]`,
		);
		if (!ref.ok) return ref;
		unique.set(sourceInputKey(ref.value), ref.value);
	}
	if (unique.size > extractionLimits.maxDependencies)
		return fail("LIMIT_EXCEEDED", "input.manifest.dependencies");
	const dependencies = [...unique.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([, ref]) => ref);
	const states = checkStates(object["sources"], "input.sources");
	if (!states.ok) return states;
	// The manifest must list every source the model saw (forget traverses it):
	// a window source missing from it is a host error, not a model error.
	const manifestKeys = new Set(dependencies.map(sourceInputKey));
	let windowBytes = 0;
	for (let i = 0; i < window.length; i++) {
		const utterance = window[i]!;
		if (!manifestKeys.has(sourceInputKey(utterance.source)))
			return fail("INVALID_INPUT", `input.window[${i}].source`);
		const state = findState(scope.value, utterance.source, states.value);
		if (state?.content !== undefined) windowBytes += utf8Length(state.content);
	}
	if (windowBytes > extractionLimits.maxWindowBytes)
		return fail("LIMIT_EXCEEDED", "input.window");
	// Host-supplied entities are parsed once and strictly: a malformed list is
	// a host error for the whole call, never a verdict about a candidate.
	const entities = parseEntities(object["entities"], "input.entities");
	if (!entities.ok) return entities;
	const assigned = parseAssigned(object["assigned"]);
	if (!assigned.ok) return assigned;
	return ok({
		scope: scope.value,
		window,
		dependencies,
		states: states.value,
		entities: entities.value,
		assigned: assigned.value,
		rest: object,
	});
}

const rejected = (
	index: number,
	...reasonCodes: CandidateReasonCode[]
): CandidateVerdict => ({
	index,
	status: "rejected",
	reasonCodes: [...new Set(reasonCodes)].sort(),
});
const held = (index: number, code: CandidateReasonCode): CandidateVerdict => ({
	index,
	status: "held",
	reasonCodes: [code],
});

function resolveQuery(
	ctx: Context,
	query: unknown,
): Checked<
	| { status: "resolved"; entityId: string; byId: boolean }
	| { status: "ambiguous" | "missing"; byId: boolean }
> {
	const result = resolveEntity({ scope: ctx.scope, query }, ctx.entities);
	if (!result.ok) return result;
	const byId = asRecord(query)?.["kind"] === "id";
	if (result.value.status === "resolved")
		return ok({
			status: "resolved",
			entityId: result.value.entityId,
			byId,
		});
	return ok({ status: result.value.status, byId });
}

/** Validates one model candidate; never trusts model-issued ids or times. */
function judge(
	raw: unknown,
	index: number,
	ctx: Context,
	hasher: CanonicalHasher,
): CandidateVerdict | Failure {
	const object = asRecord(raw);
	if (!object) return rejected(index, "MALFORMED_CANDIDATE");
	const keys = Object.keys(object);
	if (
		keys.some((key) =>
			(forbiddenModelFields as readonly string[]).includes(key),
		)
	)
		return rejected(index, "FORBIDDEN_MODEL_FIELD");
	if (keys.some((key) => !(candidateKeys as readonly string[]).includes(key)))
		return rejected(index, "MALFORMED_CANDIDATE");

	const modality = object["modality"];
	if (!modalities.includes(modality as Modality))
		return rejected(index, "MALFORMED_CANDIDATE");
	if (modality === "negated") return rejected(index, "NEGATED_NOT_FACT");
	if (modality === "hypothetical")
		return rejected(index, "HYPOTHETICAL_NOT_FACT");
	if (modality === "question") return rejected(index, "QUESTION_NOT_CLAIM");

	const predicate = checkPredicate(object["predicate"]);
	if (!predicate.ok) return rejected(index, "MALFORMED_CANDIDATE");

	const subject = resolveQuery(ctx, object["subject"]);
	if (!subject.ok) return rejected(index, "MALFORMED_CANDIDATE");
	if (subject.value.status !== "resolved") {
		if (subject.value.status === "ambiguous")
			return held(index, "AMBIGUOUS_SUBJECT");
		return subject.value.byId
			? rejected(index, "UNKNOWN_SUBJECT_ID")
			: held(index, "SUBJECT_UNRESOLVED");
	}
	const subjectId = subject.value.entityId;

	const payloadObject = asRecord(object["payload"]);
	if (!payloadObject) return rejected(index, "MALFORMED_CANDIDATE");
	let payload: Payload;
	if (payloadObject["kind"] === "value") {
		if (firstUnknownKey(payloadObject, ["kind", "value"]) !== undefined)
			return rejected(index, "MALFORMED_CANDIDATE");
		const value = checkTypedValue(payloadObject["value"]);
		if (!value.ok) return rejected(index, "MALFORMED_CANDIDATE");
		payload = { kind: "value", value: value.value };
	} else if (payloadObject["kind"] === "relation") {
		if (
			firstUnknownKey(payloadObject, ["kind", "relation", "object"]) !==
				undefined ||
			!relationKinds.includes(payloadObject["relation"] as RelationKind)
		)
			return rejected(index, "MALFORMED_CANDIDATE");
		const target = resolveQuery(ctx, payloadObject["object"]);
		if (!target.ok) return rejected(index, "MALFORMED_CANDIDATE");
		if (target.value.status !== "resolved")
			return held(index, "OBJECT_UNRESOLVED");
		payload = {
			kind: "relation",
			relation: payloadObject["relation"] as RelationKind,
			objectId: target.value.entityId,
		};
	} else return rejected(index, "MALFORMED_CANDIDATE");

	const quote = asRecord(object["quote"]);
	if (
		!quote ||
		firstUnknownKey(quote, ["utteranceId", "startByte", "endByte"]) !==
			undefined
	)
		return rejected(index, "MALFORMED_CANDIDATE");
	const utterance = ctx.window.find(
		(u) => u.utteranceId === quote["utteranceId"],
	);
	if (!utterance) return rejected(index, "QUOTE_SOURCE_NOT_IN_WINDOW");
	const state = findState(ctx.scope, utterance.source, ctx.states);
	if (!state || state.content === undefined)
		return rejected(index, "SOURCE_NOT_AVAILABLE");
	const start = quote["startByte"];
	const end = quote["endByte"];
	if (typeof start !== "number" || typeof end !== "number")
		return rejected(index, "MALFORMED_CANDIDATE");
	const bytes = citedBytes(state.content, { startByte: start, endByte: end });
	if (!bytes.ok) return rejected(index, "QUOTE_OUT_OF_RANGE");

	const condition = checkConditionSpec(object["condition"]);
	if (!condition.ok) return rejected(index, "CONDITION_INVALID");
	if (condition.value.kind === "explicitly_unconditional")
		return rejected(index, "CONDITION_NOT_PERMITTED");
	let validTime;
	if (object["validTime"] !== undefined) {
		const checked = checkValidTime(object["validTime"]);
		if (!checked.ok) return rejected(index, "MALFORMED_CANDIDATE");
		validTime = checked.value;
	}

	const assigned = ctx.assigned.items[index];
	if (!assigned) return rejected(index, "HOST_ASSIGNMENT_MISSING");

	const reported = modality === "reported";
	const draft: AssertionDraft = {
		id: assigned.assertionId,
		revision: 1,
		scope: ctx.scope,
		subjectId,
		predicate: predicate.value,
		payload,
		evidence: [
			{
				evidenceId: assigned.evidenceId,
				kind:
					utterance.origin === "user_report" ? "user_statement" : "document",
				stance: "supports",
				source: {
					...utterance.source,
					range: { startByte: start, endByte: end },
				},
				rootEvidenceId: utterance.rootEvidenceId,
				quoteDigest: `sha256:${hasher(bytes.value)}`,
			},
		],
		// Every input the model saw, cited or not (forget traverses all of it).
		inputManifest: ctx.dependencies,
		// A reported statement is a hypothesis about someone else's claim.
		origin: reported ? "model_hypothesis" : utterance.origin,
		recordedAt: ctx.assigned.recordedAt,
		...(validTime === undefined ? {} : { validTime }),
		freshnessPolicy: { maxAgeMs: ctx.assigned.freshnessMaxAgeMs },
		condition: condition.value,
		supersedes: [],
		contradicts: [],
		interpretationVersion: ctx.assigned.interpretationVersion,
	};
	const checked = validateAssertion(
		{
			contractVersion: 1,
			scope: ctx.scope,
			draft,
			sources: { states: ctx.states },
			entities: ctx.entities,
		},
		hasher,
	);
	// Every model-derived part was validated above and the host parts were
	// parsed strictly, so a structural failure here is a host fault: fail the
	// whole call instead of discarding a good candidate.
	// A draft that is too large only because of this candidate is that
	// candidate's fault: reject it alone and keep the rest of the batch.
	if (!checked.ok)
		return checked.code === "LIMIT_EXCEEDED"
			? rejected(index, "CANDIDATE_TOO_LARGE")
			: checked;
	if (checked.value.status === "rejected")
		return rejected(
			index,
			...checked.value.reasonCodes.map(
				(code): CandidateReasonCode => assertionReasonMap[code],
			),
		);
	return {
		index,
		status: "accepted",
		treatment: reported ? "reported" : "asserted",
		draft,
	};
}

/**
 * Single-draft check: one raw candidate judged at `index` 0.
 *
 * Input: `{ contractVersion: 1, scope, window, manifest, sources, entities,
 * assigned, candidate }`. See validateCandidates for the shared fields.
 */
export function validateCandidate(
	input: unknown,
	hasher: CanonicalHasher,
): Checked<CandidateVerdict> {
	const ctx = parseContext(input, ["candidate"]);
	if (!ctx.ok) return ctx;
	const verdict = judge(ctx.value.rest["candidate"], 0, ctx.value, hasher);
	return "ok" in verdict ? verdict : ok(verdict);
}

/** Explicit, exhaustive mapping: a new assertion reject code fails typecheck here. */
const assertionReasonMap: Readonly<
	Record<AssertionRejectCode, CandidateReasonCode>
> = {
	SCOPE_NOT_PERMITTED: "SCOPE_NOT_PERMITTED",
	SOURCE_NOT_AVAILABLE: "SOURCE_NOT_AVAILABLE",
	SOURCE_VERSION_MISMATCH: "SOURCE_VERSION_MISMATCH",
	SOURCE_DIGEST_MISMATCH: "SOURCE_DIGEST_MISMATCH",
	QUOTE_UNVERIFIABLE: "QUOTE_UNVERIFIABLE",
	QUOTE_OUT_OF_RANGE: "QUOTE_OUT_OF_RANGE",
	QUOTE_DIGEST_MISSING: "QUOTE_DIGEST_MISSING",
	QUOTE_DIGEST_MISMATCH: "QUOTE_DIGEST_MISMATCH",
	ORIGIN_EVIDENCE_MISMATCH: "ORIGIN_EVIDENCE_MISMATCH",
	MISSING_OBSERVED_AT: "MISSING_OBSERVED_AT",
	UNCONDITIONAL_WITHOUT_EVIDENCE: "UNCONDITIONAL_WITHOUT_EVIDENCE",
	SUBJECT_NOT_RESOLVED: "SUBJECT_NOT_RESOLVED",
	OBJECT_NOT_RESOLVED: "OBJECT_NOT_RESOLVED",
	MANIFEST_LIMIT_EXCEEDED: "MANIFEST_LIMIT_EXCEEDED",
	INVALID_SUPERSEDES: "INVALID_SUPERSEDES",
	SELF_CONTRADICTION: "SELF_CONTRADICTION",
	ROOT_LABEL_CONFLICT: "ROOT_LABEL_CONFLICT",
};

function parseOutput(value: unknown): readonly unknown[] | undefined {
	let output = value;
	// A model output is bounded in UTF-8 bytes before it is parsed.
	if (typeof output === "string") {
		if (utf8Length(output) > extractionLimits.maxOutputBytes) return undefined;
		try {
			output = JSON.parse(output);
		} catch {
			return undefined;
		}
	}
	const object = asRecord(output);
	if (!object || firstUnknownKey(object, ["candidates"]) !== undefined)
		return undefined;
	if (!canonicalBytes(object, extractionLimits.maxOutputBytes).ok)
		return undefined;
	const list = object["candidates"];
	if (!Array.isArray(list) || list.length > extractionLimits.maxRawCandidates)
		return undefined;
	return list;
}

/**
 * Batch check of one model output. Input: `{ contractVersion: 1, scope,
 * window: PreparedUtterance[], manifest: { dependencies }, sources: { states },
 * entities, assigned: { recordedAt, interpretationVersion, freshnessMaxAgeMs,
 * items: [{ assertionId, evidenceId }] }, modelOutput, selectedIndexes? }`.
 *
 * Every candidate gets its own verdict; a partly invalid batch is never
 * silently adopted. Only `selectedIndexes` that are all accepted are handed
 * on; without a selection (or with an invalid one) nothing is handed on.
 */
export function validateCandidates(
	input: unknown,
	hasher: CanonicalHasher,
): Checked<ValidationResult> {
	const ctx = parseContext(input, ["modelOutput", "selectedIndexes"]);
	if (!ctx.ok) return ctx;
	const selectedRaw = ctx.value.rest["selectedIndexes"];
	if (selectedRaw !== undefined) {
		if (
			!Array.isArray(selectedRaw) ||
			selectedRaw.some((n) => typeof n !== "number" || !Number.isSafeInteger(n))
		)
			return fail("INVALID_INPUT", "input.selectedIndexes");
	}
	const list = parseOutput(ctx.value.rest["modelOutput"]);
	if (!list)
		return ok({
			status: "rejected",
			reasonCode: "MALFORMED_OUTPUT",
			verdicts: [],
			acceptedIndexes: [],
			handoff: [],
		});
	const verdicts: CandidateVerdict[] = [];
	for (const [index, raw] of list.entries()) {
		if (index >= extractionLimits.maxCandidates) {
			verdicts.push(rejected(index, "CANDIDATE_OVERFLOW"));
			continue;
		}
		const verdict = judge(raw, index, ctx.value, hasher);
		if ("ok" in verdict) return verdict;
		verdicts.push(verdict);
	}
	const accepted = verdicts.filter(
		(v): v is Extract<CandidateVerdict, { status: "accepted" }> =>
			v.status === "accepted",
	);
	const acceptedIndexes = accepted.map((v) => v.index);
	const selected = (selectedRaw ?? []) as number[];
	const valid =
		new Set(selected).size === selected.length &&
		selected.every((n) => acceptedIndexes.includes(n));
	if (!valid)
		return ok({
			status: "rejected",
			reasonCode: "SELECTION_INVALID",
			verdicts,
			acceptedIndexes,
			handoff: [],
		});
	return ok({
		status: "validated",
		verdicts,
		acceptedIndexes,
		handoff: accepted.filter((v) => selected.includes(v.index)),
	});
}
