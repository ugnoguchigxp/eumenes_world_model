import {
	asRecord,
	checkEpochMs,
	checkFiniteNumber,
	checkId,
	checkOpaque,
	checkRevision,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
} from "../../../contracts/index.ts";
import { checkGraphInput, type ReasoningReason } from "../contracts/index.ts";
import { checkResourceStates } from "./dependencies.ts";
import { buildGraph, conditionOf, fitPresentation, Meter } from "./shared.ts";

export const gapKinds = [
	"MISSING_RESOURCE",
	"RESOURCE_STATE_UNKNOWN",
	"CONDITION_UNKNOWN",
	"MEASUREMENT_MISSING",
] as const;
export type GapKind = (typeof gapKinds)[number];

/** Reference input only. A retracted Goal blocks nothing. */
export interface GoalReference {
	readonly goalId: string;
	readonly revision: number;
	readonly status: "adopted" | "retracted";
}
/** Host knowledge about one gap; absent deadline/cost stay unknown. */
export interface GapAnnotation {
	readonly gapKey: string;
	readonly blocksGoal?: boolean;
	readonly deadlineAt?: number;
	readonly confirmationCost?: number;
}
export interface ResearchGap {
	readonly gapKey: string;
	readonly kind: GapKind;
	readonly subjectId: string;
	readonly edgeId: string;
	/** What to confirm; a candidate, never an instruction to act. */
	readonly confirmWith: {
		readonly kind: "entity" | "edge";
		readonly id: string;
	};
	readonly blocksGoal: boolean;
	readonly deadlineAt: number | null;
	readonly confirmationCost: number | null;
}
export interface GapResult {
	status: "complete" | "partial";
	reasons: ReasoningReason[];
	gaps: ResearchGap[];
}

function checkGoal(value: unknown): Checked<GoalReference | undefined> {
	if (value === undefined) return ok(undefined);
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", "goal");
	if (firstUnknownKey(object, ["goalId", "revision", "status"]) !== undefined)
		return fail("INVALID_INPUT", "goal");
	const goalId = checkId(object["goalId"], "goal.goalId");
	if (!goalId.ok) return goalId;
	const revision = checkRevision(object["revision"], "goal.revision");
	if (!revision.ok) return revision;
	const status = object["status"];
	if (status !== "adopted" && status !== "retracted")
		return fail("INVALID_INPUT", "goal.status");
	return ok({ goalId: goalId.value, revision: revision.value, status });
}

function checkAnnotations(value: unknown): Checked<Map<string, GapAnnotation>> {
	const map = new Map<string, GapAnnotation>();
	if (value === undefined) return ok(map);
	if (!Array.isArray(value)) return fail("INVALID_INPUT", "annotations");
	if (value.length > 1000) return fail("LIMIT_EXCEEDED", "annotations");
	for (let i = 0; i < value.length; i++) {
		const path = `annotations[${i}]`;
		const object = asRecord(value[i]);
		if (!object) return fail("INVALID_INPUT", path);
		const extra = firstUnknownKey(object, [
			"gapKey",
			"blocksGoal",
			"deadlineAt",
			"confirmationCost",
		]);
		if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
		const key = checkOpaque(object["gapKey"], `${path}.gapKey`, 600);
		if (!key.ok) return key;
		if (map.has(key.value)) return fail("INVALID_INPUT", path);
		let blocksGoal: boolean | undefined;
		if (object["blocksGoal"] !== undefined) {
			if (typeof object["blocksGoal"] !== "boolean")
				return fail("INVALID_INPUT", `${path}.blocksGoal`);
			blocksGoal = object["blocksGoal"];
		}
		let deadlineAt: number | undefined;
		if (object["deadlineAt"] !== undefined) {
			const d = checkEpochMs(object["deadlineAt"], `${path}.deadlineAt`);
			if (!d.ok) return d;
			deadlineAt = d.value;
		}
		let confirmationCost: number | undefined;
		if (object["confirmationCost"] !== undefined) {
			const c = checkFiniteNumber(
				object["confirmationCost"],
				`${path}.confirmationCost`,
			);
			if (!c.ok) return c;
			if (c.value < 0) return fail("INVALID_INPUT", `${path}.confirmationCost`);
			confirmationCost = c.value;
		}
		map.set(key.value, {
			gapKey: key.value,
			...(blocksGoal === undefined ? {} : { blocksGoal }),
			...(deadlineAt === undefined ? {} : { deadlineAt }),
			...(confirmationCost === undefined ? {} : { confirmationCost }),
		});
	}
	return ok(map);
}

