import { expect, test } from "bun:test";
import { buildWorldSlice } from "../index.ts";
import { rec, sha256, sliceInput } from "./helpers.ts";

const build = (request: Record<string, unknown>, extra = {}) =>
	buildWorldSlice(
		sliceInput(
			[
				rec("a-background", {
					subjectId: "same",
					payload: {
						kind: "value",
						value: { kind: "string", value: "長".repeat(1000) },
					},
				}),
				rec("z-needed", { subjectId: "same" }),
			],
			request,
			extra,
		),
		sha256,
	);

test("exact assertion focus keeps a needed unit without requiring all units of its subject", () => {
	const result = build({
		focusAssertionRefs: [{ id: "z-needed", revision: 1 }],
		maxBytes: 1500,
	});
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.value.status).toBe("partial");
	expect(result.value.units.map((u) => u.assertionId)).toEqual(["z-needed"]);
	expect(result.value.budget.usedBytes).toBeLessThanOrEqual(1500);
	expect(result.value.units[0]!.condition).toEqual({ kind: "unspecified" });
	const subject = build({ focusSubjectIds: ["same"], maxBytes: 1500 });
	expect(subject.ok && subject.value.status).toBe("overflow");
});

test("missing, stale and terminal assertion references are explicit partial results", () => {
	for (const ref of [
		{ id: "missing", revision: 1 },
		{ id: "z-needed", revision: 2 },
	]) {
		const result = build({ focusAssertionRefs: [ref] });
		expect(result.ok && result.value.status).toBe("partial");
		if (result.ok)
			expect(result.value.reasonCodes).toContain("FOCUS_ASSERTION_NOT_FOUND");
	}
	const terminal = buildWorldSlice(
		sliceInput([rec("gone", { lifecycle: "invalidated" })], {
			focusAssertionRefs: [{ id: "gone", revision: 1 }],
		}),
		sha256,
	);
	expect(terminal.ok && terminal.value.units).toEqual([]);
	if (terminal.ok)
		expect(terminal.value.reasonCodes).toContain("FOCUS_ASSERTION_NOT_FOUND");
});

test("empty focus is compatible; order/duplicates do not change selection or digest", () => {
	expect(build({ focusAssertionRefs: [] })).toEqual(build({}));
	const a = { id: "a-background", revision: 1 };
	const b = { id: "z-needed", revision: 1 };
	expect(build({ focusAssertionRefs: [a, b, a] })).toEqual(
		build({ focusAssertionRefs: [b, a] }),
	);
	const union = build({
		focusSubjectIds: ["same"],
		focusAssertionRefs: [b],
		maxBytes: 1500,
	});
	expect(union.ok && union.value.status).toBe("overflow");
});

test("reference validation, cap and authorization remain enforced", () => {
	for (const focusAssertionRefs of [
		[{ id: "x", revision: 0 }],
		[{ id: "x", revision: 1, active: true }],
		Array.from({ length: 65 }, (_, i) => ({ id: `x${i}`, revision: 1 })),
	]) {
		expect(build({ focusAssertionRefs }).ok).toBe(false);
	}
	const blocked = build(
		{ focusAssertionRefs: [{ id: "hidden", revision: 1 }] },
		{
			checks: {
				authorized: false,
				correctionsResolved: true,
				restoreVerified: true,
			},
		},
	);
	expect(blocked.ok && blocked.value.status).toBe("blocked");
	if (blocked.ok) {
		expect(blocked.value.units).toEqual([]);
		expect(blocked.value.reasonCodes).toEqual(["ACCESS_NOT_VERIFIED"]);
	}
});
