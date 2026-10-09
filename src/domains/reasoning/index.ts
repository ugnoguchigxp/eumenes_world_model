/** Reasoning pure API: relevance, causal influence, dependencies, gaps. */
export { explainRelevance } from "./service/relevance.ts";
export { traceInfluence, composeEffect } from "./service/influence.ts";
export { checkDependencies } from "./service/dependencies.ts";
export { findResearchGaps, compareGaps, gapKinds } from "./service/gaps.ts";
export type {
	RelatedEntity,
	RelatedRelation,
	RelevanceResult,
} from "./service/relevance.ts";
export type {
	Effect,
	EffectReason,
	InfluencePath,
	InfluenceResult,
	PathEdge,
	SkipReason,
} from "./service/influence.ts";
export type {
	DependencyItem,
	DependencyReason,
	DependencyResult,
} from "./service/dependencies.ts";
export type {
	GapAnnotation,
	GapKind,
	GapResult,
	GoalReference,
	ResearchGap,
} from "./service/gaps.ts";
export * from "./contracts/index.ts";
