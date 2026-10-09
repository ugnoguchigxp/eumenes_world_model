import {
	canonicalBytes,
	checkId,
	checkScope,
	sameScope,
	type ScopeRef,
} from "../../../contracts/index.ts";
import {
	expectChanges,
	requireTransaction,
	WorldIntegrityError,
	type SqlValue,
	type WorldDb,
} from "../../../infrastructure/sqlite/db.ts";
import {
	normalizeAlias,
	parseEntity,
	parseMergePlan,
	type Entity,
	type ExternalRef,
	type IdentityRejectCode,
	type MemberSnapshot,
	type MergePlan,
	type SplitPlan,
} from "../contracts/entity.ts";

export type EntityRejectCode =
	| IdentityRejectCode
	| "ENTITY_EXISTS"
	| "OPERATION_EXISTS"
	| "ENTITY_REFERENCED";
export type EntityWriteResult =
	| { readonly status: "applied" }
	| { readonly status: "rejected"; readonly reasonCode: EntityRejectCode };

/** What a caller supplies to create an entity (revision 1, scope from the call). */
export interface NewEntity {
	readonly id: string;
	readonly displayName: string;
	readonly aliases: readonly string[];
	readonly externalRefs: readonly ExternalRef[];
}
export interface AliasCandidates {
	readonly entityIds: readonly string[];
	/** True when more than `limit` active candidates exist (sentinel row seen). */
	readonly truncated: boolean;
}
export type IdentityEvent =
	| MergePlan
	| (SplitPlan & { readonly kind: "split" });
export interface DeleteEntitiesResult {
	readonly status: "applied";
	readonly deletedEntities: number;
	readonly deletedEvents: number;
}

const decoder = new TextDecoder();
const rejected = (reasonCode: EntityRejectCode): EntityWriteResult => ({
	status: "rejected",
	reasonCode,
});
const applied: EntityWriteResult = { status: "applied" };

function json(value: unknown): string {
	const bytes = canonicalBytes(value);
	if (!bytes.ok) throw new WorldIntegrityError("PAYLOAD_NOT_CANONICAL");
	return decoder.decode(bytes.value);
}
function scopeOf(scope: unknown): ScopeRef | undefined {
	const checked = checkScope(scope);
	return checked.ok ? checked.value : undefined;
}
function scopeOrThrow(scope: unknown): ScopeRef {
	const checked = scopeOf(scope);
	if (!checked) throw new WorldIntegrityError("INVALID_SCOPE");
	return checked;
}
const placeholders = (n: number) =>
	Array.from({ length: n }, () => "?").join(",");

