/** Structural and mathematical scoring only; meaning is judged separately. */
import {
	evaluateConditions,
	type AssertionDraft,
	type Condition,
	type ConditionSpec,
	type Observation,
	type TypedValue,
} from "../../src/index.ts";
import type { Fact, Job, QualityCase } from "./dataset.ts";
import type { Answer, JudgeVerdict } from "./protocol.ts";
export const canonical = (value: unknown): string =>
	JSON.stringify(value, (_key, v: unknown) =>
		v && typeof v === "object" && !Array.isArray(v)
			? Object.fromEntries(
					Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
				)
			: v,
	);
const NOW = 1793836800000;
export function observations(job: Job): Observation[] {
	return job.observations.map((o, i) => ({
		observationId: `obs-${i}`,
		key: o.key,
		value:
			typeof o.value === "number"
				? { kind: "number", value: o.value, unit: o.unit ?? "" }
				: typeof o.value === "boolean"
					? { kind: "boolean", value: o.value }
					: { kind: "string", value: o.value },
		observedAt: job.asOf,
		version: "1",
		priority: 1,
	}));
}
/** Truth equivalence on all comparison partitions, including absent observations. */
export function sameCondition(
	a: ConditionSpec | undefined,
	b: ConditionSpec | undefined,
): boolean {
	const aa = a ?? { kind: "unspecified" },
		bb = b ?? { kind: "unspecified" };
	if (canonical(aa) === canonical(bb)) return true;
	if (aa.kind !== "expression" || bb.kind !== "expression") return false;
	const values = new Map<string, TypedValue[]>();
	function visit(c: Condition) {
		if (c.kind === "compare") {
			const list = values.get(c.key) ?? [];
			list.push(c.value);
			values.set(c.key, list);
		} else if (c.kind === "not") visit(c.item);
		else if (c.kind === "all" || c.kind === "any") c.items.forEach(visit);
	}
	visit(aa.expression);
	visit(bb.expression);
	let worlds: Observation[][] = [[]];
	for (const [key, vs] of values) {
		const candidates: TypedValue[] = [...vs];
		if (vs.some((v) => v.kind === "boolean"))
			candidates.push(
				{ kind: "boolean", value: true },
				{ kind: "boolean", value: false },
			);
		// Equality domains need the complement of all mentioned literals too.
		for (const kind of ["string", "entity"] as const) {
			const literals = new Set(
				vs.flatMap((v) =>
					v.kind === kind ? [v.kind === "entity" ? v.entityId : v.value] : [],
				),
			);
			if (literals.size === 0) continue;
			let other = 0;
			while (literals.has(String(other))) other++;
			candidates.push(
				kind === "entity"
					? { kind, entityId: String(other) }
					: { kind, value: String(other) },
			);
		}
		const units = new Set(
			vs.flatMap((v) => (v.kind === "number" ? [v.unit] : [])),
		);
		for (const unit of units) {
			const bounds = [
				...new Set(
					vs.flatMap((v) =>
						v.kind === "number" && v.unit === unit ? [v.value] : [],
					),
				),
			].sort((a, b) => a - b);
			// Finite extremes cover outside intervals even when adding one rounds
			// back to a large bound. Half-sums avoid overflowing finite endpoints.
			candidates.push(
				{ kind: "number", value: -Number.MAX_VALUE, unit },
				{ kind: "number", value: Number.MAX_VALUE, unit },
			);
			for (let i = 1; i < bounds.length; i++)
				candidates.push({
					kind: "number",
					value: bounds[i - 1]! / 2 + bounds[i]! / 2,
					unit,
				});
		}
		const unique = [
			...new Map(candidates.map((v) => [canonical(v), v])).values(),
		];
		// Bound the Cartesian product before allocating it, not after expansion.
		if (worlds.length > Math.floor(10000 / (unique.length + 1))) return false;
		worlds = worlds.flatMap((w) => [
			w,
			...unique.map((value) => [
				...w,
				{
					observationId: key,
					key,
					value,
					observedAt: NOW,
					version: "1",
					priority: 1,
				},
			]),
		]);
	}
	const result = (c: ConditionSpec, obs: Observation[]) => {
		const r = evaluateConditions({
			contractVersion: 1,
			authorized: true,
			asOf: NOW,
			maxAgeMs: 1,
			condition: c,
			observations: obs,
		});
		return r.ok ? r.value.result : "invalid";
	};
	return worlds.every((w) => result(aa, w) === result(bb, w));
}
function timeKey(t: Fact["validTime"]) {
	if (t?.kind !== "period") return canonical(t);
	const { original: _original, ...rest } = t;
	return canonical(rest);
}
export function matches(d: AssertionDraft, f: Fact, c: QualityCase) {
	return (
		d.subjectId === f.subjectId &&
		d.predicate === f.predicate &&
		canonical(d.payload) === canonical(f.payload) &&
		sameCondition(d.condition, f.condition) &&
		timeKey(d.validTime) === timeKey(f.validTime) &&
		f.sourceIds.every((id) => d.evidence.some((e) => e.source.id === id)) &&
		(!d.validTime ||
			d.validTime.kind !== "period" ||
			c.sources.some((s) =>
				s.text.includes(
					d.validTime!.kind === "period" ? d.validTime!.original : "",
				),
			))
	);
}
export function gradeAnswer(
	job: Job,
	a: Answer | null,
	ids: readonly string[],
) {
	if (!a)
		return {
			passed: false,
			missing: true,
			unsupportedCitation: false,
			wrong: true,
		};
	let payloads: unknown[] = [];
	try {
		payloads = a.claims.map((c) => JSON.parse(c.payloadJson));
	} catch {
		return {
			passed: false,
			missing: false,
			unsupportedCitation: false,
			wrong: true,
		};
	}
	const unsupportedCitation = a.citations.some((id) => !ids.includes(id));
	const exactClaims =
		a.claims.length === job.answerFacts.length &&
		job.answerFacts.every((f) =>
			a.claims.some(
				(c, i) =>
					c.subjectId === f.subjectId &&
					c.predicate === f.predicate &&
					canonical(payloads[i]) === canonical(f.payload),
			),
		);
	const passed =
		a.hold === job.hold &&
		(job.hold
			? a.claims.length === 0
			: exactClaims &&
				job.requiredSources.every((id) => a.citations.includes(id))) &&
		!unsupportedCitation;
	return { passed, missing: false, unsupportedCitation, wrong: !passed };
}
export const semanticPass = (v: JudgeVerdict | undefined) =>
	!!v &&
	!v.referenceConflict &&
	v.correct &&
	v.sourceSupported &&
	v.qualificationsPreserved &&
	v.appropriateHold &&
	!v.safetyViolation;
