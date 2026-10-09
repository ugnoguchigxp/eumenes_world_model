import {
	asRecord,
	checkId,
	checkOpaque,
	checkRevision,
	checkContractVersion,
	checkScope,
	fail,
	firstUnknownKey,
	limits,
	ok,
	type Checked,
	type ScopeRef,
} from "../../../contracts/index.ts";

export interface ExternalRef {
	readonly system: string;
	readonly id: string;
}
/** Entity as read from the ledger. Every entity carries its owning Scope. */
export interface Entity {
	readonly id: string;
	readonly scope: ScopeRef;
	readonly revision: number;
	readonly displayName: string;
	readonly aliases: readonly string[];
	readonly externalRefs: readonly ExternalRef[];
	readonly mergedInto?: string;
}

export type IdentityRejectCode =
	| "INVALID_INPUT"
	| "LIMIT_EXCEEDED"
	| "SCOPE_NOT_PERMITTED"
	| "REVISION_CONFLICT"
	| "ENTITY_NOT_FOUND"
	| "MERGE_CYCLE"
	| "MERGE_HISTORY_NOT_FOUND"
	| "ALREADY_SPLIT";
export interface Rejected {
	readonly status: "rejected";
	readonly reasonCode: IdentityRejectCode;
}

export type ResolveQuery =
	| { readonly kind: "id"; readonly id: string }
	| {
			readonly kind: "external";
			readonly system: string;
			readonly externalId: string;
	  }
	| { readonly kind: "alias"; readonly text: string };
export interface ResolveRequest {
	readonly scope: ScopeRef;
	readonly query: ResolveQuery;
}
export type Resolution =
	| {
			readonly status: "resolved";
			readonly entityId: string;
			readonly via: "id" | "external" | "alias";
	  }
	| { readonly status: "ambiguous"; readonly candidateIds: readonly string[] }
	| { readonly status: "missing" };

export interface MemberSnapshot {
	readonly id: string;
	readonly revision: number;
	readonly displayName: string;
	readonly aliases: readonly string[];
	readonly externalRefs: readonly ExternalRef[];
}
/** Reversible merge history entry; this is also the persisted event shape. */
export interface MergePlan {
	readonly kind: "merge";
	readonly operationId: string;
	readonly scope: ScopeRef;
	readonly representativeId: string;
	readonly evidence: readonly string[];
	/** State of the representative before the merge (restored by split). */
	readonly representativeBefore: MemberSnapshot;
	readonly representativeAfter: MemberSnapshot;
	/** Merged-away entities with their original state, sorted by id. */
	readonly members: readonly (MemberSnapshot & {
		readonly nextRevision: number;
	})[];
}
export interface SplitPlan {
	readonly kind: "split";
	readonly operationId: string;
	readonly mergeOperationId: string;
	readonly scope: ScopeRef;
	readonly representativeId: string;
	readonly representative: MemberSnapshot & { readonly nextRevision: number };
	readonly restored: readonly (MemberSnapshot & {
		readonly nextRevision: number;
	})[];
}

export interface MergeRequest {
	readonly scope: ScopeRef;
	readonly operationId: string;
	readonly representativeId: string;
	/** Includes the representative. At least two unique ids. */
	readonly targetIds: readonly string[];
	/** Expected current revision for every target id. */
	readonly expectedRevisions: Readonly<Record<string, number>>;
	readonly evidence: readonly string[];
	readonly entities: readonly Entity[];
}
export interface SplitRequest {
	readonly scope: ScopeRef;
	readonly operationId: string;
	readonly mergeOperationId: string;
	readonly expectedRevision: number;
	readonly history: readonly MergePlan[];
	/** Merge operation ids that already have a split. */
	readonly splitMergeOperationIds: readonly string[];
	readonly entities: readonly Entity[];
}
export type MergeResult =
	| { readonly status: "planned"; readonly plan: MergePlan }
	| Rejected;
export type SplitResult =
	| { readonly status: "planned"; readonly plan: SplitPlan }
	| Rejected;

/** Alias normal form: trim and Unicode NFC only. Original text is kept. */
export function normalizeAlias(text: string): string {
	return text.trim().normalize("NFC");
}

/** Max aliases / external refs per entity as accepted by the parsers. */
export const maxEntityItems = 1000;
const maxItems = maxEntityItems;

