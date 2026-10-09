import {
	asRecord,
	checkBoolean,
	checkContractVersion,
	checkEpochMs,
	checkId,
	checkOpaque,
	checkRevision,
	checkSafeInteger,
	checkScope,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
	type ScopeRef,
} from "../../../contracts/index.ts";
import {
	relationKinds,
	type RelationKind,
} from "../../assertions/contracts/index.ts";
import {
	checkConditionSpec,
	checkObservation,
	checkValidTime,
	type ConditionSpec,
	type Observation,
	type ValidTime,
} from "../../conditions/contracts/index.ts";
import type { ProjectionEntry } from "../../projection/contracts/index.ts";

/** Defaults from contract C5. The effective value is min(default, host). */
export const defaultBudget = Object.freeze({
	causalDepth: 3,
	relevanceDepth: 4,
	entities: 30,
	relations: 60,
	paths: 10,
	candidates: 500,
	expansions: 500,
	presentationBytes: 8192,
});
export type Budget = { -readonly [K in keyof typeof defaultBudget]: number };

export const causalRelations: readonly RelationKind[] = [
	"causes",
	"enables",
	"inhibits",
	"increases",
	"decreases",
];

export type EdgeStatus = "active" | "disputed" | "candidate";
/** Same metric and comparison condition = same axis for sign composition. */
export interface ComparisonAxis {
	readonly metric: string;
	readonly comparison: string;
}
/** One relation assertion of a bounded, already-authorized snapshot. */
export interface ReasoningEdge {
	readonly id: string;
	readonly revision: number;
	readonly from: string;
	readonly to: string;
	readonly relation: RelationKind;
	readonly status: EdgeStatus;
	/** Only adopted, undisputed claims propagate causally. */
	readonly causalEligible: boolean;
	readonly condition: ConditionSpec;
	readonly validTime?: ValidTime;
	readonly axis?: ComparisonAxis;
}
export interface ConditionContext {
	readonly asOf: number;
	readonly maxAgeMs: number;
	readonly observations: readonly Observation[];
	readonly currentVersions?: readonly {
		readonly observationId: string;
		readonly version: string;
	}[];
}
export interface GraphInput {
	readonly scope: ScopeRef;
	readonly authorized: boolean;
	readonly edges: readonly ReasoningEdge[];
	readonly context: ConditionContext;
	readonly budget: Budget;
}

/**
 * Edges for the reasoning input, derived from a built projection. Only
 * relation assertions become edges; `axis` comes from the host's metadata.
 */
export function edgesFromEntries(
	entries: readonly ProjectionEntry[],
	axes: Readonly<Record<string, ComparisonAxis>> = {},
): ReasoningEdge[] {
	const edges: ReasoningEdge[] = [];
	for (const entry of entries) {
		const payload = entry.assertion.payload;
		if (payload.kind !== "relation") continue;
		const axis = Object.hasOwn(axes, entry.id) ? axes[entry.id] : undefined;
		edges.push({
			id: entry.id,
			revision: entry.revision,
			from: entry.subjectId,
			to: payload.objectId,
			relation: payload.relation,
			status: entry.status,
			causalEligible: entry.causalEligible,
			condition: entry.assertion.condition,
			...(entry.assertion.validTime
				? { validTime: entry.assertion.validTime }
				: {}),
			...(axis ? { axis } : {}),
		});
	}
	return edges;
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

export function checkBudget(value: unknown, path = "budget"): Checked<Budget> {
	const budget: Budget = { ...defaultBudget };
	if (value === undefined) return ok(budget);
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const bad = strict(object, Object.keys(defaultBudget), path);
	if (bad) return bad;
	for (const key of Object.keys(defaultBudget) as (keyof Budget)[]) {
		const item = object[key];
		if (item === undefined) continue;
		const n = checkSafeInteger(item, `${path}.${key}`);
		if (!n.ok) return n;
		if (n.value < 1) return fail("INVALID_INPUT", `${path}.${key}`);
		budget[key] = Math.min(budget[key], n.value);
	}
	return ok(budget);
}

const edgeStatuses: readonly EdgeStatus[] = ["active", "disputed", "candidate"];
const edgeKeys = [
	"id",
	"revision",
	"from",
	"to",
	"relation",
	"status",
	"causalEligible",
	"condition",
	"validTime",
	"axis",
];

function checkEdge(value: unknown, path: string): Checked<ReasoningEdge> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const bad = strict(object, edgeKeys, path);
	if (bad) return bad;
	const id = checkId(object["id"], `${path}.id`);
	if (!id.ok) return id;
	const revision = checkRevision(object["revision"], `${path}.revision`);
	if (!revision.ok) return revision;
	const from = checkId(object["from"], `${path}.from`);
	if (!from.ok) return from;
	const to = checkId(object["to"], `${path}.to`);
	if (!to.ok) return to;
	const relation = object["relation"];
	if (!relationKinds.includes(relation as RelationKind))
		return fail("INVALID_INPUT", `${path}.relation`);
	const status = object["status"];
	if (!edgeStatuses.includes(status as EdgeStatus))
		return fail("INVALID_INPUT", `${path}.status`);
	const eligible = checkBoolean(
		object["causalEligible"],
		`${path}.causalEligible`,
	);
	if (!eligible.ok) return eligible;
	const condition = checkConditionSpec(
		object["condition"],
		`${path}.condition`,
	);
	if (!condition.ok) return condition;
	let validTime: ValidTime | undefined;
	if (object["validTime"] !== undefined) {
		const vt = checkValidTime(object["validTime"], `${path}.validTime`);
		if (!vt.ok) return vt;
		validTime = vt.value;
	}
	let axis: ComparisonAxis | undefined;
	if (object["axis"] !== undefined) {
		const a = asRecord(object["axis"]);
		if (!a) return fail("INVALID_INPUT", `${path}.axis`);
		const abad = strict(a, ["metric", "comparison"], `${path}.axis`);
		if (abad) return abad;
		const metric = checkOpaque(a["metric"], `${path}.axis.metric`);
		if (!metric.ok) return metric;
		const comparison = checkOpaque(a["comparison"], `${path}.axis.comparison`);
		if (!comparison.ok) return comparison;
		axis = { metric: metric.value, comparison: comparison.value };
	}
	return ok({
		id: id.value,
		revision: revision.value,
		from: from.value,
		to: to.value,
		relation: relation as RelationKind,
		status: status as EdgeStatus,
		causalEligible: eligible.value,
		condition: condition.value,
		...(validTime ? { validTime } : {}),
		...(axis ? { axis } : {}),
	});
}

