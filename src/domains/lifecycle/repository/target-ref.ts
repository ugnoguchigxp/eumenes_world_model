import {
	asRecord,
	checkOpaque,
	checkRevision,
	dependentKinds,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
	type DependentKind,
	type DependentRef,
} from "../../../contracts/index.ts";

/**
 * Source/state targets are identified by the assertions domain's source
 * identity key (a JSON array of up to four 256-byte fields, possibly escaped),
 * which can legitimately exceed the 256-byte opaque-ID limit. Forget and
 * tombstone must carry such keys, or a registered source could never be
 * forgotten. Every other kind keeps the 256-byte ID limit.
 */
export const maxSourceKeyBytes = 8192;

export function checkTargetRef(
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
	const long = kind === "source" || kind === "state";
	const id = checkOpaque(
		object["id"],
		`${path}.id`,
		long ? maxSourceKeyBytes : 256,
	);
	if (!id.ok) return id;
	const revision = checkRevision(object["revision"], `${path}.revision`);
	if (!revision.ok) return revision;
	return ok({
		kind: kind as DependentKind,
		id: id.value,
		revision: revision.value,
	});
}
