import {
	asRecord,
	checkBoolean,
	checkContractVersion,
	checkId,
	checkScope,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
	type ScopeRef,
	type SourceRef,
	type SourceState,
} from "../../../contracts/index.ts";
import {
	checkSourceRef,
	checkSourceState,
	maxManifestSources,
} from "../../assertions/contracts/index.ts";

/** Initial extraction limits (P1-10). Bytes are UTF-8. */
export const extractionLimits = Object.freeze({
	maxUtterances: 12,
	maxWindowBytes: 32 * 1024,
	maxCandidates: 8,
	maxDependencies: maxManifestSources,
	/** Upper bound on host-supplied inputs examined in one call. */
	maxInputUtterances: 500,
	/** Upper bound on raw model candidates examined in one call. */
	maxRawCandidates: 64,
	/** Same cap as validateAssertion's source states, so prepare == validate. */
	maxSourceStates: 2000,
	/** Raw manifest entries examined before de-duplication. */
	maxRawManifestEntries: 500,
	/** UTF-8 bytes of a model output (string or canonical JSON). */
	maxOutputBytes: 64 * 1024,
});

export const utteranceOrigins = ["user_report", "document_claim"] as const;
export type UtteranceOrigin = (typeof utteranceOrigins)[number];

/** A host-permitted input utterance. Origin and root are host-assigned. */
export interface Utterance {
	readonly utteranceId: string;
	/** The message source; the cited range is added per candidate. */
	readonly source: SourceRef;
	/** False for unconfirmed ASR; such utterances are never extracted. */
	readonly confirmed: boolean;
	readonly origin: UtteranceOrigin;
	readonly rootEvidenceId: string;
}
/** An utterance that was placed in a window. */
export type PreparedUtterance = Omit<Utterance, "confirmed">;

export const prepareHoldCodes = [
	"UNCONFIRMED_UTTERANCE",
	"SOURCE_UNAVAILABLE",
	"CONTENT_UNAVAILABLE",
	"UTTERANCE_TOO_LARGE",
	"DEPENDENCY_LIMIT",
	"WINDOW_FULL",
] as const;
export type PrepareHoldCode = (typeof prepareHoldCodes)[number];

export interface Deferred {
	readonly utteranceId: string;
	readonly reasonCode: PrepareHoldCode;
}
/** Every source/state the model will see, cited or not. Sorted, unique. */
export interface InputManifest {
	readonly dependencies: readonly SourceRef[];
}

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

export function checkStates(
	value: unknown,
	path = "sources",
): Checked<readonly SourceState[]> {
	const object = asRecord(value);
	if (!object || !Array.isArray(object["states"]))
		return fail("INVALID_INPUT", path);
	const bad = strict(object, ["states"], path);
	if (bad) return bad;
	if (object["states"].length > extractionLimits.maxSourceStates)
		return fail("LIMIT_EXCEEDED", `${path}.states`);
	const states: SourceState[] = [];
	// One state per (Scope, source identity): the first-match lookup must not
	// depend on array order (consistent with the projection snapshot).
	const identities = new Set<string>();
	for (let i = 0; i < object["states"].length; i++) {
		const state = checkSourceState(object["states"][i], `${path}.states[${i}]`);
		if (!state.ok) return state;
		const identity = JSON.stringify([
			state.value.principal,
			state.value.scopeKey,
			state.value.namespace,
			state.value.kind,
			state.value.id,
			state.value.representation ?? null,
		]);
		if (identities.has(identity))
			return fail("INVALID_INPUT", `${path}.states[${i}]`);
		identities.add(identity);
		states.push(state.value);
	}
	return ok(states);
}

export function checkWholeSource(
	value: unknown,
	path: string,
): Checked<SourceRef> {
	const ref = checkSourceRef(value, path);
	if (!ref.ok) return ref;
	if (ref.value.range !== undefined)
		return fail("INVALID_INPUT", `${path}.range`);
	return ref;
}

function checkOrigin(value: unknown, path: string): Checked<UtteranceOrigin> {
	return utteranceOrigins.includes(value as UtteranceOrigin)
		? ok(value as UtteranceOrigin)
		: fail("INVALID_INPUT", path);
}

export function checkPreparedUtterance(
	value: unknown,
	path: string,
	withConfirmed: boolean,
): Checked<Utterance | PreparedUtterance> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const keys = [
		"utteranceId",
		"source",
		"origin",
		"rootEvidenceId",
		...(withConfirmed ? ["confirmed"] : []),
	];
	const bad = strict(object, keys, path);
	if (bad) return bad;
	const utteranceId = checkId(object["utteranceId"], `${path}.utteranceId`);
	if (!utteranceId.ok) return utteranceId;
	const source = checkWholeSource(object["source"], `${path}.source`);
	if (!source.ok) return source;
	const origin = checkOrigin(object["origin"], `${path}.origin`);
	if (!origin.ok) return origin;
	const root = checkId(object["rootEvidenceId"], `${path}.rootEvidenceId`);
	if (!root.ok) return root;
	const base = {
		utteranceId: utteranceId.value,
		source: source.value,
		origin: origin.value,
		rootEvidenceId: root.value,
	};
	if (!withConfirmed) return ok(base);
	const confirmed = checkBoolean(object["confirmed"], `${path}.confirmed`);
	if (!confirmed.ok) return confirmed;
	return ok({ ...base, confirmed: confirmed.value });
}

export interface PrepareInput {
	readonly scope: ScopeRef;
	readonly utterances: readonly Utterance[];
	readonly states: readonly SourceState[];
	/** Other state/source inputs shown to the model (goals, memory views...). */
	readonly extraDependencies: readonly SourceRef[];
}

export function checkPrepareInput(value: unknown): Checked<PrepareInput> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", "input");
	const bad = strict(
		object,
		["contractVersion", "scope", "utterances", "sources", "extraDependencies"],
		"input",
	);
	if (bad) return bad;
	const version = checkContractVersion(object["contractVersion"]);
	if (!version.ok) return version;
	const scope = checkScope(object["scope"]);
	if (!scope.ok) return scope;
	const list = object["utterances"];
	if (!Array.isArray(list)) return fail("INVALID_INPUT", "input.utterances");
	if (list.length > extractionLimits.maxInputUtterances)
		return fail("LIMIT_EXCEEDED", "input.utterances");
	const utterances: Utterance[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < list.length; i++) {
		const item = checkPreparedUtterance(
			list[i],
			`input.utterances[${i}]`,
			true,
		);
		if (!item.ok) return item;
		if (seen.has(item.value.utteranceId))
			return fail("INVALID_INPUT", `input.utterances[${i}].utteranceId`);
		seen.add(item.value.utteranceId);
		utterances.push(item.value as Utterance);
	}
	const states = checkStates(object["sources"], "input.sources");
	if (!states.ok) return states;
	const extraRaw = object["extraDependencies"] ?? [];
	if (!Array.isArray(extraRaw))
		return fail("INVALID_INPUT", "input.extraDependencies");
	if (extraRaw.length > extractionLimits.maxInputUtterances)
		return fail("LIMIT_EXCEEDED", "input.extraDependencies");
	const extraDependencies: SourceRef[] = [];
	for (let i = 0; i < extraRaw.length; i++) {
		const ref = checkWholeSource(extraRaw[i], `input.extraDependencies[${i}]`);
		if (!ref.ok) return ref;
		extraDependencies.push(ref.value);
	}
	return ok({
		scope: scope.value,
		utterances,
		states: states.value,
		extraDependencies,
	});
}
