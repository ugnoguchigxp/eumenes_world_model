import {
	asRecord,
	checkContractVersion,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
	type SourceRef,
} from "../../../contracts/index.ts";
import {
	checkEvidenceList,
	sourceIdentityKey,
	sourceInputKey,
	type Evidence,
} from "../contracts/evidence.ts";

export interface RootGroup {
	readonly rootEvidenceId: string;
	/** Sorted evidence IDs sharing this root. */
	readonly evidenceIds: readonly string[];
	readonly supports: number;
	readonly refutes: number;
	/**
	 * True when every evidence item of this root is an assistant summary. Such a
	 * root is counted in rootCount but never as supporting: a summary cannot
	 * back a claim by itself.
	 */
	readonly summaryOnly: boolean;
	/** Sorted series IDs seen under this root; kept, never used to merge. */
	readonly seriesIds: readonly string[];
}
export interface EvidenceRoots {
	readonly roots: readonly RootGroup[];
	/** Unique root series. A count, not a probability or independence claim. */
	readonly rootCount: number;
	readonly supportingRootCount: number;
	readonly refutingRootCount: number;
	/** Every input dependency, deduplicated, sorted. Roots never shrink it. */
	readonly inputs: readonly SourceRef[];
}

export function rootsOf(evidence: readonly Evidence[]): EvidenceRoots {
	const groups = new Map<
		string,
		{
			ids: string[];
			supports: number;
			refutes: number;
			series: Set<string>;
			nonSummary: number;
		}
	>();
	const inputs = new Map<string, SourceRef>();
	for (const item of evidence) {
		let group = groups.get(item.rootEvidenceId);
		if (!group) {
			group = {
				ids: [],
				supports: 0,
				refutes: 0,
				series: new Set(),
				nonSummary: 0,
			};
			groups.set(item.rootEvidenceId, group);
		}
		group.ids.push(item.evidenceId);
		if (item.kind !== "assistant_summary") group.nonSummary++;
		if (item.stance === "supports") group.supports++;
		else group.refutes++;
		if (item.seriesId !== undefined) group.series.add(item.seriesId);
		const { range: _range, ...whole } = item.source;
		inputs.set(sourceInputKey(item.source), whole);
	}
	const roots = [...groups.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([rootEvidenceId, group]) => ({
			rootEvidenceId,
			evidenceIds: [...group.ids].sort(),
			supports: group.supports,
			refutes: group.refutes,
			summaryOnly: group.nonSummary === 0,
			seriesIds: [...group.series].sort(),
		}));
	return {
		roots,
		rootCount: roots.length,
		supportingRootCount: roots.filter((r) => r.supports > 0 && !r.summaryOnly)
			.length,
		refutingRootCount: roots.filter((r) => r.refutes > 0).length,
		inputs: [...inputs.entries()]
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([, ref]) => ref),
	};
}

/**
 * True when one source (namespace/kind/id/representation) is cited under more
 * than one root: the caller's root labels are then inconsistent and the root
 * count could be inflated by relabeling.
 */
export function hasRootConflict(evidence: readonly Evidence[]): boolean {
	const rootOf = new Map<string, string>();
	for (const item of evidence) {
		const key = sourceIdentityKey(item.source);
		const root = rootOf.get(key);
		if (root === undefined) rootOf.set(key, item.rootEvidenceId);
		else if (root !== item.rootEvidenceId) return true;
	}
	return false;
}

/**
 * Input: `{ contractVersion: 1, evidence: unknown[] }`, strict. Counts root
 * series; never a probability. The same source under different roots is
 * rejected (INVALID_INPUT) because it would inflate the count.
 */
export function groupEvidenceRoots(input: unknown): Checked<EvidenceRoots> {
	const object = asRecord(input);
	if (!object) return fail("INVALID_INPUT", "input");
	const extra = firstUnknownKey(object, ["contractVersion", "evidence"]);
	if (extra !== undefined) return fail("INVALID_INPUT", `input.${extra}`);
	const version = checkContractVersion(object["contractVersion"]);
	if (!version.ok) return version;
	const list = checkEvidenceList(object["evidence"], "evidence");
	if (!list.ok) return list;
	if (hasRootConflict(list.value))
		return fail("INVALID_INPUT", "evidence.rootEvidenceId");
	return ok(rootsOf(list.value));
}