/** Known values sort before unknown (null) ones. */
function compareKnown(a: number | null, b: number | null): number {
	if (a === null && b === null) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return a - b;
}
/** Goal-blocking first, nearer deadline, lower cost, then key (C5). */
export function compareGaps(a: ResearchGap, b: ResearchGap): number {
	if (a.blocksGoal !== b.blocksGoal) return a.blocksGoal ? -1 : 1;
	return (
		compareKnown(a.deadlineAt, b.deadlineAt) ||
		compareKnown(a.confirmationCost, b.confirmationCost) ||
		(a.gapKey < b.gapKey ? -1 : a.gapKey > b.gapKey ? 1 : 0)
	);
}

export function findResearchGaps(input: unknown): Checked<GapResult> {
	const parsed = checkGraphInput(input, [
		"resourceStates",
		"goal",
		"annotations",
	]);
	if (!parsed.ok) return parsed;
	const { graph: query, object } = parsed.value;
	const states = checkResourceStates(object["resourceStates"]);
	if (!states.ok) return states;
	const goal = checkGoal(object["goal"]);
	if (!goal.ok) return goal;
	const annotations = checkAnnotations(object["annotations"]);
	if (!annotations.ok) return annotations;
	const meter = new Meter(query.budget);
	const builtGraph = buildGraph(query, meter);
	if (!builtGraph.ok) return builtGraph;
	const graph = builtGraph;
	const goalRef = goal.value;
	const notes = annotations.value;
	const found = new Map<string, ResearchGap>();
	function add(
		kind: GapKind,
		subjectId: string,
		edgeId: string,
		confirmWith: ResearchGap["confirmWith"],
	) {
		const gapKey = `${kind}:${edgeId}`;
		if (found.has(gapKey)) return;
		const note = notes.get(gapKey);
		found.set(gapKey, {
			gapKey,
			kind,
			subjectId,
			edgeId,
			confirmWith,
			blocksGoal: goalRef?.status === "adopted" && note?.blocksGoal === true,
			deadlineAt: note?.deadlineAt ?? null,
			confirmationCost: note?.confirmationCost ?? null,
		});
	}
	for (const edge of graph.value.edges) {
		if (!meter.expand()) break;
		// A violated condition means the edge does not apply: no gap from it.
		if (conditionOf(graph.value, edge) === "violated") continue;
		const quantitative =
			(edge.relation === "increases" || edge.relation === "decreases") &&
			edge.axis !== undefined;
		const causal = [
			"causes",
			"enables",
			"inhibits",
			"increases",
			"decreases",
		].includes(edge.relation);
		// Resource gaps need an adopted, causal-eligible dependency: a
		// hypothesis edge does not establish that the resource is required.
		if (
			edge.relation === "depends_on" &&
			edge.status === "active" &&
			edge.causalEligible
		) {
			const state = states.value.get(edge.to);
			if (state === "unavailable")
				add("MISSING_RESOURCE", edge.from, edge.id, {
					kind: "entity",
					id: edge.to,
				});
			else if (state !== "available")
				add("RESOURCE_STATE_UNKNOWN", edge.from, edge.id, {
					kind: "entity",
					id: edge.to,
				});
		}
		if (
			(causal || edge.relation === "depends_on") &&
			conditionOf(graph.value, edge) === "unknown"
		)
			add("CONDITION_UNKNOWN", edge.from, edge.id, {
				kind: "edge",
				id: edge.id,
			});
		if (causal && !quantitative)
			add("MEASUREMENT_MISSING", edge.from, edge.id, {
				kind: "edge",
				id: edge.id,
			});
	}
	const gaps = [...found.values()].sort(compareGaps);
	if (gaps.length > query.budget.relations) {
		gaps.length = query.budget.relations;
		meter.note("RELATION_BUDGET");
	}
	const result: GapResult = {
		status: meter.status(),
		reasons: meter.sortedReasons(),
		gaps,
	};
	return ok(
		fitPresentation(result, [result.gaps], query.budget.presentationBytes),
	);
}
