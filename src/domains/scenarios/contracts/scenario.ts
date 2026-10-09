import {
	asRecord,
	checkId,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
} from "../../../contracts/index.ts";

/**
 * A hypothetical change applied to a copy of the baseline edges. Overlays are
 * never persisted. Edge objects are validated by the reasoning domain when the
 * merged graph is traced.
 */
export interface Overlay {
	readonly overlayId: string;
	readonly addEdges: readonly unknown[];
	readonly removeEdgeIds: readonly string[];
}

export const maxOverlayEdges = 100;

export function checkOverlay(value: unknown, path: string): Checked<Overlay> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const extra = firstUnknownKey(object, [
		"overlayId",
		"addEdges",
		"removeEdgeIds",
	]);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const overlayId = checkId(object["overlayId"], `${path}.overlayId`);
	if (!overlayId.ok) return overlayId;
	const add = object["addEdges"] ?? [];
	const remove = object["removeEdgeIds"] ?? [];
	if (!Array.isArray(add)) return fail("INVALID_INPUT", `${path}.addEdges`);
	if (!Array.isArray(remove))
		return fail("INVALID_INPUT", `${path}.removeEdgeIds`);
	if (add.length > maxOverlayEdges || remove.length > maxOverlayEdges)
		return fail("LIMIT_EXCEEDED", path);
	const removeIds: string[] = [];
	for (let i = 0; i < remove.length; i++) {
		const id = checkId(remove[i], `${path}.removeEdgeIds[${i}]`);
		if (!id.ok) return id;
		removeIds.push(id.value);
	}
	return ok({
		overlayId: overlayId.value,
		addEdges: [...add],
		removeEdgeIds: removeIds,
	});
}
