import {
	asRecord,
	checkId,
	checkOpaque,
	checkSafeInteger,
	checkVersionString,
	fail,
	firstUnknownKey,
	isWellFormed,
	limits,
	ok,
	type Checked,
	type SourceRef,
	type SourceState,
	type SourceStatus,
} from "../../../contracts/index.ts";

/** What kind of statement a piece of evidence is; never promoted by summary. */
export const evidenceKinds = [
	"user_statement",
	"document",
	"runtime_measurement",
	"assistant_summary",
] as const;
export type EvidenceKind = (typeof evidenceKinds)[number];
export const evidenceStances = ["supports", "refutes"] as const;
export type EvidenceStance = (typeof evidenceStances)[number];

export interface Evidence {
	readonly evidenceId: string;
	readonly kind: EvidenceKind;
	readonly stance: EvidenceStance;
	readonly source: SourceRef;
	/** Same original, summary, repost or re-extraction share one root. */
	readonly rootEvidenceId: string;
	/** Digest of the cited bytes. Required when source.range is present. */
	readonly quoteDigest?: string;
	/** Optional shared experiment/repost series; kept, not merged. */
	readonly seriesId?: string;
}

export const sourceStatuses: readonly SourceStatus[] = [
	"available",
	"missing",
	"changed",
	"forgotten",
];
/** Upper bound for host-supplied source content used to verify quotes. */
export const maxSourceContentBytes = 1024 * 1024;

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

function identity(
	object: Record<string, unknown>,
	path: string,
): Checked<{
	namespace: string;
	kind: string;
	id: string;
	representation?: string;
}> {
	const namespace = checkId(object["namespace"], `${path}.namespace`);
	if (!namespace.ok) return namespace;
	const kind = checkId(object["kind"], `${path}.kind`);
	if (!kind.ok) return kind;
	const id = checkId(object["id"], `${path}.id`);
	if (!id.ok) return id;
	if (object["representation"] === undefined)
		return ok({ namespace: namespace.value, kind: kind.value, id: id.value });
	const representation = checkId(
		object["representation"],
		`${path}.representation`,
	);
	if (!representation.ok) return representation;
	return ok({
		namespace: namespace.value,
		kind: kind.value,
		id: id.value,
		representation: representation.value,
	});
}

export function checkSourceRef(
	value: unknown,
	path = "source",
): Checked<SourceRef> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const bad = strict(
		object,
		[
			"namespace",
			"kind",
			"id",
			"representation",
			"revision",
			"digest",
			"range",
		],
		path,
	);
	if (bad) return bad;
	const base = identity(object, path);
	if (!base.ok) return base;
	const revision = checkVersionString(object["revision"], `${path}.revision`);
	if (!revision.ok) return revision;
	const digest = checkOpaque(object["digest"], `${path}.digest`);
	if (!digest.ok) return digest;
	const result: SourceRef = {
		...base.value,
		revision: revision.value,
		digest: digest.value,
	};
	if (object["range"] === undefined) return ok(result);
	const range = asRecord(object["range"]);
	if (!range) return fail("INVALID_INPUT", `${path}.range`);
	const rangeBad = strict(range, ["startByte", "endByte"], `${path}.range`);
	if (rangeBad) return rangeBad;
	const start = checkSafeInteger(range["startByte"], `${path}.range.startByte`);
	if (!start.ok) return start;
	const end = checkSafeInteger(range["endByte"], `${path}.range.endByte`);
	if (!end.ok) return end;
	if (start.value < 0 || start.value >= end.value)
		return fail("INVALID_INPUT", `${path}.range`);
	return ok({
		...result,
		range: { startByte: start.value, endByte: end.value },
	});
}