interface EntityRow {
	readonly id: string;
	readonly revision: number;
	readonly status: "active" | "merged";
	readonly merged_into: string | null;
	readonly payload_json: string;
}
function selectEntity(
	db: WorldDb,
	scope: ScopeRef,
	id: string,
): EntityRow | undefined {
	const row = db
		.query(
			"SELECT id, revision, status, merged_into, payload_json FROM world_entity WHERE principal = ? AND scope_key = ? AND id = ?",
		)
		.get(scope.principal, scope.scopeKey, id);
	return row === null || row === undefined ? undefined : (row as EntityRow);
}
function toEntity(scope: ScopeRef, row: EntityRow): Entity {
	const payload = JSON.parse(row.payload_json) as {
		displayName: string;
		aliases: string[];
		externalRefs: ExternalRef[];
	};
	const base = {
		id: row.id,
		scope,
		revision: row.revision,
		displayName: payload.displayName,
		aliases: payload.aliases,
		externalRefs: payload.externalRefs,
	};
	return row.merged_into === null
		? base
		: { ...base, mergedInto: row.merged_into };
}
function memberPayload(
	m: Pick<MemberSnapshot, "displayName" | "aliases" | "externalRefs">,
) {
	return json({
		displayName: m.displayName,
		aliases: m.aliases,
		externalRefs: m.externalRefs,
	});
}
/** Replaces the alias rows of one entity with displayName + aliases (by NFC form). */
function replaceAliases(
	db: WorldDb,
	scope: ScopeRef,
	id: string,
	m: Pick<MemberSnapshot, "displayName" | "aliases">,
): void {
	db.query(
		"DELETE FROM world_alias WHERE principal = ? AND scope_key = ? AND entity_id = ?",
	).run(scope.principal, scope.scopeKey, id);
	const seen = new Set<string>();
	for (const original of [m.displayName, ...m.aliases]) {
		const norm = normalizeAlias(original);
		if (seen.has(norm)) continue;
		seen.add(norm);
		expectChanges(
			db
				.query(
					"INSERT INTO world_alias (principal, scope_key, alias_norm, entity_id, alias_original) VALUES (?, ?, ?, ?, ?)",
				)
				.run(scope.principal, scope.scopeKey, norm, id, original),
			1,
			"ALIAS_INSERT",
		);
	}
}
function eventExists(db: WorldDb, scope: ScopeRef, eventId: string): boolean {
	return (
		db
			.query(
				"SELECT 1 AS present FROM world_identity_event WHERE principal = ? AND scope_key = ? AND event_id = ?",
			)
			.get(scope.principal, scope.scopeKey, eventId) != null
	);
}
function insertEvent(
	db: WorldDb,
	scope: ScopeRef,
	event: IdentityEvent,
	revision: number,
): void {
	expectChanges(
		db
			.query(
				"INSERT INTO world_identity_event (principal, scope_key, event_id, kind, operation_id, revision, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
			)
			.run(
				scope.principal,
				scope.scopeKey,
				event.operationId,
				event.kind,
				event.operationId,
				revision,
				json(event),
			),
		1,
		"EVENT_INSERT",
	);
}

export function getEntity(
	db: WorldDb,
	scope: ScopeRef,
	id: string,
): Entity | undefined {
	const s = scopeOrThrow(scope);
	const row = selectEntity(db, s, id);
	return row ? toEntity(s, row) : undefined;
}

/** Active entities whose displayName/alias has the same NFC-trimmed form. Sorted by id. */
export function findAliasCandidates(
	db: WorldDb,
	scope: ScopeRef,
	text: string,
	limit: number,
): AliasCandidates {
	const s = scopeOrThrow(scope);
	if (!Number.isSafeInteger(limit) || limit < 1)
		throw new WorldIntegrityError("INVALID_LIMIT");
	const rows = db
		.query(
			`SELECT a.entity_id AS entity_id FROM world_alias a
			 JOIN world_entity e ON e.principal = a.principal AND e.scope_key = a.scope_key AND e.id = a.entity_id
			 WHERE a.principal = ? AND a.scope_key = ? AND a.alias_norm = ? AND e.status = 'active'
			 ORDER BY a.entity_id LIMIT ?`,
		)
		.all(s.principal, s.scopeKey, normalizeAlias(text), limit + 1) as {
		entity_id: string;
	}[];
	return {
		entityIds: rows.slice(0, limit).map((r) => r.entity_id),
		truncated: rows.length > limit,
	};
}

/** Identity events in insertion order, bounded by limit+1 sentinel. */
export function listEvents(
	db: WorldDb,
	scope: ScopeRef,
	limit: number,
): { readonly events: readonly IdentityEvent[]; readonly truncated: boolean } {
	const s = scopeOrThrow(scope);
	if (!Number.isSafeInteger(limit) || limit < 1)
		throw new WorldIntegrityError("INVALID_LIMIT");
	const rows = db
		.query(
			"SELECT payload_json FROM world_identity_event WHERE principal = ? AND scope_key = ? ORDER BY rowid LIMIT ?",
		)
		.all(s.principal, s.scopeKey, limit + 1) as { payload_json: string }[];
	return {
		events: rows
			.slice(0, limit)
			.map((r) => JSON.parse(r.payload_json) as IdentityEvent),
		truncated: rows.length > limit,
	};
}

