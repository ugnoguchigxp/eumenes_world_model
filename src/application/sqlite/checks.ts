import {
	asRecord,
	checkContractVersion,
	checkEpochMs,
	checkId,
	checkOperationKey,
	checkScope,
	firstUnknownKey,
	sameScope,
	type Checked,
	type ScopeRef,
	type SourceRef,
	type SourceState,
} from "../../contracts/index.ts";
import { sourceIdentityKey } from "../../domains/assertions/index.ts";
import {
	isGateOpen,
	listTombstones,
	type TombstoneTarget,
} from "../../domains/lifecycle/sqlite.ts";
import type { WorldDb } from "../../infrastructure/sqlite/db.ts";
import type {
	HostChecks,
	WorldOperation,
	WorldOperationInput,
} from "./types.ts";

export const rejectedResult = (reasonCode: string) =>
	({ status: "rejected", reasonCode }) as const;
export const blockedResult = (reasonCode: string) =>
	({ status: "blocked", reasonCode }) as const;

const operationKinds = [
	"entity.register",
	"entity.merge",
	"entity.split",
	"assertion.register",
	"assertion.transition",
	"prediction.register",
	"outcome.register",
	"candidate.settle",
	"inbox.receive",
	"invalidate",
	"forget.chunk",
	"forget.reopen",
	"restore.begin",
	"restore.register",
	"restore.reconcile",
	"restore.finish",
	"rebuild",
] as const;

export function checkHostChecks(
	value: unknown,
	path = "hostChecks",
): Checked<HostChecks> {
	const object = asRecord(value);
	if (!object) return { ok: false, code: "INVALID_INPUT", path };
	const extra = firstUnknownKey(object, [
		"gate",
		"sourceSnapshot",
		"forgetEpoch",
		"restoreEpoch",
		"policyRevision",
	]);
	if (extra !== undefined)
		return { ok: false, code: "INVALID_INPUT", path: `${path}.${extra}` };
	const gate = object["gate"];
	if (gate !== undefined && gate !== "open" && gate !== "closed")
		return { ok: false, code: "INVALID_INPUT", path: `${path}.gate` };
	const snapshot = asRecord(object["sourceSnapshot"]);
	if (
		!snapshot ||
		firstUnknownKey(snapshot, ["states"]) !== undefined ||
		!Array.isArray(snapshot["states"])
	)
		return {
			ok: false,
			code: "INVALID_INPUT",
			path: `${path}.sourceSnapshot`,
		};
	for (const key of ["forgetEpoch", "restoreEpoch", "policyRevision"]) {
		const id = checkId(object[key], `${path}.${key}`);
		if (!id.ok) return id;
	}
	return {
		ok: true,
		value: {
			...(gate === undefined ? {} : { gate }),
			sourceSnapshot: { states: snapshot["states"] as SourceState[] },
			forgetEpoch: object["forgetEpoch"] as string,
			restoreEpoch: object["restoreEpoch"] as string,
			policyRevision: object["policyRevision"] as string,
		},
	};
}

export function checkAccess(
	value: unknown,
	scope: ScopeRef,
	policyRevision: string,
): "ok" | "SCOPE_NOT_PERMITTED" | "POLICY_CHANGED" | "INVALID_INPUT" {
	const object = asRecord(value);
	if (
		!object ||
		firstUnknownKey(object, [
			"principal",
			"scopeKeys",
			"purpose",
			"policyRevision",
		]) !== undefined ||
		typeof object["principal"] !== "string" ||
		!Array.isArray(object["scopeKeys"]) ||
		typeof object["purpose"] !== "string" ||
		typeof object["policyRevision"] !== "string"
	)
		return "INVALID_INPUT";
	if (
		object["principal"] !== scope.principal ||
		!(object["scopeKeys"] as unknown[]).includes(scope.scopeKey)
	)
		return "SCOPE_NOT_PERMITTED";
	return object["policyRevision"] === policyRevision ? "ok" : "POLICY_CHANGED";
}

