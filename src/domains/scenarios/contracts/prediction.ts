import {
	asRecord,
	checkEpochMs,
	checkFiniteNumber,
	checkId,
	checkOpaque,
	checkRevision,
	fail,
	firstUnknownKey,
	ok,
	type Checked,
} from "../../../contracts/index.ts";

/** Half-open measurement window [startMs, endMs) in caller-supplied UTC ms. */
export interface MeasurementWindow {
	readonly startMs: number;
	readonly endMs: number;
}
export type ExpectedDirection = "increases" | "decreases";

/** Comparison conditions that must all match before any delta is computed. */
export interface ComparisonConditions {
	readonly subjectId: string;
	readonly metric: string;
	readonly unit: string;
	/** e.g. "avg" or "p95"; different statistics are never compared. */
	readonly statistic: string;
	readonly configuration: string;
	/** Opaque description of the workload/input size. */
	readonly inputProfile: string;
}
export interface QuantitativePrediction {
	readonly kind: "quantitative";
	readonly predictionId: string;
	readonly revision: number;
	readonly comparisonId: string;
	readonly conditions: ComparisonConditions;
	readonly baselineRef: string;
	readonly baselineValue: number;
	readonly expectedWindow: MeasurementWindow;
	readonly expectedDirection: ExpectedDirection;
	/** Fixed when the measurement plan is created; >= 0 and finite. */
	readonly measurementTolerance: number;
	/** Origin and intervention constraints are kept, never dropped. */
	readonly origin: string;
	readonly intervention?: string;
}
/** A relation claim without measurement information. */
export interface QualitativePrediction {
	readonly kind: "qualitative";
	readonly predictionId: string;
	readonly revision: number;
	readonly relation: "causes" | "enables";
	readonly subjectId: string;
	readonly objectId: string;
}
export type Prediction = QuantitativePrediction | QualitativePrediction;

export function checkWindow(
	value: unknown,
	path: string,
): Checked<MeasurementWindow> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const extra = firstUnknownKey(object, ["startMs", "endMs"]);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const start = checkEpochMs(object["startMs"], `${path}.startMs`);
	if (!start.ok) return start;
	const end = checkEpochMs(object["endMs"], `${path}.endMs`);
	if (!end.ok) return end;
	if (start.value >= end.value) return fail("INVALID_INPUT", path);
	return ok({ startMs: start.value, endMs: end.value });
}

const conditionKeys = [
	"subjectId",
	"metric",
	"unit",
	"statistic",
	"configuration",
	"inputProfile",
] as const;
export function checkConditions(
	value: unknown,
	path: string,
): Checked<ComparisonConditions> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const extra = firstUnknownKey(object, conditionKeys);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const out: Record<string, string> = {};
	for (const key of conditionKeys) {
		const v = checkOpaque(object[key], `${path}.${key}`);
		if (!v.ok) return v;
		out[key] = v.value;
	}
	return ok(out as unknown as ComparisonConditions);
}

export function checkPrediction(
	value: unknown,
	path = "prediction",
): Checked<Prediction> {
	const object = asRecord(value);
	if (!object) return fail("INVALID_INPUT", path);
	const id = checkId(object["predictionId"], `${path}.predictionId`);
	if (!id.ok) return id;
	const revision = checkRevision(object["revision"], `${path}.revision`);
	if (!revision.ok) return revision;
	if (object["kind"] === "qualitative") {
		const extra = firstUnknownKey(object, [
			"kind",
			"predictionId",
			"revision",
			"relation",
			"subjectId",
			"objectId",
		]);
		if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
		const relation = object["relation"];
		if (relation !== "causes" && relation !== "enables")
			return fail("INVALID_INPUT", `${path}.relation`);
		const subject = checkId(object["subjectId"], `${path}.subjectId`);
		if (!subject.ok) return subject;
		const target = checkId(object["objectId"], `${path}.objectId`);
		if (!target.ok) return target;
		return ok({
			kind: "qualitative",
			predictionId: id.value,
			revision: revision.value,
			relation,
			subjectId: subject.value,
			objectId: target.value,
		});
	}
	if (object["kind"] !== "quantitative")
		return fail("INVALID_INPUT", `${path}.kind`);
	const extra = firstUnknownKey(object, [
		"kind",
		"predictionId",
		"revision",
		"comparisonId",
		"conditions",
		"baselineRef",
		"baselineValue",
		"expectedWindow",
		"expectedDirection",
		"measurementTolerance",
		"origin",
		"intervention",
	]);
	if (extra !== undefined) return fail("INVALID_INPUT", `${path}.${extra}`);
	const comparisonId = checkId(object["comparisonId"], `${path}.comparisonId`);
	if (!comparisonId.ok) return comparisonId;
	const conditions = checkConditions(
		object["conditions"],
		`${path}.conditions`,
	);
	if (!conditions.ok) return conditions;
	const baselineRef = checkId(object["baselineRef"], `${path}.baselineRef`);
	if (!baselineRef.ok) return baselineRef;
	const baselineValue = checkFiniteNumber(
		object["baselineValue"],
		`${path}.baselineValue`,
	);
	if (!baselineValue.ok) return baselineValue;
	const window = checkWindow(
		object["expectedWindow"],
		`${path}.expectedWindow`,
	);
	if (!window.ok) return window;
	const direction = object["expectedDirection"];
	if (direction !== "increases" && direction !== "decreases")
		return fail("INVALID_INPUT", `${path}.expectedDirection`);
	const tolerance = checkFiniteNumber(
		object["measurementTolerance"],
		`${path}.measurementTolerance`,
	);
	if (!tolerance.ok) return tolerance;
	if (tolerance.value < 0)
		return fail("INVALID_INPUT", `${path}.measurementTolerance`);
	const origin = checkOpaque(object["origin"], `${path}.origin`);
	if (!origin.ok) return origin;
	let intervention: string | undefined;
	if (object["intervention"] !== undefined) {
		const v = checkOpaque(object["intervention"], `${path}.intervention`);
		if (!v.ok) return v;
		intervention = v.value;
	}
	return ok({
		kind: "quantitative",
		predictionId: id.value,
		revision: revision.value,
		comparisonId: comparisonId.value,
		conditions: conditions.value,
		baselineRef: baselineRef.value,
		baselineValue: baselineValue.value,
		expectedWindow: window.value,
		expectedDirection: direction,
		measurementTolerance: tolerance.value,
		origin: origin.value,
		...(intervention === undefined ? {} : { intervention }),
	});
}