export function registerEntity(
	db: WorldDb,
	scope: ScopeRef,
	input: NewEntity,
): EntityWriteResult {
	requireTransaction(db);
	const s = scopeOf(scope);
	if (!s) return rejected("INVALID_INPUT");
	const parsed = parseEntity({ ...input, scope: s, revision: 1 }, "entity");
	if (!parsed.ok)
		return rejected(
			parsed.code === "LIMIT_EXCEEDED" ? "LIMIT_EXCEEDED" : "INVALID_INPUT",
		);
	const entity = parsed.value;
	if (selectEntity(db, s, entity.id)) return rejected("ENTITY_EXISTS");
	expectChanges(
		db
			.query(
				"INSERT INTO world_entity (principal, scope_key, id, revision, status, merged_into, payload_json) VALUES (?, ?, ?, 1, 'active', NULL, ?)",
			)
			.run(s.principal, s.scopeKey, entity.id, memberPayload(entity)),
		1,
		"ENTITY_INSERT",
	);
	replaceAliases(db, s, entity.id, entity);
	return applied;
}

function validRevision(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

export function applyMergePlan(
	db: WorldDb,
	scope: ScopeRef,
	plan: MergePlan,
): EntityWriteResult {
	requireTransaction(db);
	const s = scopeOf(scope);
	if (!s) return rejected("INVALID_INPUT");
	const parsed = parseMergePlan(plan, "plan");
	if (!parsed.ok) return rejected("INVALID_INPUT");
	const p = parsed.value;
	if (!sameScope(p.scope, s)) return rejected("INVALID_INPUT");
	if (eventExists(db, s, p.operationId)) return rejected("OPERATION_EXISTS");
	const rep = selectEntity(db, s, p.representativeId);
	if (!rep) return rejected("ENTITY_NOT_FOUND");
	const members = p.members.map((m) => ({ m, row: selectEntity(db, s, m.id) }));
	if (members.some((x) => !x.row)) return rejected("ENTITY_NOT_FOUND");
	if (
		rep.status !== "active" ||
		members.some((x) => x.row!.status !== "active")
	)
		return rejected("MERGE_CYCLE");
	if (
		rep.revision !== p.representativeBefore.revision ||
		members.some((x) => x.row!.revision !== x.m.revision)
	)
		return rejected("REVISION_CONFLICT");
	// DML: members first (they reference the representative), then the representative.
	for (const { m } of members) {
		expectChanges(
			db
				.query(
					"UPDATE world_entity SET revision = ?, status = 'merged', merged_into = ? WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ? AND status = 'active'",
				)
				.run(
					m.nextRevision,
					p.representativeId,
					s.principal,
					s.scopeKey,
					m.id,
					m.revision,
				),
			1,
			"MERGE_MEMBER_UPDATE",
		);
	}
	expectChanges(
		db
			.query(
				"UPDATE world_entity SET revision = ?, payload_json = ? WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ? AND status = 'active'",
			)
			.run(
				p.representativeAfter.revision,
				memberPayload(p.representativeAfter),
				s.principal,
				s.scopeKey,
				p.representativeId,
				p.representativeBefore.revision,
			),
		1,
		"MERGE_REPRESENTATIVE_UPDATE",
	);
	replaceAliases(db, s, p.representativeId, p.representativeAfter);
	insertEvent(db, s, p, p.representativeAfter.revision);
	return applied;
}

function checkSplitPlan(plan: SplitPlan, scope: ScopeRef): boolean {
	if (plan.kind !== "split" || !sameScope(plan.scope as ScopeRef, scope))
		return false;
	if (!checkId(plan.operationId).ok || !checkId(plan.mergeOperationId).ok)
		return false;
	if (!checkId(plan.representativeId).ok) return false;
	const snapshots = [plan.representative, ...plan.restored];
	return snapshots.every(
		(m) =>
			validRevision(m.revision) &&
			validRevision(m.nextRevision) &&
			parseEntity(
				{
					id: m.id,
					scope,
					revision: m.revision,
					displayName: m.displayName,
					aliases: m.aliases,
					externalRefs: m.externalRefs,
				},
				"plan",
			).ok,
	);
}

export function applySplitPlan(
	db: WorldDb,
	scope: ScopeRef,
	plan: SplitPlan,
): EntityWriteResult {
	requireTransaction(db);
	const s = scopeOf(scope);
	if (!s) return rejected("INVALID_INPUT");
	if (typeof plan !== "object" || plan === null || !checkSplitPlan(plan, s))
		return rejected("INVALID_INPUT");
	const merged = db
		.query(
			"SELECT 1 AS present FROM world_identity_event WHERE principal = ? AND scope_key = ? AND event_id = ? AND kind = 'merge'",
		)
		.get(s.principal, s.scopeKey, plan.mergeOperationId);
	if (merged == null) return rejected("MERGE_HISTORY_NOT_FOUND");
	if (eventExists(db, s, plan.operationId)) return rejected("OPERATION_EXISTS");
	const splits = db
		.query(
			"SELECT payload_json FROM world_identity_event WHERE principal = ? AND scope_key = ? AND kind = 'split'",
		)
		.all(s.principal, s.scopeKey) as { payload_json: string }[];
	if (
		splits.some(
			(r) =>
				(JSON.parse(r.payload_json) as SplitPlan).mergeOperationId ===
				plan.mergeOperationId,
		)
	)
		return rejected("ALREADY_SPLIT");
	const rep = selectEntity(db, s, plan.representativeId);
	if (!rep) return rejected("ENTITY_NOT_FOUND");
	const restored = plan.restored.map((m) => ({
		m,
		row: selectEntity(db, s, m.id),
	}));
	if (restored.some((x) => !x.row)) return rejected("ENTITY_NOT_FOUND");
	if (
		restored.some(
			(x) =>
				x.row!.status !== "merged" ||
				x.row!.merged_into !== plan.representativeId,
		)
	)
		return rejected("MERGE_CYCLE");
	if (
		rep.revision !== plan.representative.revision ||
		restored.some((x) => x.row!.revision !== x.m.revision)
	)
		return rejected("REVISION_CONFLICT");
	for (const { m } of restored) {
		expectChanges(
			db
				.query(
					"UPDATE world_entity SET revision = ?, status = 'active', merged_into = NULL, payload_json = ? WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ? AND status = 'merged'",
				)
				.run(
					m.nextRevision,
					memberPayload(m),
					s.principal,
					s.scopeKey,
					m.id,
					m.revision,
				),
			1,
			"SPLIT_MEMBER_UPDATE",
		);
		replaceAliases(db, s, m.id, m);
	}
	expectChanges(
		db
			.query(
				"UPDATE world_entity SET revision = ?, payload_json = ? WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ? AND status = 'active'",
			)
			.run(
				plan.representative.nextRevision,
				memberPayload(plan.representative),
				s.principal,
				s.scopeKey,
				plan.representativeId,
				plan.representative.revision,
			),
		1,
		"SPLIT_REPRESENTATIVE_UPDATE",
	);
	replaceAliases(db, s, plan.representativeId, plan.representative);
	insertEvent(db, s, plan, plan.representative.nextRevision);
	return applied;
}

const maxDeleteIds = 500;

interface SnapshotLike {
	displayName?: unknown;
	aliases?: unknown;
	externalRefs?: unknown;
}
const textsOf = (snapshot: SnapshotLike): string[] => [
	...(typeof snapshot.displayName === "string"
		? [normalizeAlias(snapshot.displayName)]
		: []),
	...(Array.isArray(snapshot.aliases)
		? snapshot.aliases
				.filter((a): a is string => typeof a === "string")
				.map(normalizeAlias)
		: []),
];
const refKey = (ref: ExternalRef) => JSON.stringify([ref.system, ref.id]);
const refsOf = (snapshot: SnapshotLike): string[] =>
	Array.isArray(snapshot.externalRefs)
		? (snapshot.externalRefs as ExternalRef[]).map(refKey)
		: [];
/** Calls `visit` for every object in the JSON value that has an `id` string. */
function walkSnapshots(
	value: unknown,
	visit: (snapshot: SnapshotLike & { id: string }) => void,
): void {
	if (Array.isArray(value)) {
		for (const item of value) walkSnapshots(item, visit);
		return;
	}
	if (typeof value !== "object" || value === null) return;
	const record = value as Record<string, unknown>;
	if (typeof record["id"] === "string" && "displayName" in record)
		visit(record as unknown as SnapshotLike & { id: string });
	for (const child of Object.values(record)) walkSnapshots(child, visit);
}
/** Removes alias/externalRef entries listed in `texts`/`refs` from every aliases/externalRefs array. */
function scrubJson(
	value: unknown,
	texts: ReadonlySet<string>,
	refs: ReadonlySet<string>,
): unknown {
	if (Array.isArray(value)) return value.map((v) => scrubJson(v, texts, refs));
	if (typeof value !== "object" || value === null) return value;
	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (key === "aliases" && Array.isArray(child))
			out[key] = child.filter(
				(a) => !(typeof a === "string" && texts.has(normalizeAlias(a))),
			);
		else if (key === "externalRefs" && Array.isArray(child))
			out[key] = child.filter((r) => !refs.has(refKey(r as ExternalRef)));
		else out[key] = scrubJson(child, texts, refs);
	}
	return out;
}