/** Strict envelope parse: unknown keys are rejected, never dropped. */
export function parseEnvelope(input: unknown): Checked<WorldOperationInput> {
	const object = asRecord(input);
	if (!object) return { ok: false, code: "INVALID_INPUT", path: "input" };
	const extra = firstUnknownKey(object, [
		"contractVersion",
		"access",
		"scope",
		"operationKey",
		"clock",
		"hostChecks",
		"operation",
	]);
	if (extra !== undefined)
		return { ok: false, code: "INVALID_INPUT", path: `input.${extra}` };
	const version = checkContractVersion(object["contractVersion"]);
	if (!version.ok) return version;
	const scope = checkScope(object["scope"]);
	if (!scope.ok) return scope;
	const key = checkOperationKey(object["operationKey"]);
	if (!key.ok) return key;
	const clock = checkEpochMs(object["clock"], "clock");
	if (!clock.ok) return clock;
	const host = checkHostChecks(object["hostChecks"]);
	if (!host.ok) return host;
	const operation = asRecord(object["operation"]);
	if (
		!operation ||
		!operationKinds.includes(
			operation["kind"] as (typeof operationKinds)[number],
		)
	)
		return { ok: false, code: "INVALID_INPUT", path: "operation" };
	const access = object["access"];
	const accessCode = checkAccess(
		access,
		scope.value,
		host.value.policyRevision,
	);
	if (accessCode === "INVALID_INPUT")
		return { ok: false, code: "INVALID_INPUT", path: "access" };
	// Access verdicts are mapped by the caller (needs result shape); carry them.
	return {
		ok: true,
		value: {
			contractVersion: 1,
			access: access as WorldOperationInput["access"],
			scope: scope.value,
			operationKey: key.value,
			clock: clock.value,
			hostChecks: host.value,
			operation: operation as unknown as WorldOperation,
		},
	};
}

const id = (value: unknown): string[] =>
	typeof value === "string" ? [value] : [];
const field = (value: unknown, key: string): unknown => asRecord(value)?.[key];
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Assertion-side sources an operation brings in (evidence + input manifest). */
export function operationSources(operation: WorldOperation): SourceRef[] {
	if (operation.kind === "candidate.settle") {
		return [
			...list(field(operation.manifest, "dependencies")),
			...list(operation.assertions).flatMap((assertion) => [
				...list(field(assertion, "evidence")).map((e) => field(e, "source")),
				...list(field(assertion, "inputManifest")),
			]),
		].filter((ref): ref is SourceRef => asRecord(ref) !== undefined);
	}
	const sourceOf = (assertion: {
		evidence?: unknown;
		inputManifest?: unknown;
	}): SourceRef[] =>
		[
			...list(assertion.evidence).map((e) => field(e, "source") as SourceRef),
			...(list(assertion.inputManifest) as SourceRef[]),
		].filter((ref) => asRecord(ref) !== undefined);
	if (operation.kind === "assertion.register")
		return operation.assertion ? sourceOf(operation.assertion) : [];
	if (operation.kind === "assertion.transition") {
		// The reason source of a retraction is an input of the next revision.
		const reason = field(operation.plan, "reasonSource");
		return [
			...(asRecord(reason) ? [reason as SourceRef] : []),
			...(operation.replacement ? sourceOf(operation.replacement) : []),
		];
	}
	return [];
}

/** Entities an assertion names: subject, relation object, entity-ref value. */
function entitiesOf(assertion: unknown): string[] {
	const payload = field(assertion, "payload");
	return [
		...id(field(assertion, "subjectId")),
		...id(field(payload, "objectId")),
		...id(field(field(payload, "value"), "entityId")),
	];
}

