import {
	asRecord,
	checkContractVersion,
	checkEpochMs,
	checkId,
	checkScope,
	firstUnknownKey,
	sameScope,
	type ScopeRef,
	type SourceState,
} from "../../contracts/index.ts";
import {
	sourceIdentityKey,
	type Assertion,
} from "../../domains/assertions/index.ts";
import { getAssertion, getHead } from "../../domains/assertions/sqlite.ts";
import { getTombstone, isGateOpen } from "../../domains/lifecycle/sqlite.ts";
import type { ProjectionSnapshot } from "../../domains/projection/index.ts";
import {
	getEpoch,
	readCurrent,
	readEdgesFrom,
	readEdgesTo,
	type CurrentRow,
} from "../../domains/projection/sqlite.ts";
import {
	requireTransaction,
	WorldIntegrityError,
	type WorldDb,
} from "../../infrastructure/sqlite/db.ts";
import {
	blockedResult,
	checkAccess,
	checkHostChecks,
	rejectedResult,
} from "./checks.ts";
import { WORLD_INTERPRETATION_VERSION, type HostChecks } from "./types.ts";

/** C5 retrieval defaults. The effective budget is min(default, host budget). */
export const defaultCandidateBudget = 500;
export const defaultExpansionBudget = 500;
export const maxFocusSubjects = 100;
export const maxFocusDepth = 4;
export const maxHistoryRevisions = 100;

export type CoverageReason =
	| "CANDIDATE_BUDGET"
	| "EXPANSION_BUDGET"
	| "DEPTH_LIMIT";
/**
 * What the bounded read did. `partial` is not "nothing else exists": it means
 * a budget stopped retrieval, so absence must not be read as no effect.
 */
export interface SnapshotCoverage {
	readonly partial: boolean;
	readonly reasons: readonly CoverageReason[];
	/** Rows the DB returned, sentinel rows included (not scanned rows). */
	readonly fetchedRows: number;
	readonly expandedRows: number;
}

export type WorldSnapshotResult =
	| {
			readonly status: "ready";
			readonly snapshot: ProjectionSnapshot;
			readonly coverage: SnapshotCoverage;
	  }
	| { readonly status: "rejected" | "blocked"; readonly reasonCode: string };

/**
 * Counts every row the DB hands back against one total budget. A query is
 * given `remaining - 1` as its limit so that the limit+1 sentinel row is still
 * inside the budget; with `remaining <= 1` no query can be issued.
 */
class Budget {
	fetched = 0;
	constructor(readonly total: number) {}
	get remaining(): number {
		return this.total - this.fetched;
	}
	/** Row limit for the next bounded query, or 0 when nothing can be fetched. */
	nextLimit(): number {
		return Math.max(0, this.remaining - 1);
	}
	/** Records rows returned including the sentinel (rows + 1 when truncated). */
	spend(rows: number, truncated: boolean): void {
		this.fetched += rows + (truncated ? 1 : 0);
	}
}

interface ReadRequest {
	readonly scope: ScopeRef;
	readonly asOf: number;
	readonly host: HostChecks;
	readonly focus: readonly string[] | undefined;
	readonly depth: number;
	readonly candidates: number;
	readonly expansions: number;
}

function budgetNumber(value: unknown, fallback: number): number | undefined {
	if (value === undefined) return fallback;
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < 2 ||
		value > fallback
	)
		return undefined;
	return value;
}

