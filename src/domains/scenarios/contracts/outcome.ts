import {
	asRecord,
	checkFiniteNumber,
	checkId,
	checkRevision,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
} from "../../../contracts/index.ts";
import {
	checkConditions,
	checkWindow,
	type ComparisonConditions,
	type MeasurementWindow,
} from "./prediction.ts";

/** A measured observation. Never a prediction; `kind` is checked. */
export interface Outcome {
	readonly kind: "outcome";
	readonly outcomeId: string;
	readonly revision: number;
	readonly comparisonId: string;
	/** The prediction revision whose plan (and tolerance) was measured. */
	readonly predictionRevision: number;
	readonly conditions: ComparisonConditions;
	readonly baselineRef: string;
	readonly window: MeasurementWindow;
	readonly value: number;
}

export function checkOutcome(value: unknown, path: string): Checked<Outcome> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	if (object["kind"] !== "outcome")
		return fail("INVALID_INPUT", `${path}.kind`);
	const extra = firstUnknownKey(object, [
		"kind",
		"outcomeId",
		"revision",
		"comparisonId",
		"predictionRevision",
		"conditions",
		"baselineRef",
		"window",
		"value",
	]);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const outcomeId = checkId(object["outcomeId"], `${path}.outcomeId`);
	if (!outcomeId.ok) return outcomeId;
	const revision = checkRevision(object["revision"], `${path}.revision`);
	if (!revision.ok) return revision;
	const comparisonId = checkId(object["comparisonId"], `${path}.comparisonId`);
	if (!comparisonId.ok) return comparisonId;
	const predictionRevision = checkRevision(
		object["predictionRevision"],
		`${path}.predictionRevision`,
	);
	if (!predictionRevision.ok) return predictionRevision;
	const conditions = checkConditions(
		object["conditions"],
		`${path}.conditions`,
	);
	if (!conditions.ok) return conditions;
	const baselineRef = checkId(object["baselineRef"], `${path}.baselineRef`);
	if (!baselineRef.ok) return baselineRef;
	const window = checkWindow(object["window"], `${path}.window`);
	if (!window.ok) return window;
	const measured = checkFiniteNumber(object["value"], `${path}.value`);
	if (!measured.ok) return measured;
	return ok({
		kind: "outcome",
		outcomeId: outcomeId.value,
		revision: revision.value,
		comparisonId: comparisonId.value,
		predictionRevision: predictionRevision.value,
		conditions: conditions.value,
		baselineRef: baselineRef.value,
		window: window.value,
		value: measured.value,
	});
}
