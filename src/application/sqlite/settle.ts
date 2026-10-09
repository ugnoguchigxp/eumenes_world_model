import {
	asRecord,
	checkId,
	type CanonicalHasher,
	type ScopeRef,
} from "../../contracts/index.ts";
import { sourceInputKey } from "../../domains/assertions/index.ts";
import {
	insertAssertion,
	insertEvidence,
	insertInputs,
	getHead,
} from "../../domains/assertions/sqlite.ts";
import {
	advanceCheckpoint,
	feedKeyOf,
	getInbox,
	getManifest,
	markInbox,
	markManifest,
	recordInbox,
	saveManifest,
} from "../../domains/extraction/sqlite.ts";
import {
	WorldIntegrityError,
	type WorldDb,
} from "../../infrastructure/sqlite/db.ts";
import { rejectedResult } from "./checks.ts";
import { precheckAssertionRows } from "./prechecks.ts";
import {
	applyHeadChanges,
	hasMissingContradictionTarget,
} from "./projection.ts";
import {
	maxSettleAssertions,
	type FeedSpec,
	type HostChecks,
	type WorldOperation,
} from "./types.ts";

type Rejection = { readonly status: "rejected"; readonly reasonCode: string };
type Op<K extends WorldOperation["kind"]> = Extract<
	WorldOperation,
	{ kind: K }
>;
interface Context {
	readonly hasher: CanonicalHasher;
	readonly clock: number;
	readonly hostChecks: HostChecks;
}

const isRejection = (value: unknown): value is Rejection =>
	asRecord(value)?.["status"] === "rejected";
/** After the first DML a rejection means an inconsistent ledger: roll back. */
function must(result: unknown, stage: string): void {
	if (isRejection(result))
		throw new WorldIntegrityError(`${stage}:${result.reasonCode}`);
}

function feedKeyFor(
	scope: ScopeRef,
	feed: FeedSpec,
	hostChecks: HostChecks,
): string | Rejection {
	const shape = asRecord(feed);
	if (
		!shape ||
		typeof feed.cursorRestoreEpoch !== "string" ||
		!Array.isArray(feed.scopeKeys) ||
		!feed.scopeKeys.includes(scope.scopeKey)
	)
		return rejectedResult("INVALID_INPUT");
	if (feed.cursorRestoreEpoch !== hostChecks.restoreEpoch)
		return rejectedResult("STALE_RESTORE_EPOCH");
	return (
		feedKeyOf(scope.principal, feed, hostChecks.restoreEpoch) ??
		rejectedResult("INVALID_INPUT")
	);
}

/** inbox.receive: reads only; null means the DML may begin. */
export function precheckReceive(
	op: Op<"inbox.receive">,
	scope: ScopeRef,
	hostChecks: HostChecks,
): Rejection | null {
	const key = feedKeyFor(scope, op.feed, hostChecks);
	if (typeof key !== "string") return key;
	if (
		!asRecord(op.event) ||
		!checkId(op.event.eventId).ok ||
		!Number.isSafeInteger(op.event.seq) ||
		!checkId(op.receivedCursor, "receivedCursor").ok
	)
		return rejectedResult("INVALID_INPUT");
	return null;
}

/**
 * Inbox row first, then the received cursor: a failure while saving the
 * cursor throws, so the intake cursor never advances without its event.
 */
export function applyReceive(
	db: WorldDb,
	op: Op<"inbox.receive">,
	scope: ScopeRef,
	hostChecks: HostChecks,
): Rejection | null {
	const key = feedKeyFor(scope, op.feed, hostChecks);
	if (typeof key !== "string") return key;
	const recorded = recordInbox(db, scope, {
		eventId: op.event.eventId,
		feedKey: key,
		seq: op.event.seq,
		payload: op.event.payload,
	});
	if (recorded.status === "rejected") return recorded;
	// A duplicate receipt must not move the opaque cursor (it could rewind it).
	if (recorded.status === "unchanged") return null;
	must(
		advanceCheckpoint(db, scope, {
			feed: op.feed,
			restoreEpoch: hostChecks.restoreEpoch,
			cursorRestoreEpoch: op.feed.cursorRestoreEpoch,
			receivedCursor: op.receivedCursor,
		}),
		"CHECKPOINT",
	);
	return null;
}