function parseRequest(raw: unknown): ReadRequest | { readonly reason: string } {
	const request = asRecord(raw);
	if (
		!request ||
		firstUnknownKey(request, [
			"contractVersion",
			"access",
			"scope",
			"asOf",
			"hostChecks",
			"focus",
			"budget",
		]) !== undefined
	)
		return { reason: "INVALID_INPUT" };
	const version = checkContractVersion(request["contractVersion"]);
	if (!version.ok) return { reason: version.code };
	const scope = checkScope(request["scope"]);
	const asOf = checkEpochMs(request["asOf"], "asOf");
	const host = checkHostChecks(request["hostChecks"]);
	if (!scope.ok || !asOf.ok || !host.ok) return { reason: "INVALID_INPUT" };
	let focus: string[] | undefined;
	let depth = 1;
	if (request["focus"] !== undefined) {
		const object = asRecord(request["focus"]);
		if (
			!object ||
			firstUnknownKey(object, ["subjectIds", "depth"]) !== undefined ||
			!Array.isArray(object["subjectIds"])
		)
			return { reason: "INVALID_INPUT" };
		const ids = object["subjectIds"] as unknown[];
		if (ids.length > maxFocusSubjects) return { reason: "LIMIT_EXCEEDED" };
		focus = [];
		for (const id of ids) {
			const checked = checkId(id, "focus.subjectIds");
			if (!checked.ok || focus.includes(checked.value))
				return { reason: "INVALID_INPUT" };
			focus.push(checked.value);
		}
		if (object["depth"] !== undefined) {
			const d = object["depth"];
			if (typeof d !== "number" || !Number.isSafeInteger(d) || d < 0)
				return { reason: "INVALID_INPUT" };
			if (d > maxFocusDepth) return { reason: "LIMIT_EXCEEDED" };
			depth = d;
		}
	}
	let candidates = defaultCandidateBudget;
	let expansions = defaultExpansionBudget;
	if (request["budget"] !== undefined) {
		const object = asRecord(request["budget"]);
		if (
			!object ||
			firstUnknownKey(object, ["candidates", "expansions"]) !== undefined
		)
			return { reason: "INVALID_INPUT" };
		const c = budgetNumber(object["candidates"], defaultCandidateBudget);
		const e = budgetNumber(object["expansions"], defaultExpansionBudget);
		if (c === undefined || e === undefined) return { reason: "INVALID_INPUT" };
		candidates = c;
		expansions = e;
	}
	const access = checkAccess(
		request["access"],
		scope.value,
		host.value.policyRevision,
	);
	// Authorization is decided before any ledger or projection read.
	if (access !== "ok") return { reason: access };
	return {
		scope: scope.value,
		asOf: asOf.value,
		host: host.value,
		focus,
		depth,
		candidates,
		expansions,
	};
}

/**
 * One consistent bounded read of a single permitted Scope. It must run inside
 * the host's transaction so every SELECT sees one snapshot (readonly reader or
 * writer). Rows come from the persisted projection, bounded by the focus
 * subjects (when given) and the candidate / expansion budgets; the whole
 * ledger is never loaded. A budget stop sets `coverage.partial`; when the
 * required rows themselves do not fit, `snapshot.complete` is false.
 */
export function readWorldSnapshot(
	db: WorldDb,
	rawRequest: unknown,
): WorldSnapshotResult {
	requireTransaction(db);
	const request = parseRequest(rawRequest);
	if ("reason" in request) {
		if (request.reason === "POLICY_CHANGED")
			return blockedResult("POLICY_CHANGED");
		return rejectedResult(request.reason);
	}
	return readScope(db, request);
}

