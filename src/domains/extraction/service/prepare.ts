import {
	fail,
	ok,
	utf8Length,
	type CanonicalHasher,
	type Checked,
	type SourceRef,
} from "../../../contracts/index.ts";
import { sourceInputKey } from "../../assertions/index.ts";
import { findState } from "./states.ts";
import {
	checkPrepareInput,
	extractionLimits,
	type Deferred,
	type InputManifest,
	type PreparedUtterance,
	type Utterance,
} from "../contracts/manifest.ts";

export interface PrepareResult {
	/** prepared: a non-empty window. held: nothing can be extracted now. */
	readonly status: "prepared" | "held";
	/** Set only when the whole call is held (manifest cannot fit). */
	readonly holdReason?: "DEPENDENCY_LIMIT";
	readonly window: readonly PreparedUtterance[];
	readonly windowBytes: number;
	/** Utterances left for later or held, in input order. */
	readonly deferred: readonly Deferred[];
	readonly manifest: InputManifest;
}

const encoder = new TextEncoder();
const bare = (digest: string) => digest.replace(/^sha256:/, "");
const byKey = (a: [string, SourceRef], b: [string, SourceRef]) =>
	a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;

function sortedManifest(map: Map<string, SourceRef>): InputManifest {
	return { dependencies: [...map.entries()].sort(byKey).map(([, v]) => v) };
}

/**
 * Picks the next extraction window from host-permitted utterances.
 *
 * Limits: 12 utterances or 32KiB (UTF-8 bytes), whichever is reached first,
 * and at most 32 unique input dependencies (cited or not). An utterance is
 * never split: a single utterance over 32KiB is held. Unconfirmed ASR, missing
 * or other-Scope sources are held without detail. With an injected hasher, an
 * utterance whose content does not match its state digest is held too.
 */
export function prepareExtraction(
	input: unknown,
	hasher?: CanonicalHasher,
): Checked<PrepareResult> {
	const parsed = checkPrepareInput(input);
	if (!parsed.ok) return parsed;
	const { scope, utterances, states, extraDependencies } = parsed.value;
	// Same availability rule as validateCandidates: every extra input must be
	// a current, available state in the Scope, else the model call is wasted.
	for (const [i, ref] of extraDependencies.entries())
		if (!findState(scope, ref, states))
			return fail("INVALID_INPUT", `input.extraDependencies[${i}]`);

	const dependencies = new Map<string, SourceRef>();
	for (const ref of extraDependencies)
		dependencies.set(sourceInputKey(ref), ref);
	if (dependencies.size > extractionLimits.maxDependencies) {
		return ok({
			status: "held",
			holdReason: "DEPENDENCY_LIMIT",
			window: [],
			windowBytes: 0,
			deferred: [],
			manifest: sortedManifest(new Map()),
		});
	}

	const window: PreparedUtterance[] = [];
	const deferred: Deferred[] = [];
	let bytes = 0;
	let full = false;
	for (const utterance of utterances as readonly Utterance[]) {
		const hold = (reasonCode: Deferred["reasonCode"]) =>
			deferred.push({ utteranceId: utterance.utteranceId, reasonCode });
		if (full) {
			hold("WINDOW_FULL");
			continue;
		}
		if (!utterance.confirmed) {
			hold("UNCONFIRMED_UTTERANCE");
			continue;
		}
		const state = findState(scope, utterance.source, states);
		if (!state) {
			hold("SOURCE_UNAVAILABLE");
			continue;
		}
		if (state.content === undefined) {
			hold("CONTENT_UNAVAILABLE");
			continue;
		}
		if (
			hasher !== undefined &&
			bare(hasher(encoder.encode(state.content))) !== bare(state.digest)
		) {
			hold("SOURCE_UNAVAILABLE");
			continue;
		}
		const size = utf8Length(state.content);
		if (size > extractionLimits.maxWindowBytes) {
			hold("UTTERANCE_TOO_LARGE");
			continue;
		}
		if (
			window.length >= extractionLimits.maxUtterances ||
			bytes + size > extractionLimits.maxWindowBytes
		) {
			full = true;
			hold("WINDOW_FULL");
			continue;
		}
		const key = sourceInputKey(utterance.source);
		if (
			!dependencies.has(key) &&
			dependencies.size + 1 > extractionLimits.maxDependencies
		) {
			full = true;
			hold("DEPENDENCY_LIMIT");
			continue;
		}
		dependencies.set(key, utterance.source);
		bytes += size;
		const { confirmed: _confirmed, ...prepared } = utterance;
		window.push(prepared);
	}
	if (utterances.length === 0 && extraDependencies.length === 0)
		return ok({
			status: "held",
			window: [],
			windowBytes: 0,
			deferred: [],
			manifest: sortedManifest(dependencies),
		});
	return ok({
		status: window.length > 0 ? "prepared" : "held",
		window,
		windowBytes: bytes,
		deferred,
		// Non-prepared utterances contribute nothing: the model never sees them.
		manifest: sortedManifest(dependencies),
	});
}