/** candidate.settle: every foreseeable refusal, decided before any DML. */
export function precheckSettle(
	db: WorldDb,
	op: Op<"candidate.settle">,
	scope: ScopeRef,
	hostChecks: HostChecks,
): Rejection | null {
	const key = feedKeyFor(scope, op.feed, hostChecks);
	if (typeof key !== "string") return key;
	if (
		!checkId(op.eventId).ok ||
		!["applied", "held", "rejected"].includes(op.disposition) ||
		!Array.isArray(op.assertions)
	)
		return rejectedResult("INVALID_INPUT");
	const event = getInbox(db, scope, op.eventId);
	if (!event || event.feedKey !== key) return rejectedResult("EVENT_NOT_FOUND");
	if (event.status === "applied" || event.status === "rejected")
		return rejectedResult("EVENT_ALREADY_SETTLED");

	if (op.disposition !== "applied") {
		if (op.assertions.length > 0 || op.manifest !== undefined)
			return rejectedResult("INVALID_INPUT");
		if (op.disposition === "rejected" && !checkId(op.appliedCursor).ok)
			return rejectedResult("INVALID_INPUT");
		if (op.disposition === "held" && op.appliedCursor !== undefined)
			return rejectedResult("INVALID_INPUT");
		return null;
	}
	const manifest = op.manifest;
	if (
		!manifest ||
		!asRecord(manifest) ||
		!checkId(manifest.manifestId).ok ||
		!Array.isArray(manifest.dependencies) ||
		!checkId(op.appliedCursor).ok
	)
		return rejectedResult("INVALID_INPUT");
	if (op.assertions.length > maxSettleAssertions)
		return rejectedResult("LIMIT_EXCEEDED");
	if (getManifest(db, scope, manifest.manifestId))
		return rejectedResult("MANIFEST_CONFLICT");
	const manifestKeys = new Set(manifest.dependencies.map(sourceInputKey));
	if (manifestKeys.size > 32) return rejectedResult("LIMIT_EXCEEDED");
	const ids = new Set<string>();
	for (const assertion of op.assertions) {
		if (
			!asRecord(assertion) ||
			typeof assertion.id !== "string" ||
			assertion.scope?.principal !== scope.principal ||
			assertion.scope?.scopeKey !== scope.scopeKey ||
			assertion.revision !== 1 ||
			assertion.lifecycle !== "candidate"
		)
			return rejectedResult("INVALID_INPUT");
		if (ids.has(assertion.id) || getHead(db, scope, assertion.id))
			return rejectedResult("REVISION_CONFLICT");
		ids.add(assertion.id);
		const rows = precheckAssertionRows(assertion, manifest.dependencies);
		if (rows) return rows;
		// Every input a candidate was derived from must be in the manifest.
		for (const ref of assertion.inputManifest)
			if (!manifestKeys.has(sourceInputKey(ref)))
				return rejectedResult("INPUT_NOT_IN_MANIFEST");
	}
	if (hasMissingContradictionTarget(db, scope, op.assertions))
		return rejectedResult("CONTRADICTION_TARGET_NOT_FOUND");
	return null;
}

/**
 * Order: ledger (assertions, evidence, inputs, manifest, inbox status) ->
 * projection -> epoch (inside the projection replace) -> checkpoint. The
 * caller records the operation receipt last.
 */
export function applySettle(
	db: WorldDb,
	op: Op<"candidate.settle">,
	scope: ScopeRef,
	context: Context,
): Rejection | null {
	if (op.disposition === "held") {
		must(markInbox(db, scope, op.eventId, "held"), "INBOX");
		return null;
	}
	if (op.disposition === "applied") {
		for (const [index, assertion] of op.assertions.entries()) {
			const first = insertAssertion(db, assertion);
			// Nothing was written before the first insert: it may still refuse.
			if (index === 0 && first.status === "rejected") return first;
			must(first, "ASSERTION");
			const ref = { id: assertion.id, revision: assertion.revision };
			must(insertEvidence(db, scope, ref, assertion.evidence), "EVIDENCE");
			// Everything the model was shown counts as an input of what it produced,
			// cited or not, so forgetting an uncited manifest source reaches it.
			must(
				insertInputs(db, scope, ref, [
					...assertion.inputManifest,
					...op.manifest!.dependencies,
				]),
				"INPUTS",
			);
		}
		const manifest = op.manifest!;
		const saved = saveManifest(db, scope, {
			...manifest,
			eventId: op.eventId,
		});
		if (op.assertions.length === 0 && saved.status === "rejected") return saved;
		must(saved, "MANIFEST");
		must(markManifest(db, scope, manifest.manifestId, "applied"), "MANIFEST");
	}
	must(
		markInbox(
			db,
			scope,
			op.eventId,
			op.disposition === "applied" ? "applied" : "rejected",
		),
		"INBOX",
	);
	if (op.assertions.length > 0)
		applyHeadChanges(
			db,
			scope,
			context,
			op.assertions.map((next) => ({ next })),
		);
	must(
		advanceCheckpoint(db, scope, {
			feed: op.feed,
			restoreEpoch: context.hostChecks.restoreEpoch,
			cursorRestoreEpoch: op.feed.cursorRestoreEpoch,
			appliedCursor: op.appliedCursor!,
		}),
		"CHECKPOINT",
	);
	return null;
}