function readScope(db: WorldDb, request: ReadRequest): WorldSnapshotResult {
	const { scope, host } = request;
	if (host.gate === "closed" || !isGateOpen(db, scope))
		return blockedResult("GATE_CLOSED");
	for (const id of request.focus ?? [])
		if (getTombstone(db, scope, { kind: "entity", id }) !== undefined)
			return blockedResult("TOMBSTONED");

	const epochBefore = getEpoch(db, scope)?.epoch ?? 0;
	const budget = new Budget(request.candidates);
	const reasons = new Set<CoverageReason>();
	const rows = new Map<string, CurrentRow>();
	let requiredComplete = true;
	let expanded = 0;

	const take = (found: readonly CurrentRow[]) => {
		for (const row of found)
			rows.set(JSON.stringify([row.assertionId, row.assertionRevision]), row);
	};
	// Fetches current rows for subjects, charged to the candidate budget.
	const fetchSubjects = (subjectIds: readonly string[] | undefined) => {
		const limit = budget.nextLimit();
		if (limit < 1) return false;
		const page = readCurrent(db, scope, {
			...(subjectIds === undefined ? {} : { subjectIds }),
			limit,
		});
		budget.spend(page.rows.length, page.truncated);
		take(page.rows);
		return !page.truncated;
	};

	const known = new Set(request.focus ?? []);
	if (request.focus === undefined) {
		if (!fetchSubjects(undefined)) {
			requiredComplete = false;
			reasons.add("CANDIDATE_BUDGET");
		}
	} else if (request.focus.length > 0) {
		// Subject lists are chunked to the repository's id bound.
		for (let i = 0; i < request.focus.length; i += 100)
			if (!fetchSubjects(request.focus.slice(i, i + 100))) {
				requiredComplete = false;
				reasons.add("CANDIDATE_BUDGET");
				break;
			}
		let frontier = [...request.focus];
		let exhausted = false;
		for (let hop = 0; hop < request.depth && frontier.length > 0; hop++) {
			const next = new Set<string>();
			for (const direction of [readEdgesFrom, readEdgesTo] as const) {
				const left = request.expansions - expanded;
				const limit = Math.max(0, left - 1);
				if (limit < 1) {
					reasons.add("EXPANSION_BUDGET");
					exhausted = true;
					break;
				}
				const page = direction(db, scope, frontier.slice(0, 500), limit);
				expanded += page.rows.length + (page.truncated ? 1 : 0);
				if (page.truncated) {
					reasons.add("EXPANSION_BUDGET");
					exhausted = true;
				}
				for (const edge of page.rows)
					for (const id of [edge.fromId, edge.toId])
						if (!known.has(id)) next.add(id);
				if (frontier.length > 500) reasons.add("EXPANSION_BUDGET");
			}
			const fresh = [...next].sort();
			for (const id of fresh) known.add(id);
			if (fresh.length > 0) {
				let allFit = true;
				for (let i = 0; i < fresh.length; i += 100)
					allFit = fetchSubjects(fresh.slice(i, i + 100)) && allFit;
				if (!allFit) reasons.add("CANDIDATE_BUDGET");
			}
			frontier = fresh;
			if (exhausted) break;
		}
		if (frontier.length > 0 && request.depth > 0 && !exhausted) {
			// Depth ended: is anything beyond it reachable from the frontier?
			// A real bounded read charged to the expansion budget; edges whose
			// ends are all known do not count as "further".
			for (const direction of [readEdgesFrom, readEdgesTo] as const) {
				const limit = Math.max(0, request.expansions - expanded - 1);
				if (limit < 1) {
					reasons.add("EXPANSION_BUDGET");
					break;
				}
				const page = direction(db, scope, frontier.slice(0, 500), limit);
				expanded += page.rows.length + (page.truncated ? 1 : 0);
				if (page.truncated) reasons.add("EXPANSION_BUDGET");
				if (
					page.rows.some(
						(edge) => !known.has(edge.fromId) || !known.has(edge.toId),
					)
				)
					reasons.add("DEPTH_LIMIT");
			}
		}
	}

	const ordered = [...rows.values()].sort(
		(a, b) =>
			(a.assertionId < b.assertionId
				? -1
				: a.assertionId > b.assertionId
					? 1
					: 0) || a.assertionRevision - b.assertionRevision,
	);
	const assertions: Assertion[] = [];
	for (const row of ordered) {
		const stored = getAssertion(
			db,
			scope,
			row.assertionId,
			row.assertionRevision,
		);
		// Projection and ledger are written in one transaction: a gap is corruption.
		if (!stored) throw new WorldIntegrityError("PROJECTION_LEDGER_MISMATCH");
		assertions.push(withoutTransitionMeta(stored));
	}
	// A returned assertion must not name a forgotten entity (subject, relation
	// object or entity-reference value), whatever the focus said.
	const named = new Set<string>();
	for (const assertion of assertions) {
		named.add(assertion.subjectId);
		const payload = assertion.payload;
		if (payload.kind === "relation") named.add(payload.objectId);
		else if (payload.value.kind === "entity") named.add(payload.value.entityId);
	}
	for (const id of named)
		if (getTombstone(db, scope, { kind: "entity", id }) !== undefined)
			return blockedResult("TOMBSTONED");

	const wanted = new Set<string>();
	for (const assertion of assertions)
		for (const ref of [
			...assertion.evidence.map((e) => e.source),
			...assertion.inputManifest,
		])
			wanted.add(sourceIdentityKey(ref));
	const sources: SourceState[] = request.host.sourceSnapshot.states.filter(
		(state) =>
			sameScope(
				{ principal: state.principal, scopeKey: state.scopeKey },
				scope,
			) && wanted.has(sourceIdentityKey(state)),
	);

	const epoch = getEpoch(db, scope)?.epoch ?? 0;
	// A mixed view (epoch moved between SELECTs) must never be returned.
	if (epoch !== epochBefore) throw new WorldIntegrityError("SNAPSHOT_MIXED");

	return {
		status: "ready",
		snapshot: {
			scope,
			asOf: request.asOf,
			worldEnabled: true,
			complete: requiredComplete,
			checks: {
				authorized: true,
				correctionsResolved: true,
				restoreVerified: true,
			},
			scopeEpoch: epoch,
			policyRevision: host.policyRevision,
			forgetEpoch: host.forgetEpoch,
			restoreEpoch: host.restoreEpoch,
			interpretationVersion: WORLD_INTERPRETATION_VERSION,
			assertions,
			sources,
		},
		coverage: {
			partial: reasons.size > 0,
			reasons: [...reasons].sort(),
			fetchedRows: budget.fetched,
			expandedRows: expanded,
		},
	};
}

