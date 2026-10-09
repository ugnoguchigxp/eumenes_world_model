import {
	canonicalBytes,
	checkId,
	checkRevision,
	checkScope,
	fail,
	ok,
	sameScope,
	type Checked,
} from "../../../contracts/index.ts";
import {
	canAdvanceRevision,
	checkOptionalVersion,
	maxEntityItems,
	normalizeAlias,
	parseEntities,
	parseIdList,
	strictRecord,
	type Entity,
	type ExternalRef,
	type MemberSnapshot,
	type MergeRequest,
	type MergeResult,
} from "../contracts/entity.ts";

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const rejected = (
	reasonCode: Extract<MergeResult, { status: "rejected" }>["reasonCode"],
): MergeResult => ({
	status: "rejected",
	reasonCode,
});
const snapshot = (e: Entity): MemberSnapshot => ({
	id: e.id,
	revision: e.revision,
	displayName: e.displayName,
	aliases: [...e.aliases],
	externalRefs: e.externalRefs.map((r) => ({ ...r })),
});

function parseRequest(value: unknown): Checked<MergeRequest> {
	const o = strictRecord(value, "request", [
		"contractVersion",
		"scope",
		"operationId",
		"representativeId",
		"targetIds",
		"expectedRevisions",
		"evidence",
		"entities",
	]);
	if (!o.ok) return o;
	const version = checkOptionalVersion(o.value, "request");
	if (!version.ok) return version;
	const scope = checkScope(o.value["scope"], "request.scope");
	if (!scope.ok) return scope;
	const operationId = checkId(o.value["operationId"], "request.operationId");
	if (!operationId.ok) return operationId;
	const representativeId = checkId(
		o.value["representativeId"],
		"request.representativeId",
	);
	if (!representativeId.ok) return representativeId;
	const targetIds = parseIdList(o.value["targetIds"], "request.targetIds");
	if (!targetIds.ok) return targetIds;
	const evidence = parseIdList(o.value["evidence"], "request.evidence");
	if (!evidence.ok) return evidence;
	const rev = o.value["expectedRevisions"];
	if (typeof rev !== "object" || rev === null || Array.isArray(rev))
		return fail("INVALID_INPUT", "request.expectedRevisions");
	// Null prototype: ids are opaque, so "__proto__" or "constructor" are plain keys.
	const expectedRevisions: Record<string, number> = Object.create(null);
	for (const [key, v] of Object.entries(rev)) {
		const r = checkRevision(v, `request.expectedRevisions.${key}`);
		if (!r.ok) return r;
		Object.defineProperty(expectedRevisions, key, {
			value: r.value,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	const entities = parseEntities(o.value["entities"], "request.entities");
	if (!entities.ok) return entities;
	return ok({
		scope: scope.value,
		operationId: operationId.value,
		representativeId: representativeId.value,
		targetIds: targetIds.value,
		expectedRevisions,
		evidence: evidence.value,
		entities: entities.value,
	});
}

/** Union of strings by NFC/trim form, first original spelling wins. */
function unionAliases(lists: readonly (readonly string[])[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const list of lists)
		for (const text of list) {
			const key = normalizeAlias(text);
			if (!seen.has(key)) {
				seen.add(key);
				out.push(text);
			}
		}
	return out;
}
function unionRefs(lists: readonly (readonly ExternalRef[])[]): ExternalRef[] {
	const seen = new Set<string>();
	const out: ExternalRef[] = [];
	for (const list of lists)
		for (const r of list) {
			const key = JSON.stringify([r.system, r.id]);
			if (!seen.has(key)) {
				seen.add(key);
				out.push({ ...r });
			}
		}
	return out;
}

/**
 * Plans a reversible merge. Inputs are never mutated. All validation happens
 * before any plan is produced; the plan carries the original id/alias mapping.
 */
export function planMerge(input: unknown): Checked<MergeResult> {
	const parsed = parseRequest(input);
	if (!parsed.ok) return parsed;
	const req = parsed.value;
	const ids = [...new Set(req.targetIds)].sort(byId);
	if (ids.length !== req.targetIds.length || ids.length < 2)
		return fail("INVALID_INPUT", "request.targetIds");
	if (!ids.includes(req.representativeId))
		return fail("INVALID_INPUT", "request.representativeId");
	if (req.evidence.length === 0)
		return fail("INVALID_INPUT", "request.evidence");
	if (Object.keys(req.expectedRevisions).length !== ids.length)
		return fail("INVALID_INPUT", "request.expectedRevisions");
	const visible = new Map<string, Entity>();
	for (const e of req.entities)
		if (sameScope(e.scope, req.scope)) visible.set(e.id, e);
	const targets: Entity[] = [];
	for (const id of ids) {
		const e = visible.get(id);
		if (!e) return ok(rejected("ENTITY_NOT_FOUND"));
		targets.push(e);
	}
	// Merged-away entities cannot take part: no chains, no cycles to the representative.
	if (targets.some((e) => e.mergedInto !== undefined))
		return ok(rejected("MERGE_CYCLE"));
	for (const e of targets) {
		if (!Object.hasOwn(req.expectedRevisions, e.id))
			return ok(rejected("REVISION_CONFLICT"));
		if (req.expectedRevisions[e.id] !== e.revision)
			return ok(rejected("REVISION_CONFLICT"));
	}
	if (targets.some((e) => !canAdvanceRevision(e.revision)))
		return fail("LIMIT_EXCEEDED", "request.expectedRevisions");
	const rep = targets.find((e) => e.id === req.representativeId)!;
	const others = targets.filter((e) => e.id !== rep.id);
	const evidence = [...new Set(req.evidence)].sort(byId);
	const after: MemberSnapshot = {
		id: rep.id,
		revision: rep.revision + 1,
		displayName: rep.displayName,
		aliases: unionAliases([
			rep.aliases,
			...others.flatMap((e) => [[e.displayName], e.aliases]),
		]),
		externalRefs: unionRefs([
			rep.externalRefs,
			...others.map((e) => e.externalRefs),
		]),
	};
	// The merged representative must stay parseable on read (1000 items) and
	// within the single-payload limit, otherwise the scope would be bricked.
	if (
		after.aliases.length > maxEntityItems ||
		after.externalRefs.length > maxEntityItems
	)
		return fail("LIMIT_EXCEEDED", "representativeAfter");
	if (!canonicalBytes(after).ok)
		return fail("LIMIT_EXCEEDED", "representativeAfter");
	const plan = {
		kind: "merge" as const,
		operationId: req.operationId,
		scope: req.scope,
		representativeId: rep.id,
		evidence,
		representativeBefore: snapshot(rep),
		representativeAfter: after,
		members: others.map((e) => ({
			...snapshot(e),
			nextRevision: e.revision + 1,
		})),
	};
	// The whole plan is persisted as one identity event (64KiB payload cap).
	// A plan the repository cannot store must not be reported as planned.
	if (!canonicalBytes(plan).ok) return fail("LIMIT_EXCEEDED", "plan");
	return ok({ status: "planned", plan });
}
