import {
	asRecord,
	checkContractVersion,
	checkId,
	checkOpaque,
	checkScope,
	firstUnknownKey,
	limits,
	type ScopeRef,
} from "../../contracts/index.ts";
import {
	aliasPrefixRange,
	filterActiveIdsByAliasPrefix,
	getEntity,
	listActiveEntityIds,
	resolveRepresentativeId,
	type AliasPrefixRange,
} from "../../domains/identity/sqlite.ts";
import type { ExternalRef } from "../../domains/identity/index.ts";
import { getTombstone, isGateOpen } from "../../domains/lifecycle/sqlite.ts";
import {
	requireTransaction,
	WorldIntegrityError,
	type WorldDb,
} from "../../infrastructure/sqlite/db.ts";
import { blockedResult, checkAccess, rejectedResult } from "./checks.ts";

/** Most entries one call returns, and most ids one query may name. */
export const maxListEntities = 500;

/** One live entity. Aliases are plain text; no evidence or assertions. */
export interface ListedEntity {
	readonly id: string;
	readonly revision: number;
	readonly displayName: string;
	readonly aliases: readonly string[];
	readonly externalRefs: readonly ExternalRef[];
}
export type ListEntitiesResult =
	| {
			readonly status: "ready";
			/** In id order. Never absorbed members, never forgotten entities. */
			readonly entities: readonly ListedEntity[];
			/** True when more than `limit` entities match. */
			readonly truncated: boolean;
	  }
	| { readonly status: "rejected" | "blocked"; readonly reasonCode: string };

interface ListRequest {
	readonly scope: ScopeRef;
	readonly ids: readonly string[] | undefined;
	readonly range: AliasPrefixRange | undefined;
	readonly limit: number;
}

function parseRequest(raw: unknown): ListRequest | { readonly reason: string } {
	const request = asRecord(raw);
	if (
		!request ||
		firstUnknownKey(request, [
			"contractVersion",
			"access",
			"scopeKey",
			"query",
			"limit",
		]) !== undefined
	)
		return { reason: "INVALID_INPUT" };
	const version = checkContractVersion(request["contractVersion"]);
	if (!version.ok) return { reason: version.code };
	const access = asRecord(request["access"]);
	const scope = checkScope({
		principal: access?.["principal"],
		scopeKey: request["scopeKey"],
	});
	if (!access || !scope.ok) return { reason: "INVALID_INPUT" };
	const limit = request["limit"];
	if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1)
		return { reason: "INVALID_INPUT" };
	if (limit > maxListEntities) return { reason: "LIMIT_EXCEEDED" };
	let ids: string[] | undefined;
	let range: AliasPrefixRange | undefined;
	if (request["query"] !== undefined) {
		const query = asRecord(request["query"]);
		if (!query || firstUnknownKey(query, ["aliasPrefix", "ids"]) !== undefined)
			return { reason: "INVALID_INPUT" };
		if (query["aliasPrefix"] !== undefined) {
			const prefix = checkOpaque(
				query["aliasPrefix"],
				"query.aliasPrefix",
				limits.stringValueBytes,
			);
			if (!prefix.ok) return { reason: "INVALID_INPUT" };
			range = aliasPrefixRange(prefix.value);
			if (range.lower.length === 0) return { reason: "INVALID_INPUT" };
		}
		if (query["ids"] !== undefined) {
			if (!Array.isArray(query["ids"])) return { reason: "INVALID_INPUT" };
			const raw = query["ids"] as unknown[];
			if (raw.length > maxListEntities) return { reason: "LIMIT_EXCEEDED" };
			ids = [];
			for (const id of raw) {
				const checked = checkId(id, "query.ids");
				if (!checked.ok || ids.includes(checked.value))
					return { reason: "INVALID_INPUT" };
				ids.push(checked.value);
			}
		}
	}
	const permitted = checkAccess(
		access,
		scope.value,
		typeof access["policyRevision"] === "string"
			? access["policyRevision"]
			: "",
	);
	if (permitted !== "ok") return { reason: permitted };
	return { scope: scope.value, ids, range, limit };
}

const forgotten = (db: WorldDb, scope: ScopeRef, id: string) =>
	getTombstone(db, scope, { kind: "entity", id }) !== undefined;

/** Representatives (id order, forgotten ones dropped) of the requested ids. */
function representativesOf(
	db: WorldDb,
	scope: ScopeRef,
	ids: readonly string[],
	range: AliasPrefixRange | undefined,
): string[] {
	const found = new Set<string>();
	for (const id of ids) {
		if (forgotten(db, scope, id)) continue;
		const rep = resolveRepresentativeId(db, scope, id);
		if (rep !== undefined && !forgotten(db, scope, rep)) found.add(rep);
	}
	const sorted = [...found].sort();
	if (!range) return sorted;
	const matching = filterActiveIdsByAliasPrefix(db, scope, sorted, range);
	return sorted.filter((id) => matching.has(id));
}

/** Active entities in id order, `limit + 1` of them at most. */
function scanActive(
	db: WorldDb,
	scope: ScopeRef,
	range: AliasPrefixRange | undefined,
	limit: number,
): string[] {
	const out: string[] = [];
	let afterId: string | undefined;
	while (out.length <= limit) {
		const page = listActiveEntityIds(db, scope, {
			afterId,
			range,
			batch: limit + 1,
		});
		for (const id of page)
			if (out.length <= limit && !forgotten(db, scope, id)) out.push(id);
		if (page.length < limit + 1) break;
		afterId = page[page.length - 1];
	}
	return out;
}

/**
 * Read-only, bounded listing of one permitted Scope's live entities. It must
 * run inside the host's transaction. The principal comes from `access`; a
 * Scope that is not granted is rejected before any table is read, and a closed
 * gate is `blocked GATE_CLOSED`. Absorbed (merged) members are never listed:
 * `ids` naming one yields its representative, and a prefix finds a member's
 * text through the representative that carries it. Forgotten entities are
 * never listed. A `limit` above the maximum is rejected, not clamped.
 */
export function listEntities(
	db: WorldDb,
	rawRequest: unknown,
): ListEntitiesResult {
	requireTransaction(db);
	const request = parseRequest(rawRequest);
	if ("reason" in request) return rejectedResult(request.reason);
	const { scope, limit } = request;
	if (!isGateOpen(db, scope)) return blockedResult("GATE_CLOSED");
	const matched =
		request.ids === undefined
			? scanActive(db, scope, request.range, limit)
			: representativesOf(db, scope, request.ids, request.range);
	const entities: ListedEntity[] = [];
	for (const id of matched.slice(0, limit)) {
		const entity = getEntity(db, scope, id);
		// Listed ids were just read in this snapshot: a gap is corruption.
		if (!entity) throw new WorldIntegrityError("ENTITY_VANISHED");
		entities.push({
			id: entity.id,
			revision: entity.revision,
			displayName: entity.displayName,
			aliases: entity.aliases,
			externalRefs: entity.externalRefs,
		});
	}
	return { status: "ready", entities, truncated: matched.length > limit };
}
