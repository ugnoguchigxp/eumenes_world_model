/** Structural IO validation. Domain rules and authority stay at their owners. */
import {
	asRecord,
	checkId,
	checkRevision,
	checkScope,
	firstUnknownKey,
} from "../../contracts/index.ts";
import {
	checkAssertionRefList,
	checkTransitionRequest,
	checkSourceRef,
	lifecycles,
	transitionActions,
	type TransitionPlan,
	type TransitionRequest,
} from "../../domains/assertions/index.ts";
import type { WorldOperation } from "./types.ts";

const keys: Record<WorldOperation["kind"], readonly string[]> = {
	"entity.register": ["entity"],
	"entity.merge": ["plan"],
	"entity.split": ["plan"],
	"assertion.register": ["assertion"],
	"assertion.transition": ["plan", "replacement?"],
	"prediction.register": ["input"],
	"outcome.register": ["input"],
	"inbox.receive": ["feed", "event", "receivedCursor"],
	"candidate.settle": [
		"feed",
		"eventId",
		"disposition",
		"manifest?",
		"assertions",
		"appliedCursor?",
	],
	invalidate: ["reasonCode", "targets", "sourceKeys?"],
	"forget.chunk": ["forgetId", "reasonCode", "roots"],
	"forget.reopen": ["forgetId", "externalDeletionConfirmed"],
	"restore.begin": [],
	"restore.register": ["registrations"],
	"restore.reconcile": ["journal"],
	"restore.finish": [],
	rebuild: [],
};
function object(value: unknown, fields: readonly string[]) {
	const r = asRecord(value);
	if (
		!r ||
		firstUnknownKey(
			r,
			fields.map((f) => f.replace(/\?$/, "")),
		) !== undefined ||
		fields.some((f) => !f.endsWith("?") && !Object.hasOwn(r, f))
	)
		return undefined;
	return r;
}
const records = (v: unknown) =>
	Array.isArray(v) && v.every((x) => asRecord(x) !== undefined);
// Detailed domain diagnostics (duplicates, conflicting versions) remain in
// precheckAssertionRows; this guard only makes traversing the rows safe.
function assertionRows(value: unknown): boolean {
	const a = asRecord(value);
	return (
		!!a &&
		records(a["evidence"]) &&
		Array.isArray(a["inputManifest"]) &&
		a["inputManifest"].every((s) => checkSourceRef(s).ok)
	);
}
function transition(value: unknown): boolean {
	const p = object(value, [
		"action",
		"id",
		"scope",
		"from",
		"to",
		"expectedRevision",
		"nextRevision",
		"nextLifecycle",
		"stopsUseOf",
		"supersedes",
		"contradicts",
		"adoption?",
		"resolution?",
		"reasonSource?",
		"reasonCode?",
	]);
	if (
		!p ||
		!transitionActions.some((action) => action === p["action"]) ||
		!checkId(p["id"]).ok ||
		!checkScope(p["scope"]).ok ||
		!checkRevision(p["expectedRevision"]).ok ||
		!checkRevision(p["nextRevision"]).ok
	)
		return false;
	if (
		!["from", "to", "nextLifecycle"].every((k) =>
			lifecycles.some((lifecycle) => lifecycle === p[k]),
		) ||
		!["stopsUseOf", "supersedes", "contradicts"].every(
			(k) => checkAssertionRefList(p[k], k).ok,
		)
	)
		return false;
	if (
		p["reasonSource"] !== undefined &&
		!checkSourceRef(p["reasonSource"], "reasonSource").ok
	)
		return false;
	if (p["reasonCode"] !== undefined && !checkId(p["reasonCode"]).ok)
		return false;
	if (p["adoption"] !== undefined) {
		const a = asRecord(p["adoption"]);
		if (
			!a ||
			!(a["kind"] === "explicit"
				? object(a, ["kind", "operationId"]) && checkId(a["operationId"]).ok
				: a["kind"] === "rule" &&
					object(a, ["kind", "ruleId"]) &&
					checkId(a["ruleId"]).ok)
		)
			return false;
	}
	if (p["resolution"] !== undefined) {
		const a = object(p["resolution"], ["id", "revision"]);
		if (!a || !checkId(a["id"]).ok || !checkRevision(a["revision"]).ok)
			return false;
	}
	return transitionRequestOf(p as unknown as TransitionPlan) !== undefined;
}

