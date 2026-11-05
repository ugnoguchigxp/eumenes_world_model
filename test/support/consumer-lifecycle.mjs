/** Runs inside the clean installed consumer, using only package exports. */
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
	buildWorldSlice,
	toSliceReceipt,
	planAssertionTransition,
	sourceIdentityKey,
} from "eumenes-world-model";
import {
	migrations,
	applyWorldOperation,
	readWorldSnapshot,
	readAssertionHistory,
	validateWorldUsage,
} from "eumenes-world-model/sqlite";
const check = (ok, detail) => {
	if (!ok) throw new Error(JSON.stringify(detail));
};
const hasher = (bytes) => createHash("sha256").update(bytes).digest("hex");
const scope = { principal: "consumer", scopeKey: "demo" };
const access = {
	...scope,
	scopeKeys: [scope.scopeKey],
	purpose: "world",
	policyRevision: "p1",
};
delete access.scopeKey;
const clock = 1791500000000;
const source = {
	namespace: "demo",
	kind: "message",
	id: "s1",
	revision: "1",
	digest: hasher(Buffer.from("公開済み")),
};
const hostChecks = {
	sourceSnapshot: { states: [{ ...source, ...scope, status: "available" }] },
	forgetEpoch: "f1",
	restoreEpoch: "r1",
	policyRevision: "p1",
};
const envelope = { contractVersion: 1, scope, access, hostChecks };
const db = new Database("consumer.sqlite", { create: true });
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
if (process.argv[2] !== "reopen")
	for (const sql of migrations) db.transaction(() => db.exec(sql))();
const apply = (key, operation, over = {}) =>
	db.transaction(() =>
		applyWorldOperation(
			db,
			{ ...envelope, clock, operationKey: key, operation, ...over },
			{ hasher },
		),
	)();
const history = () =>
	db.transaction(() =>
		readAssertionHistory(db, { ...envelope, assertionId: "c1" }),
	)();
if (process.argv[2] === "reopen") {
	const result = history();
	check(
		result.status === "blocked" && result.reasonCode === "GATE_CLOSED",
		result,
	);
	check(
		db.query("SELECT count(*) AS n FROM world_assertion").get().n === 0,
		"forgotten body survived restart",
	);
	console.log(JSON.stringify({ restarted: true, gateClosed: true, bodies: 0 }));
} else {
	const entity = {
		id: "svc",
		displayName: "サービス",
		aliases: [],
		externalRefs: [],
	};
	check(
		apply("entity", { kind: "entity.register", entity }).status === "applied",
		"entity",
	);
	const assertion = {
		id: "c1",
		revision: 1,
		scope,
		subjectId: "svc",
		predicate: "available",
		payload: { kind: "value", value: { kind: "boolean", value: true } },
		evidence: [
			{
				evidenceId: "e1",
				kind: "user_statement",
				stance: "supports",
				source,
				rootEvidenceId: "root1",
			},
		],
		inputManifest: [source],
		origin: "user_report",
		recordedAt: clock,
		freshnessPolicy: { maxAgeMs: 86400000 },
		condition: { kind: "unspecified" },
		supersedes: [],
		contradicts: [],
		interpretationVersion: "consumer-1",
		lifecycle: "candidate",
		rootEvidenceIds: ["root1"],
	};
	const register = { kind: "assertion.register", assertion };
	check(apply("register", register).status === "applied", "register");
	check(apply("register", register).status === "no_op", "replay");
	const denied = apply("denied", register, {
		access: { ...access, principal: "foreign" },
	});
	check(denied.reasonCode === "SCOPE_NOT_PERMITTED", denied);
	const planned = planAssertionTransition({
		contractVersion: 1,
		scope,
		current: {
			id: "c1",
			revision: 1,
			scope,
			lifecycle: "candidate",
			origin: "user_report",
		},
		expectedRevision: 1,
		request: {
			action: "adopt",
			adoption: { kind: "explicit", operationId: "adopt" },
			subjectConfirmedByHost: true,
		},
		registeredAdoptionRules: [],
	});
	check(planned.ok && planned.value.status === "planned", planned);
	check(
		apply("adopt", { kind: "assertion.transition", plan: planned.value.plan })
			.status === "applied",
		"adopt",
	);
	const read = db.transaction(() =>
		readWorldSnapshot(db, { ...envelope, asOf: clock }),
	)();
	check(read.status === "ready", read);
	const slice = buildWorldSlice(
		{ contractVersion: 1, snapshot: read.snapshot, request: {} },
		hasher,
	);
	check(slice.ok && slice.value.units.length === 1, slice);
	const receipt = toSliceReceipt(slice.value);
	const usage = () =>
		db.transaction(() => validateWorldUsage(db, receipt, envelope))();
	check(usage().status === "valid", usage());
	const before = JSON.stringify(history());
	try {
		db.transaction(() => {
			applyWorldOperation(
				db,
				{
					...envelope,
					clock,
					operationKey: "rolled-back",
					operation: {
						kind: "entity.register",
						entity: { ...entity, id: "rolled-back" },
					},
				},
				{ hasher },
			);
			throw new Error("simulated host failure");
		})();
	} catch (e) {
		check(e.message === "simulated host failure", e.message);
	}
	check(
		JSON.stringify(history()) === before,
		"host rollback changed assertion",
	);
	check(
		db
			.query("SELECT count(*) AS n FROM world_entity WHERE id='rolled-back'")
			.get().n === 0,
		"host rollback leaked entity",
	);
	const forgotten = apply("forget", {
		kind: "forget.chunk",
		forgetId: "fg1",
		reasonCode: "FORGET_REQUESTED",
		roots: [{ kind: "source", id: sourceIdentityKey(source), revision: 1 }],
	});
	check(forgotten.status === "applied", forgotten);
	check(usage().status !== "valid", "old receipt accepted after forget");
	check(
		apply("register", register).status !== "no_op",
		"forgotten replay accepted",
	);
	check(
		db.query("SELECT count(*) AS n FROM world_assertion").get().n === 0,
		"body retained",
	);
	console.log(
		JSON.stringify({
			adopted: true,
			slice: true,
			rollback: true,
			replay: true,
			forgotten: true,
		}),
	);
}
db.close();
