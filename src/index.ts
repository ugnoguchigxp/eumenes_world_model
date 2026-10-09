/**
 * Pure World APIs. No DB, clock, randomness, network or model dependency.
 *
 * Values are an explicit allowlist: only the operations and fixed tables a
 * host or another package should call. Internal input parsers (check*),
 * budget parsers and composition helpers (planScopeEpoch, composeEffect)
 * stay inside their domains; types are re-exported freely.
 */
export * from "./contracts/index.ts";
export {
	and3,
	compareValidity,
	evaluateConditions,
	not3,
	or3,
} from "./domains/conditions/index.ts";
export {
	normalizeAlias,
	planMerge,
	planSplit,
	resolveEntity,
} from "./domains/identity/index.ts";
export {
	MAX_PLAN_BUDGET,
	MAX_PLAN_EDGES,
	MAX_PLAN_ROOTS,
	planForget,
	planInvalidation,
} from "./domains/lifecycle/index.ts";
export {
	assessFreshness,
	evidenceKinds,
	freshnessStates,
	groupEvidenceRoots,
	lifecycles,
	origins,
	relationKinds,
	transitionActions,
	planAssertionTransition,
	terminalLifecycles,
	transitionTable,
	validateAssertion,
} from "./domains/assertions/index.ts";
export {
	buildProjection,
	buildWorldSlice,
	SLICE_MAX_BYTES,
	sliceStatuses,
	toSliceReceipt,
	validateSliceUsage,
} from "./domains/projection/index.ts";
export {
	checkDependencies,
	compareGaps,
	defaultBudget,
	edgesFromEntries,
	explainRelevance,
	findResearchGaps,
	traceInfluence,
} from "./domains/reasoning/index.ts";
export {
	assessOutcome,
	compareScenarios,
	maxOutcomeObservations,
} from "./domains/scenarios/index.ts";
export {
	candidateKeys,
	candidateReasonCodes,
	extractionLimits,
	modalities,
	prepareExtraction,
	validateCandidate,
	validateCandidates,
} from "./domains/extraction/index.ts";
export type * from "./domains/conditions/index.ts";
export type * from "./domains/identity/index.ts";
export type * from "./domains/lifecycle/index.ts";
export type * from "./domains/assertions/index.ts";
export type * from "./domains/projection/index.ts";
export type * from "./domains/reasoning/index.ts";
export type * from "./domains/scenarios/index.ts";
export type * from "./domains/extraction/index.ts";