/**
 * Prepares the removal of forgotten members' text from the representatives
 * (and their representatives) that absorbed it, and from surviving events.
 * Reads happen now; the returned function performs the DML.
 */
function scrubForgottenText(
	db: WorldDb,
	s: ScopeRef,
	idSet: ReadonlySet<string>,
	forgotten: readonly EntityRow[],
	events: readonly { event_id: string; payload_json: string }[],
	doomed: readonly { event_id: string; payload_json: string }[],
): () => void {
	const forgottenTexts = new Set<string>();
	const forgottenRefs = new Set<string>();
	const take = (snapshot: SnapshotLike) => {
		for (const t of textsOf(snapshot)) forgottenTexts.add(t);
		for (const r of refsOf(snapshot)) forgottenRefs.add(r);
	};
	for (const row of forgotten) take(JSON.parse(row.payload_json));
	for (const e of doomed)
		walkSnapshots(JSON.parse(e.payload_json), (snap) => {
			if (idSet.has(snap.id)) take(snap);
		});
	// Ancestors: the chain of representatives above each forgotten merged member.
	const ancestors: string[] = [];
	for (const row of forgotten) {
		let next = row.merged_into;
		const seen = new Set<string>();
		while (next !== null && !idSet.has(next) && !seen.has(next)) {
			seen.add(next);
			if (!ancestors.includes(next)) ancestors.push(next);
			next = selectEntity(db, s, next)?.merged_into ?? null;
		}
	}
	const parsedEvents = events.map((e) => ({
		...e,
		doomed: doomed.some((d) => d.event_id === e.event_id),
		json: JSON.parse(e.payload_json) as {
			representativeId: string;
			representativeBefore?: SnapshotLike;
			members?: (SnapshotLike & { id: string })[];
		},
	}));
	// Original (pre-absorption) text of every entity, from the merge history:
	// the first time it acted as representative its "before" snapshot is its own
	// text; otherwise its first member snapshot. Intermediate snapshots are never
	// used for keeping text, because they already contain absorbed members.
	const repOriginal = new Map<string, SnapshotLike>();
	const memberOriginal = new Map<string, SnapshotLike>();
	for (const e of parsedEvents) {
		if (!e.json.members) continue; // split events restore, they do not absorb
		if (
			e.json.representativeBefore &&
			!repOriginal.has(e.json.representativeId)
		)
			repOriginal.set(e.json.representativeId, e.json.representativeBefore);
		for (const m of e.json.members)
			if (!memberOriginal.has(m.id)) memberOriginal.set(m.id, m);
	}
	const originalOf = (id: string): SnapshotLike | undefined => {
		const known = repOriginal.get(id) ?? memberOriginal.get(id);
		if (known) return known;
		const row = selectEntity(db, s, id);
		return row ? (JSON.parse(row.payload_json) as SnapshotLike) : undefined;
	};
	/** Entities (not forgotten) that currently sit below `root` in the merge tree. */
	const survivingSubtree = (root: string): string[] => {
		const out: string[] = [];
		const stack = [root];
		const visited = new Set<string>();
		while (stack.length > 0) {
			const id = stack.pop()!;
			if (visited.has(id)) continue;
			visited.add(id);
			const children = db
				.query(
					"SELECT id FROM world_entity WHERE principal = ? AND scope_key = ? AND merged_into = ? LIMIT 10000",
				)
				.all(s.principal, s.scopeKey, id) as { id: string }[];
			for (const child of children)
				if (!idSet.has(child.id)) {
					out.push(child.id);
					stack.push(child.id);
				}
		}
		return out;
	};
	const updates: {
		id: string;
		revision: number;
		payload: SnapshotLike & { displayName: string };
	}[] = [];
	const removeTexts = new Set<string>();
	const removeRefs = new Set<string>();
	for (const ancestor of ancestors) {
		const row = selectEntity(db, s, ancestor);
		if (!row) continue;
		const keepTexts = new Set<string>();
		const keepRefs = new Set<string>();
		const keep = (snapshot: SnapshotLike) => {
			for (const t of textsOf(snapshot)) keepTexts.add(t);
			for (const r of refsOf(snapshot)) keepRefs.add(r);
		};
		for (const id of [ancestor, ...survivingSubtree(ancestor)]) {
			const original = originalOf(id);
			if (original) keep(original);
		}
		const payload = JSON.parse(row.payload_json) as SnapshotLike & {
			displayName: string;
		};
		keep({ displayName: payload.displayName });
		const dropTexts = new Set(
			[...forgottenTexts].filter((t) => !keepTexts.has(t)),
		);
		const dropRefs = new Set(
			[...forgottenRefs].filter((r) => !keepRefs.has(r)),
		);
		const next = scrubJson(payload, dropTexts, dropRefs) as typeof payload;
		if (JSON.stringify(next) === JSON.stringify(payload)) continue;
		for (const t of dropTexts) removeTexts.add(t);
		for (const r of dropRefs) removeRefs.add(r);
		updates.push({ id: ancestor, revision: row.revision, payload: next });
	}
	return () => {
		for (const update of updates) {
			expectChanges(
				db
					.query(
						"UPDATE world_entity SET revision = revision + 1, payload_json = ? WHERE principal = ? AND scope_key = ? AND id = ? AND revision = ?",
					)
					.run(
						json(update.payload),
						s.principal,
						s.scopeKey,
						update.id,
						update.revision,
					),
				1,
				"SCRUB_REPRESENTATIVE",
			);
			replaceAliases(db, s, update.id, {
				displayName: update.payload.displayName,
				aliases: (update.payload.aliases as string[] | undefined) ?? [],
			});
		}
		if (removeTexts.size === 0 && removeRefs.size === 0) return;
		for (const e of parsedEvents) {
			if (e.doomed) continue;
			const next = scrubJson(e.json, removeTexts, removeRefs);
			if (JSON.stringify(next) === JSON.stringify(e.json)) continue;
			expectChanges(
				db
					.query(
						"UPDATE world_identity_event SET payload_json = ? WHERE principal = ? AND scope_key = ? AND event_id = ?",
					)
					.run(json(next), s.principal, s.scopeKey, e.event_id),
				1,
				"SCRUB_EVENT",
			);
		}
	};
}