export function strictRecord(
	value: unknown,
	path: string,
	keys: readonly string[],
): Checked<Record<string, unknown>> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const extra = firstUnknownKey(object, keys);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	return ok(object);
}
/**
 * `contractVersion` is optional on identity inputs for compatibility with the
 * existing internal callers; when present it must be exactly 1 (an unknown
 * version is UNSUPPORTED_CONTRACT_VERSION, not an unknown field).
 */
export function checkOptionalVersion(
	o: Record<string, unknown>,
	path: string,
): Checked<true> {
	if (!Object.hasOwn(o, "contractVersion")) return ok(true);
	const v = checkContractVersion(
		o["contractVersion"],
		`${path}.contractVersion`,
	);
	return v.ok ? ok(true) : v;
}
export function listOf<T>(
	value: unknown,
	path: string,
	item: (value: unknown, path: string) => Checked<T>,
	max = maxItems,
): Checked<T[]> {
	if (!Array.isArray(value)) return fail("INVALID_INPUT", path);
	if (value.length > max) return fail("LIMIT_EXCEEDED", path);
	const out: T[] = [];
	for (let i = 0; i < value.length; i++) {
		if (!(i in value)) return fail("INVALID_INPUT", `${path}[${i}]`);
		const r = item(value[i], `${path}[${i}]`);
		if (!r.ok) return r;
		out.push(r.value);
	}
	return ok(out);
}
const aliasText = (value: unknown, path: string): Checked<string> => {
	const r = checkOpaque(value, path, limits.stringValueBytes);
	if (!r.ok) return r;
	return normalizeAlias(r.value).length === 0 ? fail("INVALID_INPUT", path) : r;
};
const externalRef = (value: unknown, path: string): Checked<ExternalRef> => {
	const o = strictRecord(value, path, ["system", "id"]);
	if (!o.ok) return o;
	const system = checkId(o.value["system"], `${path}.system`);
	if (!system.ok) return system;
	const id = checkId(o.value["id"], `${path}.id`);
	return id.ok ? ok({ system: system.value, id: id.value }) : id;
};

export function parseEntity(value: unknown, path: string): Checked<Entity> {
	const o = strictRecord(value, path, [
		"id",
		"scope",
		"revision",
		"displayName",
		"aliases",
		"externalRefs",
		"mergedInto",
	]);
	if (!o.ok) return o;
	const id = checkId(o.value["id"], `${path}.id`);
	if (!id.ok) return id;
	const scope = checkScope(o.value["scope"], `${path}.scope`);
	if (!scope.ok) return scope;
	const revision = checkRevision(o.value["revision"], `${path}.revision`);
	if (!revision.ok) return revision;
	const displayName = aliasText(o.value["displayName"], `${path}.displayName`);
	if (!displayName.ok) return displayName;
	const aliases = listOf(o.value["aliases"], `${path}.aliases`, aliasText);
	if (!aliases.ok) return aliases;
	const refs = listOf(
		o.value["externalRefs"],
		`${path}.externalRefs`,
		externalRef,
	);
	if (!refs.ok) return refs;
	const base = {
		id: id.value,
		scope: scope.value,
		revision: revision.value,
		displayName: displayName.value,
		aliases: aliases.value,
		externalRefs: refs.value,
	};
	if (o.value["mergedInto"] === undefined) return ok(base);
	const into = checkId(o.value["mergedInto"], `${path}.mergedInto`);
	return into.ok ? ok({ ...base, mergedInto: into.value }) : into;
}
/**
 * Entities are keyed by (principal, scopeKey, id). A duplicate would make the
 * result depend on input order (last one wins), so it is rejected.
 */
export function parseEntities(value: unknown, path: string): Checked<Entity[]> {
	const list = listOf(value, path, parseEntity);
	if (!list.ok) return list;
	const seen = new Set<string>();
	for (const [index, entity] of list.value.entries()) {
		const key = JSON.stringify([
			entity.scope.principal,
			entity.scope.scopeKey,
			entity.id,
		]);
		if (seen.has(key)) return fail("INVALID_INPUT", `${path}[${index}].id`);
		seen.add(key);
	}
	return ok(list.value);
}
/** The next revision must stay a safe integer (C2). */
export const canAdvanceRevision = (revision: number) =>
	revision < Number.MAX_SAFE_INTEGER;
export const parseIdList = (value: unknown, path: string) =>
	listOf(value, path, checkId);

