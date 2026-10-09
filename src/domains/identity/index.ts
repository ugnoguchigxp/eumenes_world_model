/** Identity pure API: resolution and reversible merge/split planning. */
export { resolveEntity } from "./service/resolve.ts";
export { planMerge } from "./service/merge.ts";
export { planSplit } from "./service/split.ts";
export {
	normalizeAlias,
	type Entity,
	type ExternalRef,
	type IdentityRejectCode,
	type MemberSnapshot,
	type MergePlan,
	type MergeRequest,
	type MergeResult,
	type Resolution,
	type ResolveQuery,
	type ResolveRequest,
	type SplitPlan,
	type SplitRequest,
	type SplitResult,
} from "./contracts/index.ts";
