import { asRecord, fail, ok, type Checked } from "../../../contracts/index.ts";
import {
	defaultBudget,
	traceInfluence,
	type Effect,
	type InfluencePath,
	type InfluenceResult,
} from "../../reasoning/index.ts";
import { checkOverlay, type Overlay } from "../contracts/index.ts";

export interface PathDelta {
	readonly added: string[];
	readonly removed: string[];
	readonly effectChanged: { pathKey: string; from: Effect; to: Effect }[];
}
export interface OverlayOutcome {
	readonly overlayId: string;
	readonly influence: InfluenceResult;
	readonly versusBaseline: PathDelta;
}
export interface ScenarioComparison {
	readonly onlyA: string[];
	readonly onlyB: string[];
	readonly sameEffect: string[];
	readonly differentEffect: { pathKey: string; a: Effect; b: Effect }[];
}
export type CompareReason =
	| "OVERLAY_BASELINE_TRUNCATED"
	/** An overlay removes an edge id the baseline does not contain. */
	| "UNKNOWN_REMOVE_EDGE_ID";

export interface CompareResult {
	/** partial when any trace was cut off; no path never means no effect. */
	readonly status: "complete" | "partial";
	readonly baseline: InfluenceResult;
	readonly overlays: readonly [OverlayOutcome, OverlayOutcome];
	readonly comparison: ScenarioComparison;
	/**
	 * OVERLAY_BASELINE_TRUNCATED: baseline edges + overlay edges exceeded the
	 * candidate budget, so baseline edges (not overlay edges) were cut.
	 */
	readonly reasons: readonly CompareReason[];
	/** Qualitative only: no numeric effect is derived from edges. */
	readonly quantitativeEffect: "not_computed";
}

/** Identity of a path: every edge's id, revision, endpoints and relation. */
const pathKey = (path: InfluencePath) =>
	path.edges
		.map(
			(edge) =>
				`${edge.id}@${edge.revision}:${edge.from}->${edge.to}:${edge.relation}`,
		)
		.join(">");
const index = (result: InfluenceResult) =>
	new Map(result.paths.map((path) => [pathKey(path), path.effect] as const));
const sorted = (values: Iterable<string>) => [...values].sort();

function delta(base: InfluenceResult, other: InfluenceResult): PathDelta {
	const a = index(base);
	const b = index(other);
	return {
		added: sorted([...b.keys()].filter((key) => !a.has(key))),
		removed: sorted([...a.keys()].filter((key) => !b.has(key))),
		effectChanged: sorted([...b.keys()].filter((key) => a.has(key)))
			.filter((key) => a.get(key) !== b.get(key))
			.map((key) => ({ pathKey: key, from: a.get(key)!, to: b.get(key)! })),
	};
}

/**
 * Applies two overlays to separate copies of the same baseline edges and
 * compares their qualitative influence. The baseline input is never mutated.
 * Input: the traceInfluence input plus `overlays: [A, B]`.
 */
export function compareScenarios(input: unknown): Checked<CompareResult> {
	const object = asRecord(input);
	if (!object) return fail("INVALID_INPUT", "input");
	const raw = object["overlays"];
	if (!Array.isArray(raw) || raw.length !== 2)
		return fail("INVALID_INPUT", "overlays");
	const overlays: Overlay[] = [];
	for (let i = 0; i < 2; i++) {
		const overlay = checkOverlay(raw[i], `overlays[${i}]`);
		if (!overlay.ok) return overlay;
		overlays.push(overlay.value);
	}
	if (overlays[0]!.overlayId === overlays[1]!.overlayId)
		return fail("INVALID_INPUT", "overlays");
	const edges = object["edges"];
	if (!Array.isArray(edges)) return fail("INVALID_INPUT", "edges");

	const { overlays: _omitted, ...rest } = object;
	const trace = (edgeSet: readonly unknown[]) =>
		traceInfluence({ ...rest, edges: edgeSet });
	const baseline = trace(edges);
	if (!baseline.ok) return baseline;
	const hostCandidates = asRecord(rest["budget"])?.["candidates"];
	const candidateLimit =
		typeof hostCandidates === "number" && Number.isFinite(hostCandidates)
			? Math.min(defaultBudget.candidates, hostCandidates)
			: defaultBudget.candidates;
	const reasons = new Set<CompareReason>();
	const outcomes: OverlayOutcome[] = [];
	for (const overlay of overlays) {
		const removed = new Set(overlay.removeEdgeIds);
		const present = new Set(
			edges
				.map((edge) => asRecord(edge)?.["id"])
				.filter((id) => typeof id === "string"),
		);
		// A mistyped removal must not look like a complete no-op overlay.
		if (overlay.removeEdgeIds.some((id) => !present.has(id)))
			reasons.add("UNKNOWN_REMOVE_EDGE_ID");
		let kept = edges.filter((edge) => {
			const id = asRecord(edge)?.["id"];
			return typeof id !== "string" || !removed.has(id);
		});
		// The overlay is the question being asked: when the candidate budget is
		// short, cut baseline edges (deterministically by id), never overlay edges.
		if (kept.length + overlay.addEdges.length > candidateLimit) {
			const room = Math.max(0, candidateLimit - overlay.addEdges.length);
			const idOf = (edge: unknown) => {
				const id = asRecord(edge)?.["id"];
				return typeof id === "string" ? id : "";
			};
			const revisionOf = (edge: unknown) => {
				const revision = asRecord(edge)?.["revision"];
				return typeof revision === "number" ? revision : 0;
			};
			// id, then revision: two revisions of one id never depend on input order.
			kept = [...kept]
				.sort((x, y) =>
					idOf(x) < idOf(y)
						? -1
						: idOf(x) > idOf(y)
							? 1
							: revisionOf(x) - revisionOf(y),
				)
				.slice(0, room);
			reasons.add("OVERLAY_BASELINE_TRUNCATED");
		}
		const merged = [...kept, ...overlay.addEdges];
		const influence = trace(merged);
		if (!influence.ok) return influence;
		outcomes.push({
			overlayId: overlay.overlayId,
			influence: influence.value,
			versusBaseline: delta(baseline.value, influence.value),
		});
	}
	const [a, b] = outcomes as [OverlayOutcome, OverlayOutcome];
	const ia = index(a.influence);
	const ib = index(b.influence);
	const both = sorted([...ia.keys()].filter((key) => ib.has(key)));
	const complete =
		reasons.size === 0 &&
		[baseline.value, a.influence, b.influence].every(
			(result) => result.status === "complete",
		);
	return ok({
		status: complete ? "complete" : "partial",
		baseline: baseline.value,
		overlays: [a, b],
		comparison: {
			onlyA: sorted([...ia.keys()].filter((key) => !ib.has(key))),
			onlyB: sorted([...ib.keys()].filter((key) => !ia.has(key))),
			sameEffect: both.filter((key) => ia.get(key) === ib.get(key)),
			differentEffect: both
				.filter((key) => ia.get(key) !== ib.get(key))
				.map((key) => ({ pathKey: key, a: ia.get(key)!, b: ib.get(key)! })),
		},
		reasons: [...reasons],
		quantitativeEffect: "not_computed",
	});
}
