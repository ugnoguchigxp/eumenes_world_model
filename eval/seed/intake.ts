import {
	canonicalBytes,
	type AccessContext,
} from "../../src/contracts/index.ts";
import {
	feedKeyOf,
	getCheckpoint,
	listInboxByFeed,
} from "../../src/domains/extraction/sqlite.ts";
import {
	applyWorldOperation,
	readWorldSnapshot,
	type HostChecks,
	type WorldDb,
} from "../../src/sqlite.ts";
import {
	hash,
	seedScope,
	type SeedCorpus,
	type SeedDocument,
} from "./corpus.ts";

const restoreEpoch = "seed-restore-v1";
const access: AccessContext = {
	principal: seedScope.principal,
	scopeKeys: [seedScope.scopeKey],
	purpose: "world",
	policyRevision: "seed-policy-v1",
};
const hostChecks: HostChecks = {
	sourceSnapshot: { states: [] },
	forgetEpoch: "seed-forget-v1",
	restoreEpoch,
	policyRevision: access.policyRevision,
};

function feed(corpus: SeedCorpus) {
	return {
		scopeKeys: [seedScope.scopeKey],
		kind: corpus.seedId,
		cursorRestoreEpoch: restoreEpoch,
	};
}

function payload(corpus: SeedCorpus, document: SeedDocument) {
	// The immutable, hash-checked corpus owns full text, including >64KiB rows.
	return {
		seedId: corpus.seedId,
		manifestDigest: corpus.manifestDigest,
		recordId: document.recordId,
		collection: document.collection,
		source: document.source,
	};
}

/** Caller owns a single transaction; any refusal throws to roll it back. */
export function receiveSeed(db: WorldDb, corpus: SeedCorpus) {
	let applied = 0;
	let noOp = 0;
	for (const [index, document] of corpus.documents.entries()) {
		const result = applyWorldOperation(
			db,
			{
				contractVersion: 1,
				access,
				scope: seedScope,
				operationKey: `${corpus.seedId}:${document.source.id}`,
				clock: 0,
				hostChecks,
				operation: {
					kind: "inbox.receive",
					feed: feed(corpus),
					event: {
						eventId: document.source.id,
						seq: index + 1,
						payload: payload(corpus, document),
					},
					receivedCursor: String(index + 1),
				},
			},
			{ hasher: hash },
		);
		if ("reasonCode" in result)
			throw new Error(`seed_receive_failed:${result.reasonCode}`);
		if (result.status === "applied") applied++;
		else noOp++;
	}
	return { applied, noOp };
}

/** Checks persisted rows, ordered pagination, cursors and the public view. */
export function inspectSeed(db: WorldDb, corpus: SeedCorpus) {
	const key = feedKeyOf(seedScope.principal, feed(corpus), restoreEpoch);
	if (key === undefined) throw new Error("seed_invalid_feed");
	let afterSeq = 0;
	let received = 0;
	let pages = 0;
	while (true) {
		const page = listInboxByFeed(db, seedScope, key, { afterSeq, limit: 200 });
		pages++;
		for (const item of page.items) {
			const document = corpus.documents[received];
			if (!document) throw new Error("seed_unexpected_event");
			const expected = canonicalBytes(payload(corpus, document));
			if (
				item.seq !== received + 1 ||
				item.eventId !== document.source.id ||
				item.status !== "received" ||
				!expected.ok ||
				item.payloadJson !== new TextDecoder().decode(expected.value)
			)
				throw new Error("seed_persisted_event_mismatch");
			afterSeq = item.seq;
			received++;
		}
		if (!page.truncated) break;
	}
	const checkpoint = getCheckpoint(db, seedScope, key);
	if (
		received !== corpus.documents.length ||
		checkpoint?.receivedCursor !== String(received) ||
		checkpoint.appliedCursor !== null
	)
		throw new Error("seed_checkpoint_mismatch");
	const world = readWorldSnapshot(db, {
		contractVersion: 1,
		access,
		scope: seedScope,
		asOf: 0,
		hostChecks,
	});
	if (world.status !== "ready" || world.snapshot.assertions.length !== 0)
		throw new Error("seed_source_became_assertion");
	return { received, pages, checkpoint, activeAssertions: 0 };
}