export function checkSourceState(
	value: unknown,
	path = "state",
): Checked<SourceState> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const bad = strict(
		object,
		[
			"namespace",
			"kind",
			"id",
			"representation",
			"revision",
			"digest",
			"principal",
			"scopeKey",
			"status",
			"content",
		],
		path,
	);
	if (bad) return bad;
	const base = identity(object, path);
	if (!base.ok) return base;
	const revision = checkVersionString(object["revision"], `${path}.revision`);
	if (!revision.ok) return revision;
	const digest = checkOpaque(object["digest"], `${path}.digest`);
	if (!digest.ok) return digest;
	const principal = checkId(object["principal"], `${path}.principal`);
	if (!principal.ok) return principal;
	const scopeKey = checkId(object["scopeKey"], `${path}.scopeKey`);
	if (!scopeKey.ok) return scopeKey;
	if (!sourceStatuses.includes(object["status"] as SourceStatus))
		return fail("INVALID_INPUT", `${path}.status`);
	const state: SourceState = {
		...base.value,
		revision: revision.value,
		digest: digest.value,
		principal: principal.value,
		scopeKey: scopeKey.value,
		status: object["status"] as SourceStatus,
	};
	if (object["content"] === undefined) return ok(state);
	const content = object["content"];
	if (typeof content !== "string" || !isWellFormed(content))
		return fail("INVALID_INPUT", `${path}.content`);
	if (new TextEncoder().encode(content).length > maxSourceContentBytes)
		return fail("LIMIT_EXCEEDED", `${path}.content`);
	return ok({ ...state, content });
}

export function checkEvidence(
	value: unknown,
	path = "evidence",
): Checked<Evidence> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const bad = strict(
		object,
		[
			"evidenceId",
			"kind",
			"stance",
			"source",
			"rootEvidenceId",
			"quoteDigest",
			"seriesId",
		],
		path,
	);
	if (bad) return bad;
	const evidenceId = checkId(object["evidenceId"], `${path}.evidenceId`);
	if (!evidenceId.ok) return evidenceId;
	if (!evidenceKinds.includes(object["kind"] as EvidenceKind))
		return fail("INVALID_INPUT", `${path}.kind`);
	if (!evidenceStances.includes(object["stance"] as EvidenceStance))
		return fail("INVALID_INPUT", `${path}.stance`);
	const source = checkSourceRef(object["source"], `${path}.source`);
	if (!source.ok) return source;
	const root = checkId(object["rootEvidenceId"], `${path}.rootEvidenceId`);
	if (!root.ok) return root;
	const base = {
		evidenceId: evidenceId.value,
		kind: object["kind"] as EvidenceKind,
		stance: object["stance"] as EvidenceStance,
		source: source.value,
		rootEvidenceId: root.value,
	};
	let result: Evidence = base;
	if (object["quoteDigest"] !== undefined) {
		const digest = checkOpaque(object["quoteDigest"], `${path}.quoteDigest`);
		if (!digest.ok) return digest;
		result = { ...result, quoteDigest: digest.value };
	}
	if (object["seriesId"] !== undefined) {
		const series = checkId(object["seriesId"], `${path}.seriesId`);
		if (!series.ok) return series;
		result = { ...result, seriesId: series.value };
	}
	return ok(result);
}

export const maxEvidencePerAssertion = 200;
export const maxManifestSources = limits.manifestDependencies;

export function checkEvidenceList(
	value: unknown,
	path = "evidence",
): Checked<readonly Evidence[]> {
	if (!Array.isArray(value)) return fail("INVALID_INPUT", path);
	if (value.length > maxEvidencePerAssertion)
		return fail("LIMIT_EXCEEDED", path);
	const items: Evidence[] = [];
	const ids = new Set<string>();
	for (let i = 0; i < value.length; i++) {
		const item = checkEvidence(value[i], `${path}[${i}]`);
		if (!item.ok) return item;
		if (ids.has(item.value.evidenceId))
			return fail("INVALID_INPUT", `${path}[${i}].evidenceId`);
		ids.add(item.value.evidenceId);
		items.push(item.value);
	}
	return ok(items);
}

/** Revision-aware dedupe key for input dependencies (range excluded). */
export const sourceInputKey = (ref: SourceRef) =>
	JSON.stringify([
		ref.namespace,
		ref.kind,
		ref.id,
		ref.representation ?? null,
		ref.revision,
		ref.digest,
	]);
export const sourceIdentityKey = (ref: {
	readonly namespace: string;
	readonly kind: string;
	readonly id: string;
	readonly representation?: string;
}) =>
	JSON.stringify([ref.namespace, ref.kind, ref.id, ref.representation ?? null]);