const member = (value: unknown, path: string, extra: readonly string[]) => {
	const o = strictRecord(value, path, [
		"id",
		"revision",
		"displayName",
		"aliases",
		"externalRefs",
		...extra,
	]);
	if (!o.ok) return o;
	const id = checkId(o.value["id"], `${path}.id`);
	if (!id.ok) return id;
	const revision = checkRevision(o.value["revision"], `${path}.revision`);
	if (!revision.ok) return revision;
	const displayName = aliasText(o.value["displayName"], `${path}.displayName`);
	if (!displayName.ok) return displayName;
	const aliases = listOf(o.value["aliases"], `${path}.aliases`, aliasText);
	if (!aliases.ok) return aliases;
	const refs = listOf(
		o.value["externalRefs"],
		`${path}.externalRefs`,
		externalRef,
	);
	if (!refs.ok) return refs;
	return ok({
		id: id.value,
		revision: revision.value,
		displayName: displayName.value,
		aliases: aliases.value,
		externalRefs: refs.value,
		raw: o.value,
	});
};
const parseMember = (value: unknown, path: string): Checked<MemberSnapshot> => {
	const m = member(value, path, []);
	if (!m.ok) return m;
	const { raw: _raw, ...rest } = m.value;
	return ok(rest);
};
const parseMergedMember = (
	value: unknown,
	path: string,
): Checked<MemberSnapshot & { nextRevision: number }> => {
	const m = member(value, path, ["nextRevision"]);
	if (!m.ok) return m;
	const next = checkRevision(
		m.value.raw["nextRevision"],
		`${path}.nextRevision`,
	);
	if (!next.ok) return next;
	const { raw: _raw, ...rest } = m.value;
	return ok({ ...rest, nextRevision: next.value });
};

export function parseMergePlan(
	value: unknown,
	path: string,
): Checked<MergePlan> {
	const o = strictRecord(value, path, [
		"kind",
		"operationId",
		"scope",
		"representativeId",
		"evidence",
		"representativeBefore",
		"representativeAfter",
		"members",
	]);
	if (!o.ok) return o;
	if (o.value["kind"] !== "merge") return fail("INVALID_INPUT", `${path}.kind`);
	const operationId = checkId(o.value["operationId"], `${path}.operationId`);
	if (!operationId.ok) return operationId;
	const scope = checkScope(o.value["scope"], `${path}.scope`);
	if (!scope.ok) return scope;
	const representativeId = checkId(
		o.value["representativeId"],
		`${path}.representativeId`,
	);
	if (!representativeId.ok) return representativeId;
	const evidence = parseIdList(o.value["evidence"], `${path}.evidence`);
	if (!evidence.ok) return evidence;
	const before = parseMember(
		o.value["representativeBefore"],
		`${path}.representativeBefore`,
	);
	if (!before.ok) return before;
	const after = parseMember(
		o.value["representativeAfter"],
		`${path}.representativeAfter`,
	);
	if (!after.ok) return after;
	const members = listOf(
		o.value["members"],
		`${path}.members`,
		parseMergedMember,
	);
	if (!members.ok) return members;
	// Internal consistency of a (possibly hand-built or corrupt) history entry.
	if (before.value.id !== representativeId.value)
		return fail("INVALID_INPUT", `${path}.representativeBefore.id`);
	if (after.value.id !== representativeId.value)
		return fail("INVALID_INPUT", `${path}.representativeAfter.id`);
	if (after.value.revision !== before.value.revision + 1)
		return fail("INVALID_INPUT", `${path}.representativeAfter.revision`);
	const memberIds = new Set<string>();
	for (const [i, m] of members.value.entries()) {
		if (m.id === representativeId.value || memberIds.has(m.id))
			return fail("INVALID_INPUT", `${path}.members[${i}].id`);
		memberIds.add(m.id);
		if (m.nextRevision !== m.revision + 1)
			return fail("INVALID_INPUT", `${path}.members[${i}].nextRevision`);
	}
	if (members.value.length === 0)
		return fail("INVALID_INPUT", `${path}.members`);
	return ok({
		kind: "merge",
		operationId: operationId.value,
		scope: scope.value,
		representativeId: representativeId.value,
		evidence: evidence.value,
		representativeBefore: before.value,
		representativeAfter: after.value,
		members: members.value,
	});
}
