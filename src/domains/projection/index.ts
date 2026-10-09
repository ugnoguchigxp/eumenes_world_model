/** Projection pure API: current-state projection, WorldSlice, usage checks. */
export { buildProjection, planScopeEpoch } from "./service/project.ts";
export { buildWorldSlice, toSliceReceipt } from "./service/slice.ts";
export { validateSliceUsage } from "./service/validate-usage.ts";
export * from "./contracts/index.ts";
