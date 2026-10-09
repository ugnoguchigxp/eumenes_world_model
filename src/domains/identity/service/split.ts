import {
	checkId,
	checkRevision,
	checkScope,
	fail,
	ok,
	sameScope,
	type Checked,
} from "../../../contracts/index.ts";
import {
	listOf,
	parseEntities,
	canAdvanceRevision,
	parseMergePlan,
	strictRecord,
	type Entity,
	type SplitRequest,
	type SplitResult,
} from "../contracts/entity.ts";

const rejected = (
	reasonCode: Extract<SplitResult, { status: "rejected" }>["reasonCode"],
): Checked<SplitResult> => ok({ status: "rejected", reasonCode });

function parseRequest(value: unknown): Checked<SplitRequest> {
	const o = strictRecord(value, "request", [
		"scope",
		"operationId",
		"mergeOperationId",
		"expectedRevision",
		"history",
		"splitMergeOperationIds",
		"entities",
	]);
	if (!o.ok) return o;
	const scope = checkScope(o.value["scope"], "request.scope");
	if (!scope.ok) return scope;
	const operationId = checkId(o.value["operationId"], "request.operationId");
	if (!operationId.ok) return operationId;
	const mergeOperationId = checkId(
		o.value["mergeOperationId"],
		"request.mergeOperationId",
	);
	if (!mergeOperationId.ok) return mergeOperationId;
	const expectedRevision = checkRevision(
		o.value["expectedRevision"],
		"request.expectedRevision",
	);
	if (!expectedRevision.ok) return expectedRevision;
	const history = listOf(o.value["history"], "request.history", parseMergePlan);
	if (!history.ok) return history;
	// Two plans with one operationId would make "first match wins" order-dependent.
	const historyKeys = new Set<string>();
	for (const [index, plan] of history.value.entries()) {
		const key = JSON.stringify([
			plan.scope.principal,
			plan.scope.scopeKey,
			plan.operationId,
		]);
		if (historyKeys.has(key))
			return fail("INVALID_INPUT", `request.history[${index}].operationId`);
		historyKeys.add(key);
	}
	const done = listOf(
		o.value["splitMergeOperationIds"],
		"request.splitMergeOperationIds",
		checkId,
	);
	if (!done.ok) return done;
	const entities = parseEntities(o.value["entities"], "request.entities");
	if (!entities.ok) return entities;
	return ok({
		scope: scope.value,
		operationId: operationId.value,
		mergeOperationId: mergeOperationId.value,
		expectedRevision: expectedRevision.value,
		history: history.value,
		splitMergeOperationIds: done.value,
		entities: entities.value,
	});
}

/**
 * Restores the recorded pre-merge mapping of one merge operation. Nothing is
 * re-inferred: only the history entry and the current ledger state are used.
 */
export function planSplit(input: unknown): Checked<SplitResult> {
	const parsed = parseRequest(input);
	if (!parsed.ok) return parsed;
	const req = parsed.value;
	const merge = req.history.find(
		(h) =>
			h.operationId === req.mergeOperationId && sameScope(h.scope, req.scope),
	);
	if (!merge) return rejected("MERGE_HISTORY_NOT_FOUND");
	if (req.splitMergeOperationIds.includes(req.mergeOperationId))
		return rejected("ALREADY_SPLIT");
	const visible = new Map<string, Entity>();
	for (const e of req.entities)
		if (sameScope(e.scope, req.scope)) visible.set(e.id, e);
	const rep = visible.get(merge.representativeId);
	if (!rep) return rejected("ENTITY_NOT_FOUND");
	if (req.expectedRevision !== rep.revision)
		return rejected("REVISION_CONFLICT");
	// The representative or members changed after the merge: refuse, never guess.
	if (rep.revision !== merge.representativeAfter.revision)
		return rejected("REVISION_CONFLICT");
	for (const m of merge.members) {
		const current = visible.get(m.id);
		if (!current) return rejected("ENTITY_NOT_FOUND");
		if (current.mergedInto !== merge.representativeId)
			return rejected("MERGE_CYCLE");
		if (current.revision !== m.nextRevision)
			return rejected("REVISION_CONFLICT");
	}
	if (
		!canAdvanceRevision(rep.revision) ||
		merge.members.some((m) => !canAdvanceRevision(m.nextRevision))
	)
		return fail("LIMIT_EXCEEDED", "request.expectedRevision");
	const { id, displayName, aliases, externalRefs } = merge.representativeBefore;
	return ok({
		status: "planned",
		plan: {
			kind: "split",
			operationId: req.operationId,
			mergeOperationId: merge.operationId,
			scope: req.scope,
			representativeId: merge.representativeId,
			representative: {
				id,
				revision: rep.revision,
				displayName,
				aliases: [...aliases],
				externalRefs: externalRefs.map((r) => ({ ...r })),
				nextRevision: rep.revision + 1,
			},
			restored: merge.members.map((m) => ({
				id: m.id,
				revision: m.nextRevision,
				displayName: m.displayName,
				aliases: [...m.aliases],
				externalRefs: m.externalRefs.map((r) => ({ ...r })),
				nextRevision: m.nextRevision + 1,
			})),
		},
	});
}
