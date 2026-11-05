import { expect, test } from "bun:test";
import { decodeQuotedCandidates } from "../../eval/api/quoted-wire.ts";
const item = (text = "青い📘", occurrence = 0) => ({
	subject: { kind: "id", id: "book" },
	predicate: "color",
	payload: { kind: "value", value: { kind: "string", value: "青" } },
	quote: { utteranceId: "u", text, occurrence },
	modality: "asserted",
	conditionJson: "",
	validTimeJson: "",
});
const decode = (c: unknown, source = "前文。青い📘。青い📘。") =>
	decodeQuotedCandidates(JSON.stringify({ candidates: [c] }), [
		{ utteranceId: "u", text: source },
	]).candidates[0]!;
test("verbatim Unicode quotation binds the requested occurrence to exact UTF8 bytes", () => {
	for (const n of [0, 1]) {
		const c = decode(item("青い📘", n));
		const q = c.quote;
		expect(
			Buffer.from("前文。青い📘。青い📘。")
				.subarray(q.startByte, q.endByte)
				.toString(),
		).toBe("青い📘");
		expect(q.startByte).toBe(n === 0 ? 9 : 22);
	}
});
test("missing/mutated quotation, unknown authority fields and malformed JSON fail without repair", () => {
	expect(() => decode(item("青い本"))).toThrow("NOT_EXACT");
	expect(() => decode(item("青い📘", 2))).toThrow("NOT_EXACT");
	expect(() => decode({ ...item(), active: true })).toThrow(
		"UNKNOWN_OR_MISSING",
	);
	expect(() => decode({ ...item(), conditionJson: "not json" })).toThrow();
	expect(() => decode(item("é"), "e\u0301")).toThrow("NOT_EXACT");
});
test("condition JSON stays literal; ISO time is structural conversion with no date invention", () => {
	const condition = {
		kind: "expression",
		expression: {
			kind: "unsupported",
			extra: "kept for the public validator to reject",
		},
	};
	const c = decode({
		...item(),
		conditionJson: JSON.stringify(condition),
		validTimeJson: JSON.stringify({
			kind: "period",
			precision: "day",
			original: "2026-11-05",
			start: {
				earliest: "2026-11-05T00:00:00Z",
				latest: "2026-11-05T00:00:00Z",
			},
		}),
	});
	expect(c.condition).toEqual(condition);
	expect(c.validTime).toMatchObject({
		start: { earliest: Date.parse("2026-11-05T00:00:00Z") },
	});
	expect(() =>
		decode({
			...item(),
			validTimeJson: '{"kind":"instant","at":"2026-02-30T00:00:00Z"}',
		}),
	).toThrow("INVALID_DATE");
});