function checkContext(
	object: Record<string, unknown>,
	path: string,
): Checked<ConditionContext> {
	const asOf = checkEpochMs(object["asOf"], `${path}.asOf`);
	if (!asOf.ok) return asOf;
	const maxAge = checkSafeInteger(object["maxAgeMs"], `${path}.maxAgeMs`);
	if (!maxAge.ok) return maxAge;
	if (maxAge.value < 0) return fail("INVALID_INPUT", `${path}.maxAgeMs`);
	const raw = object["observations"] ?? [];
	if (!Array.isArray(raw)) return fail("INVALID_INPUT", `${path}.observations`);
	if (raw.length > 500) return fail("LIMIT_EXCEEDED", `${path}.observations`);
	const observations: Observation[] = [];
	for (let i = 0; i < raw.length; i++) {
		const o = checkObservation(raw[i], `${path}.observations[${i}]`);
		if (!o.ok) return o;
		observations.push(o.value);
	}
	let currentVersions: { observationId: string; version: string }[] | undefined;
	if (object["currentVersions"] !== undefined) {
		const rawV = object["currentVersions"];
		if (!Array.isArray(rawV))
			return fail("INVALID_INPUT", `${path}.currentVersions`);
		currentVersions = [];
		for (let i = 0; i < rawV.length; i++) {
			const v = asRecord(rawV[i]);
			if (!v) return fail("INVALID_INPUT", `${path}.currentVersions[${i}]`);
			const vbad = strict(
				v,
				["observationId", "version"],
				`${path}.currentVersions[${i}]`,
			);
			if (vbad) return vbad;
			const oid = checkId(
				v["observationId"],
				`${path}.currentVersions[${i}].observationId`,
			);
			if (!oid.ok) return oid;
			const ver = checkOpaque(
				v["version"],
				`${path}.currentVersions[${i}].version`,
			);
			if (!ver.ok) return ver;
			currentVersions.push({ observationId: oid.value, version: ver.value });
		}
	}
	return ok({
		asOf: asOf.value,
		maxAgeMs: maxAge.value,
		observations,
		...(currentVersions ? { currentVersions } : {}),
	});
}

const graphKeys = [
	"contractVersion",
	"scope",
	"authorized",
	"edges",
	"asOf",
	"maxAgeMs",
	"observations",
	"currentVersions",
	"budget",
];

/** Shared prefix of all four query inputs; `extra` lists the API's own keys. */
export function checkGraphInput(
	value: unknown,
	extra: readonly string[],
): Checked<{ graph: GraphInput; object: Record<string, unknown> }> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", "input");
	const bad = strict(object, [...graphKeys, ...extra], "input");
	if (bad) return bad;
	const version = checkContractVersion(object["contractVersion"]);
	if (!version.ok) return version;
	const scope = checkScope(object["scope"]);
	if (!scope.ok) return scope;
	const authorized = checkBoolean(object["authorized"], "authorized");
	if (!authorized.ok) return authorized;
	const budget = checkBudget(object["budget"]);
	if (!budget.ok) return budget;
	const context = checkContext(object, "input");
	if (!context.ok) return context;
	const raw = object["edges"];
	if (!Array.isArray(raw)) return fail("INVALID_INPUT", "edges");
	// One sentinel row beyond the candidate budget is allowed, never more.
	if (raw.length > budget.value.candidates + 1)
		return fail("LIMIT_EXCEEDED", "edges");
	const edges: ReasoningEdge[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < raw.length; i++) {
		const edge = checkEdge(raw[i], `edges[${i}]`);
		if (!edge.ok) return edge;
		const key = `${edge.value.id}\u0000${edge.value.revision}`;
		if (seen.has(key)) return fail("INVALID_INPUT", `edges[${i}]`);
		seen.add(key);
		edges.push(edge.value);
	}
	return ok({
		graph: {
			scope: scope.value,
			authorized: authorized.value,
			edges,
			context: context.value,
			budget: budget.value,
		},
		object,
	});
}

export const reasoningReasons = [
	"CANDIDATE_BUDGET",
	"EXPANSION_BUDGET",
	"DEPTH_BUDGET",
	"ENTITY_BUDGET",
	"RELATION_BUDGET",
	"PATH_BUDGET",
	"PRESENTATION_BUDGET",
] as const;
export type ReasoningReason = (typeof reasoningReasons)[number];

export type ResourceState = "available" | "unavailable" | "unknown";
export const resourceStates: readonly ResourceState[] = [
	"available",
	"unavailable",
	"unknown",
];