/** Reconstruct syntax only; host authorization/registry checks remain host facts. */
export function transitionRequestOf(
	p: TransitionPlan,
): TransitionRequest | undefined {
	let request: unknown;
	switch (p["action"]) {
		case "adopt":
			request = {
				action: "adopt",
				adoption: p["adoption"],
				subjectConfirmedByHost: true,
			};
			break;
		case "dispute":
			request = { action: "dispute", contradicts: p["contradicts"] };
			break;
		case "resolve":
			request = {
				action: "resolve",
				resolution: p["resolution"],
				reasonCode: p["reasonCode"],
			};
			break;
		case "supersede":
			request = { action: "supersede", replacementRevision: p["nextRevision"] };
			break;
		case "retract":
			request = { action: "retract", reasonSource: p["reasonSource"] };
			break;
		case "invalidate":
			request = { action: "invalidate", reasonCode: p["reasonCode"] };
			break;
	}
	const checked = checkTransitionRequest(request);
	return checked.ok ? checked.value : undefined;
}

/** Called after authorization and before guards, digest, prechecks or DML. */
export function validOperationShape(op: WorldOperation): boolean {
	const r = object(op, ["kind", ...keys[op.kind]]);
	if (!r) return false;
	switch (op.kind) {
		case "entity.register":
			return (
				object(op.entity, ["id", "displayName", "aliases", "externalRefs"]) !==
				undefined
			);
		case "entity.merge":
		case "entity.split":
			return asRecord(op.plan) !== undefined;
		case "assertion.register":
			return assertionRows(op.assertion);
		case "assertion.transition":
			return (
				transition(op.plan) &&
				(op.replacement === undefined || assertionRows(op.replacement))
			);
		case "prediction.register": {
			const i = object(op.input, ["prediction", "dueAt", "basis?"]);
			if (!i) return false;
			if (i["basis"] !== undefined) {
				const b = object(i["basis"], ["assertionId", "revision"]);
				if (
					!b ||
					!checkId(b["assertionId"]).ok ||
					!checkRevision(b["revision"]).ok
				)
					return false;
			}
			return true;
		}
		case "outcome.register":
			return object(op.input, ["predictionId", "outcome"]) !== undefined;
		case "inbox.receive":
			return (
				object(op.feed, ["scopeKeys", "kind", "cursorRestoreEpoch"]) !==
					undefined &&
				object(op.event, ["eventId", "seq", "payload"]) !== undefined
			);
		case "candidate.settle":
			return (
				object(op.feed, ["scopeKeys", "kind", "cursorRestoreEpoch"]) !==
					undefined &&
				Array.isArray(op.assertions) &&
				op.assertions.every(assertionRows) &&
				(op.manifest === undefined ||
					(object(op.manifest, ["manifestId", "dependencies"]) !== undefined &&
						Array.isArray(op.manifest.dependencies) &&
						op.manifest.dependencies.every((s) => checkSourceRef(s).ok)))
			);
		case "invalidate":
			return (
				records(op.targets) &&
				(op.sourceKeys === undefined || Array.isArray(op.sourceKeys))
			);
		case "forget.chunk":
			return records(op.roots);
		case "forget.reopen":
			return typeof op.externalDeletionConfirmed === "boolean";
		case "restore.register":
			return records(op.registrations);
		case "restore.reconcile":
			return object(op.journal, ["seq", "final", "tombstones"]) !== undefined;
		case "restore.begin":
		case "restore.finish":
		case "rebuild":
			return true;
	}
}