/** Typed targets the operation touches, for the tombstone guard. */
export function operationTargets(operation: WorldOperation): TombstoneTarget[] {
	const targets: TombstoneTarget[] = [];
	const add = (kind: TombstoneTarget["kind"], ids: string[]) => {
		for (const value of ids) targets.push({ kind, id: value });
	};
	switch (operation.kind) {
		case "entity.register":
			add("entity", id(field(operation.entity, "id")));
			break;
		case "entity.merge":
			add("entity", [
				...id(field(operation.plan, "representativeId")),
				...list(field(operation.plan, "members")).flatMap((m) =>
					id(field(m, "id")),
				),
			]);
			break;
		case "entity.split":
			add("entity", [
				...id(field(operation.plan, "representativeId")),
				...list(field(operation.plan, "restored")).flatMap((m) =>
					id(field(m, "id")),
				),
			]);
			break;
		case "assertion.register":
			add("assertion", id(field(operation.assertion, "id")));
			add("entity", entitiesOf(operation.assertion));
			break;
		case "assertion.transition":
			add("assertion", id(field(operation.plan, "id")));
			if (operation.replacement)
				add("entity", entitiesOf(operation.replacement));
			break;
		case "prediction.register":
			add(
				"prediction",
				id(field(field(operation.input, "prediction"), "predictionId")),
			);
			add(
				"assertion",
				id(field(field(operation.input, "basis"), "assertionId")),
			);
			{
				// Entities a prediction names (a forgotten one must not reappear).
				const prediction = field(operation.input, "prediction");
				add("entity", [
					...id(field(field(prediction, "conditions"), "subjectId")),
					...id(field(prediction, "subjectId")),
					...id(field(prediction, "objectId")),
				]);
			}
			break;
		case "outcome.register":
			add("prediction", id(field(operation.input, "predictionId")));
			add("outcome", id(field(field(operation.input, "outcome"), "outcomeId")));
			break;
		case "candidate.settle":
			add(
				"assertion",
				list(operation.assertions).flatMap((a) => id(field(a, "id"))),
			);
			add("entity", list(operation.assertions).flatMap(entitiesOf));
			add("manifest", id(field(operation.manifest, "manifestId")));
			add("candidate", id(operation.eventId));
			break;
		case "inbox.receive":
			add("candidate", id(field(operation.event, "eventId")));
			break;
		default:
			break;
	}
	// A source may have been forgotten as a source or as a state.
	for (const ref of operationSources(operation)) {
		targets.push({ kind: "source", id: sourceIdentityKey(ref) });
		targets.push({ kind: "state", id: sourceIdentityKey(ref) });
	}
	return targets;
}

/** Gate (host + World ledger), tombstones and source versions; null = all clear. */
export function ledgerGuards(
	db: WorldDb,
	input: WorldOperationInput,
): { status: "blocked" | "rejected"; reasonCode: string } | null {
	if (input.hostChecks.gate === "closed" || !isGateOpen(db, input.scope))
		return blockedResult("GATE_CLOSED");
	const targets = operationTargets(input.operation);
	for (let i = 0; i < targets.length; i += 400)
		if (listTombstones(db, input.scope, targets.slice(i, i + 400)).length > 0)
			return rejectedResult("TOMBSTONED");
	const states = new Map<string, SourceState>();
	for (const state of input.hostChecks.sourceSnapshot.states)
		states.set(sourceIdentityKey(state), state);
	for (const ref of operationSources(input.operation)) {
		const state = states.get(sourceIdentityKey(ref));
		// Missing, other-Scope, forgotten: one indistinguishable answer.
		if (
			!state ||
			!sameScope(
				{ principal: state.principal, scopeKey: state.scopeKey },
				input.scope,
			) ||
			(state.status !== "available" && state.status !== "changed")
		)
			return rejectedResult("SOURCE_NOT_AVAILABLE");
		if (
			state.status === "changed" ||
			state.revision !== ref.revision ||
			state.digest !== ref.digest
		)
			return rejectedResult("SOURCE_VERSION_MISMATCH");
	}
	return null;
}