/** The repository annotates adopted rows with `lastTransition`; the pure snapshot is strict. */
function withoutTransitionMeta(stored: Assertion): Assertion {
	const { lastTransition: _meta, ...rest } = stored as Assertion & {
		lastTransition?: unknown;
	};
	return rest as Assertion;
}

export type WorldHistoryResult =
	| {
			readonly status: "ready";
			readonly revisions: readonly Assertion[];
			readonly truncated: boolean;
	  }
	| { readonly status: "rejected" | "blocked"; readonly reasonCode: string };

/**
 * Revision history of one assertion. It repeats the current authorization,
 * gate and tombstone checks of a normal read: history is not a side door.
 */
export function readAssertionHistory(
	db: WorldDb,
	rawRequest: unknown,
): WorldHistoryResult {
	requireTransaction(db);
	const request = asRecord(rawRequest);
	if (
		!request ||
		firstUnknownKey(request, [
			"contractVersion",
			"access",
			"scope",
			"hostChecks",
			"assertionId",
			"limit",
		]) !== undefined
	)
		return rejectedResult("INVALID_INPUT");
	const version = checkContractVersion(request["contractVersion"]);
	if (!version.ok) return rejectedResult(version.code);
	const scope = checkScope(request["scope"]);
	const host = checkHostChecks(request["hostChecks"]);
	const id = checkId(request["assertionId"], "assertionId");
	if (!scope.ok || !host.ok || !id.ok) return rejectedResult("INVALID_INPUT");
	let limit = maxHistoryRevisions;
	if (request["limit"] !== undefined) {
		const l = request["limit"];
		if (typeof l !== "number" || !Number.isSafeInteger(l) || l < 1)
			return rejectedResult("INVALID_INPUT");
		limit = Math.min(l, maxHistoryRevisions);
	}
	const access = checkAccess(
		request["access"],
		scope.value,
		host.value.policyRevision,
	);
	if (access === "POLICY_CHANGED") return blockedResult(access);
	if (access !== "ok") return rejectedResult(access);
	if (host.value.gate === "closed" || !isGateOpen(db, scope.value))
		return blockedResult("GATE_CLOSED");
	if (
		getTombstone(db, scope.value, { kind: "assertion", id: id.value }) !==
		undefined
	)
		return blockedResult("TOMBSTONED");
	const head = getHead(db, scope.value, id.value);
	if (!head) return { status: "ready", revisions: [], truncated: false };
	// Newest first; one bound lookup per revision, at most `limit`.
	const revisions: Assertion[] = [];
	for (
		let revision = head.currentRevision;
		revision >= 1 && revisions.length < limit;
		revision--
	) {
		const stored = getAssertion(db, scope.value, id.value, revision);
		if (stored) revisions.push(stored);
	}
	return {
		status: "ready",
		revisions,
		truncated: head.currentRevision > limit && revisions.length === limit,
	};
}
