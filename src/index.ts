/**
 * Pure World APIs. No DB, clock, randomness, network or model dependency.
 *
 * Values are an explicit allowlist: only the operations and fixed tables a
 * host or another package should call. Internal input parsers (check*),
 * budget helpers and composition helpers (planScopeEpoch, composeEffect,
 * edgesFromEntries) stay inside their domains; types are re-exported freely.
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
export { planForget, planInvalidation } from "./domains/lifecycle/index.ts";
export {
	assessFreshness,
	groupEvidenceRoots,
	planAssertionTransition,
	terminalLifecycles,
	transitionTable,
	validateAssertion,
} from "./domains/assertions/index.ts";
export {
	buildProjection,
	buildWorldSlice,
	toSliceReceipt,
	validateSliceUsage,
} from "./domains/projection/index.ts";
export {
	checkDependencies,
	compareGaps,
	explainRelevance,
	findResearchGaps,
	traceInfluence,
} from "./domains/reasoning/index.ts";
export { assessOutcome, compareScenarios } from "./domains/scenarios/index.ts";
export {
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
