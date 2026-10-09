/** Scenarios pure API: scenario comparison and prediction reconciliation. */
export { compareScenarios } from "./service/compare.ts";
export { assessOutcome, maxOutcomeObservations } from "./service/assess.ts";
export type {
	CompareResult,
	OverlayOutcome,
	PathDelta,
	ScenarioComparison,
} from "./service/compare.ts";
export type {
	AssessResult,
	AssessedOutcome,
	IncomparableReason,
	MeasurementGap,
	ObservationAssessment,
	ObservationVerdict,
	OverallVerdict,
} from "./service/assess.ts";
export * from "./contracts/index.ts";
