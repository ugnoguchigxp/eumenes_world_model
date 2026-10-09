import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { compareValidity, evaluateConditions } from "../index.ts";

const fixture = JSON.parse(
	readFileSync(
		join(import.meta.dir, "../../../../fixtures/conditions/validity.json"),
		"utf8",
	),
);
const NOW = 1791500000000;
const validity = (validTime: unknown, asOf: number) => {
	const r = compareValidity({ contractVersion: 1, validTime, asOf });
	if (!r.ok) throw new Error(`rejected:${r.code}:${r.path}`);
	return r.value;
};

describe("A06 validTime", () => {
	test("month precision 'from September' is preserved, not a fabricated day", () => {
		for (const c of fixture.cases)
			expect(validity(fixture.septemberFrom, c.asOf)).toEqual({
				result: c.result,
				reason: c.reason,
			});
		// The original expression survives validation untouched.
		const start = fixture.septemberFrom.start;
		expect(start.latest - start.earliest).toBe(30 * 86_400_000);
		// First and last instants of the uncertain month stay unknown/decisive.
		expect(validity(fixture.septemberFrom, start.earliest).result).toBe(
			"unknown",
		);
		expect(validity(fixture.septemberFrom, start.latest - 1).result).toBe(
			"unknown",
		);
		expect(validity(fixture.septemberFrom, start.latest).result).toBe(
			"satisfied",
		);
		expect(validity(fixture.septemberFrom, start.earliest - 1).result).toBe(
			"violated",
		);
	});
	test("end is exclusive; closed exact period", () => {
		const period = {
			kind: "period",
			precision: "exact",
			original: "10:00-11:00",
			start: { earliest: 100, latest: 100 },
			end: { earliest: 200, latest: 200 },
		};
		expect(validity(period, 99).result).toBe("violated");
		expect(validity(period, 100).result).toBe("satisfied");
		expect(validity(period, 199).result).toBe("satisfied");
		expect(validity(period, 200)).toEqual({
			result: "violated",
			reason: "ENDED",
		});
	});
	test("uncertain end gives unknown", () => {
		const period = {
			kind: "period",
			precision: "month",
			original: "9月まで",
			end: { earliest: 1000, latest: 2000 },
		};
		expect(validity(period, 999).result).toBe("satisfied");
		expect(validity(period, 1500).result).toBe("unknown");
		expect(validity(period, 2000).result).toBe("violated");
	});
	test("instant matches only itself", () => {
		expect(validity({ kind: "instant", at: 5 }, 5).result).toBe("satisfied");
		expect(validity({ kind: "instant", at: 5 }, 6).result).toBe("violated");
	});
	test("malformed validTime is rejected, not guessed", () => {
		const bad = [
			{ kind: "period", precision: "month", original: "x" },
			{
				kind: "period",
				precision: "week",
				original: "x",
				start: { earliest: 1, latest: 2 },
			},
			{
				kind: "period",
				precision: "month",
				original: "x",
				start: { earliest: 2, latest: 2 },
			},
			{
				kind: "period",
				precision: "exact",
				original: "x",
				start: { earliest: 1, latest: 2 },
			},
			{
				kind: "period",
				precision: "day",
				original: "x",
				start: { earliest: 5, latest: 9 },
				end: { earliest: 1, latest: 5 },
			},
			{ kind: "instant", at: 1.5 },
			{
				kind: "period",
				precision: "day",
				original: "",
				start: { earliest: 1, latest: 2 },
			},
		];
		for (const validTime of bad)
			expect(
				compareValidity({ contractVersion: 1, validTime, asOf: 1 }).ok,
			).toBe(false);
	});

	const base = (over: Record<string, unknown>) => ({
		contractVersion: 1,
		asOf: NOW,
		authorized: true,
		maxAgeMs: 1000,
		observations: [],
		...over,
	});
	test("future observation (asOf before observedAt) is not used as current state", () => {
		const r = evaluateConditions(
			base({
				condition: {
					kind: "expression",
					expression: {
						kind: "compare",
						key: "k",
						op: "eq",
						value: { kind: "boolean", value: true },
					},
				},
				observations: [
					{
						observationId: "o",
						key: "k",
						value: { kind: "boolean", value: true },
						observedAt: NOW + 1,
						version: "v",
						priority: 0,
					},
				],
			}),
		);
		expect(r).toEqual({
			ok: true,
			value: { result: "unknown", reasons: ["FUTURE_OBSERVATION"] },
		});
	});
	test("observation validity unknown or violated is not used", () => {
		const mk = (validTime: unknown) =>
			evaluateConditions(
				base({
					condition: {
						kind: "expression",
						expression: {
							kind: "compare",
							key: "k",
							op: "eq",
							value: { kind: "boolean", value: true },
						},
					},
					observations: [
						{
							observationId: "o",
							key: "k",
							value: { kind: "boolean", value: true },
							observedAt: NOW,
							version: "v",
							priority: 0,
							validTime,
						},
					],
				}),
			);
		expect(mk(fixture.septemberFrom)).toMatchObject({
			ok: true,
			value: { result: "satisfied" },
		});
		const uncertain = {
			...fixture.septemberFrom,
			start: { earliest: NOW - 5, latest: NOW + 5 },
		};
		expect(mk(uncertain)).toMatchObject({
			value: { result: "unknown", reasons: ["OBSERVATION_VALIDITY_UNKNOWN"] },
		});
		const over = {
			kind: "period",
			precision: "day",
			original: "昨日まで",
			end: { earliest: NOW - 10, latest: NOW - 5 },
		};
		expect(mk(over)).toMatchObject({
			value: { result: "unknown", reasons: ["OBSERVATION_NOT_VALID"] },
		});
	});
	test("explicitly_unconditional needs adoption evidence, and keeps validity checks", () => {
		const unconditional = {
			kind: "explicitly_unconditional",
			adoptionEvidenceId: "ev-1",
		};
		expect(evaluateConditions(base({ condition: unconditional }))).toEqual({
			ok: true,
			value: { result: "satisfied", reasons: [] },
		});
		for (const condition of [
			{ kind: "explicitly_unconditional" },
			{ kind: "explicitly_unconditional", adoptionEvidenceId: "" },
		])
			expect(evaluateConditions(base({ condition })).ok).toBe(false);
		// validTime of the claim is not skipped.
		const ended = {
			kind: "instant",
			at: NOW - 1,
		};
		expect(
			evaluateConditions(base({ condition: unconditional, validTime: ended })),
		).toEqual({
			ok: true,
			value: { result: "violated", reasons: ["CLAIM_NOT_VALID"] },
		});
		expect(
			evaluateConditions(
				base({
					condition: unconditional,
					validTime: fixture.septemberFrom,
					asOf: 1789000000000,
				}),
			),
		).toEqual({
			ok: true,
			value: { result: "unknown", reasons: ["CLAIM_VALIDITY_UNKNOWN"] },
		});
		// Unauthorized stays unknown even if unconditional.
		expect(
			evaluateConditions(base({ condition: unconditional, authorized: false })),
		).toMatchObject({
			value: { result: "unknown", reasons: ["NOT_AUTHORIZED"] },
		});
	});
});
