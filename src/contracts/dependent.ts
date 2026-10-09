import { asRecord, checkId, firstUnknownKey } from "./ids.ts";
import { fail, ok, type Checked } from "./result.ts";
import { checkRevision } from "./values.ts";

export const dependentKinds = [
	"source",
	"state",
	"entity",
	"assertion",
	"manifest",
	"prediction",
	"outcome",
	"candidate",
	"projection",
	"slice",
] as const;
export type DependentKind = (typeof dependentKinds)[number];

/** Typed, versioned target of an invalidation or forget plan. */
export interface DependentRef {
	readonly kind: DependentKind;
	readonly id: string;
	readonly revision: number;
}
/** Directed edge: `dependent` was derived from / reads `input`. */
export interface DependencyEdge {
	readonly input: DependentRef;
	readonly dependent: DependentRef;
}

export function checkDependentRef(
	value: unknown,
	path = "ref",
): Checked<DependentRef> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const extra = firstUnknownKey(object, ["kind", "id", "revision"]);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const kind = object["kind"];
	if (!dependentKinds.includes(kind as DependentKind))
		return fail("INVALID_INPUT", `${path}.kind`);
	const id = checkId(object["id"], `${path}.id`);
	if (!id.ok) return id;
	const revision = checkRevision(object["revision"], `${path}.revision`);
	if (!revision.ok) return revision;
	return ok({
		kind: kind as DependentKind,
		id: id.value,
		revision: revision.value,
	});
}

/** Stable total order: kind, id, revision. */
export function compareDependentRef(a: DependentRef, b: DependentRef): number {
	if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
	if (a.id !== b.id) return a.id < b.id ? -1 : 1;
	return a.revision - b.revision;
}
export const dependentKey = (ref: DependentRef) =>
	JSON.stringify([ref.kind, ref.id, ref.revision]);
