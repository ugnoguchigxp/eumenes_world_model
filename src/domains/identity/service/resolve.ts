import {
	checkId,
	checkOpaque,
	checkScope,
	limits,
	sameScope,
	type Checked,
	fail,
	ok,
} from "../../../contracts/index.ts";
import {
	checkOptionalVersion,
	normalizeAlias,
	parseEntities,
	strictRecord,
	type Entity,
	type Resolution,
	type ResolveQuery,
	type ResolveRequest,
} from "../contracts/entity.ts";

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function parseQuery(value: unknown): Checked<ResolveQuery> {
	const probe = strictRecord(value, "query", [
		"kind",
		"id",
		"system",
		"externalId",
		"text",
	]);
	if (!probe.ok) return probe;
	const o = probe.value;
	const only = (keys: string[]) =>
		Object.keys(o).every((k) => k === "kind" || keys.includes(k));
	if (o["kind"] === "id" && only(["id"])) {
		const id = checkId(o["id"], "query.id");
		return id.ok ? ok({ kind: "id", id: id.value }) : id;
	}
	if (o["kind"] === "external" && only(["system", "externalId"])) {
		const system = checkId(o["system"], "query.system");
		if (!system.ok) return system;
		const externalId = checkId(o["externalId"], "query.externalId");
		return externalId.ok
			? ok({
					kind: "external",
					system: system.value,
					externalId: externalId.value,
				})
			: externalId;
	}
	if (o["kind"] === "alias" && only(["text"])) {
		const text = checkOpaque(o["text"], "query.text", limits.stringValueBytes);
		return text.ok ? ok({ kind: "alias", text: text.value }) : text;
	}
	return fail("INVALID_INPUT", "query.kind");
}

/** Follow mergedInto within the visible entities; bounded against cycles. */
function activeId(
	id: string,
	entities: Map<string, Entity>,
): string | undefined {
	let current = entities.get(id);
	for (let hops = 0; current && hops <= entities.size; hops++) {
		if (current.mergedInto === undefined) return current.id;
		current = entities.get(current.mergedInto);
	}
	return undefined;
}

/**
 * Explicit ID and external reference match first (exact), then alias
 * candidates within the request Scope. Entities of other Scopes are ignored
 * and never influence the result or counts.
 */
export function resolveEntity(
	request: unknown,
	entities: unknown,
): Checked<Resolution> {
	const probe = strictRecord(request, "request", [
		"contractVersion",
		"scope",
		"query",
	]);
	if (!probe.ok) return probe;
	const version = checkOptionalVersion(probe.value, "request");
	if (!version.ok) return version;
	const scope = checkScope(probe.value["scope"], "request.scope");
	if (!scope.ok) return scope;
	const query = parseQuery(probe.value["query"]);
	if (!query.ok) return query;
	const parsed = parseEntities(entities, "entities");
	if (!parsed.ok) return parsed;
	const typed: ResolveRequest = { scope: scope.value, query: query.value };
	const visible = new Map<string, Entity>();
	for (const e of parsed.value)
		if (sameScope(e.scope, typed.scope)) visible.set(e.id, e);
	const q = typed.query;
	if (q.kind === "id") {
		const id = visible.has(q.id) ? activeId(q.id, visible) : undefined;
		return ok(
			id === undefined
				? { status: "missing" }
				: { status: "resolved", entityId: id, via: "id" },
		);
	}
	const live = [...visible.values()].filter((e) => e.mergedInto === undefined);
	if (q.kind === "external") {
		const hits = live
			.filter((e) =>
				e.externalRefs.some(
					(r) => r.system === q.system && r.id === q.externalId,
				),
			)
			.map((e) => e.id)
			.sort(byId);
		return ok(pick(hits, "external"));
	}
	const wanted = normalizeAlias(q.text);
	const hits = live
		.filter((e) =>
			[e.displayName, ...e.aliases].some((a) => normalizeAlias(a) === wanted),
		)
		.map((e) => e.id)
		.sort(byId);
	return ok(pick(hits, "alias"));
}

function pick(ids: string[], via: "external" | "alias"): Resolution {
	if (ids.length === 0) return { status: "missing" };
	if (ids.length === 1) return { status: "resolved", entityId: ids[0]!, via };
	return { status: "ambiguous", candidateIds: ids };
}
