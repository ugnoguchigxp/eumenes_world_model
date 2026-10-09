import { describe, expect, test } from "bun:test";
import { buildProjection, buildWorldSlice } from "../index.ts";
import { rec, sha256, sliceInput, snapshot, state } from "./helpers.ts";

const project = (assertions: Record<string, unknown>[], extra = {}) =>
	buildProjection(
		{ contractVersion: 1, snapshot: snapshot(assertions, extra) },
		sha256,
	);

describe("round-3 projection gaps", () => {
	test("a source owned by another principal is refused even with the same scopeKey", () => {
		const r = project([rec("a1")], {
			sources: [state({ principal: "p-zzz" })],
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.code).toBe("SCOPE_NOT_PERMITTED");
	});
	test("same revision but a different digest is not current: Slice is blocked", () => {
		const slice = buildWorldSlice(
			sliceInput(
				[rec("a1")],
				{},
				{
					sources: [state({ digest: `sha256:${"0".repeat(64)}` })],
				},
			),
			sha256,
		);
		expect(slice.ok).toBe(true);
		if (slice.ok) {
			expect(slice.value.status).toBe("blocked");
			expect(slice.value.reasonCodes).toContain("SOURCE_NOT_CURRENT");
		}
	});
	test("the material digest changes with a source's status and digest", () => {
		const digestOf = (source: Record<string, unknown>) => {
			const r = project([rec("a1")], { sources: [state(source)] });
			if (!r.ok) throw new Error(r.code);
			return r.value.materialDigest;
		};
		const base = digestOf({});
		expect(digestOf({ status: "changed" })).not.toBe(base);
		expect(digestOf({ digest: `sha256:${"1".repeat(64)}` })).not.toBe(base);
		expect(digestOf({})).toBe(base);
	});
	test("an active model_hypothesis is shown as a hypothesis, not a claim", () => {
		const slice = buildWorldSlice(
			sliceInput([
				rec("h1", { origin: "model_hypothesis" }),
				rec("c1", { origin: "user_report" }),
			]),
			sha256,
		);
		if (!slice.ok) throw new Error(slice.code);
		const stance = (id: string) =>
			slice.value.units.find((u) => u.assertionId === id)?.stance;
		expect(stance("h1")).toBe("hypothesis");
		expect(stance("c1")).toBe("claim");
	});
});