/** Active-or-merged members merged into the given representatives (bounded). */
export function listMergedMembers(
	db: WorldDb,
	scope: ScopeRef,
	representativeId: string,
	limit: number,
): { readonly ids: readonly string[]; readonly truncated: boolean } {
	const s = scopeOrThrow(scope);
	if (!Number.isSafeInteger(limit) || limit < 1)
		throw new WorldIntegrityError("INVALID_LIMIT");
	const rows = db
		.query(
			"SELECT id FROM world_entity WHERE principal = ? AND scope_key = ? AND merged_into = ? ORDER BY id LIMIT ?",
		)
		.all(s.principal, s.scopeKey, representativeId, limit + 1) as {
		id: string;
	}[];
	return {
		ids: rows.slice(0, limit).map((r) => r.id),
		truncated: rows.length > limit,
	};
}
/**
 * Forget support: removes entities, their alias rows and every identity event
 * that involved any of them (events carry other members' text). Refuses to
 * strand a merged entity whose representative would disappear.
 */
export function deleteEntities(
	db: WorldDb,
	scope: ScopeRef,
	ids: readonly string[],
):
	| DeleteEntitiesResult
	| { readonly status: "rejected"; readonly reasonCode: EntityRejectCode } {
	requireTransaction(db);
	const s = scopeOf(scope);
	if (!s)
		return rejected("INVALID_INPUT") as {
			status: "rejected";
			reasonCode: EntityRejectCode;
		};
	const unique = [...new Set(ids)];
	if (unique.length > maxDeleteIds || !unique.every((id) => checkId(id).ok))
		return rejected("INVALID_INPUT") as {
			status: "rejected";
			reasonCode: EntityRejectCode;
		};
	if (unique.length === 0)
		return { status: "applied", deletedEntities: 0, deletedEvents: 0 };
	const bound: SqlValue[] = [s.principal, s.scopeKey, ...unique];
	const inList = placeholders(unique.length);
	const stranded = db
		.query(
			`SELECT 1 AS present FROM world_entity WHERE principal = ? AND scope_key = ? AND merged_into IN (${inList}) AND id NOT IN (${inList}) LIMIT 1`,
		)
		.get(s.principal, s.scopeKey, ...unique, ...unique);
	if (stranded != null)
		return rejected("ENTITY_REFERENCED") as {
			status: "rejected";
			reasonCode: EntityRejectCode;
		};
	const existingRows = db
		.query(
			`SELECT id, revision, status, merged_into, payload_json FROM world_entity WHERE principal = ? AND scope_key = ? AND id IN (${inList})`,
		)
		.all(...bound) as EntityRow[];
	const existing = existingRows;
	const idSet = new Set(unique);
	const events = db
		.query(
			"SELECT event_id, payload_json FROM world_identity_event WHERE principal = ? AND scope_key = ? ORDER BY rowid",
		)
		.all(s.principal, s.scopeKey) as {
		event_id: string;
		payload_json: string;
	}[];
	const involves = (p: {
		representativeId: string;
		members?: { id: string }[];
		restored?: { id: string }[];
	}) =>
		[
			p.representativeId,
			...(p.members ?? []).map((m) => m.id),
			...(p.restored ?? []).map((m) => m.id),
		].some((id) => idSet.has(id));
	const doomed = events.filter((e) =>
		involves(JSON.parse(e.payload_json) as Parameters<typeof involves>[0]),
	);
	const scrub = scrubForgottenText(db, s, idSet, existingRows, events, doomed);
	// Representatives keep the union of their members' text: take the
	// forgotten member's text out of them (and out of surviving events) BEFORE
	// the member's own rows and events go away.
	scrub();
	for (const e of doomed)
		expectChanges(
			db
				.query(
					"DELETE FROM world_identity_event WHERE principal = ? AND scope_key = ? AND event_id = ?",
				)
				.run(s.principal, s.scopeKey, e.event_id),
			1,
			"EVENT_DELETE",
		);
	db.query(
		`DELETE FROM world_alias WHERE principal = ? AND scope_key = ? AND entity_id IN (${inList})`,
	).run(...bound);
	expectChanges(
		db
			.query(
				`DELETE FROM world_entity WHERE principal = ? AND scope_key = ? AND id IN (${inList})`,
			)
			.run(...bound),
		existing.length,
		"ENTITY_DELETE",
	);
	return {
		status: "applied",
		deletedEntities: existing.length,
		deletedEvents: doomed.length,
	};
}
