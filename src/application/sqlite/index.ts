export { applyWorldOperation, type ApplyDeps } from "./apply.ts";
export {
	readAssertionHistory,
	readWorldSnapshot,
	type SnapshotCoverage,
	type WorldHistoryResult,
	type WorldSnapshotResult,
} from "./read.ts";
export { validateWorldUsage, type WorldUsageResult } from "./validate-usage.ts";
export {
	WORLD_INTERPRETATION_VERSION,
	type ForgetProgress,
	type HostChecks,
	type RegistrationStatus,
	type RestoreProgress,
	type WorldOperation,
	type WorldOperationInput,
	type WorldOperationResult,
	type WorldReceipt,
} from "./types.ts";
