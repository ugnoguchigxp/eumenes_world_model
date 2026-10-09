/** Synchronous persistence entry of the lifecycle domain. */
import { migration001 } from "./repository/migrations/001.ts";
import type { MigrationDescriptor } from "../../infrastructure/sqlite/db.ts";

export const lifecycleMigrations: readonly MigrationDescriptor[] =
	Object.freeze([migration001]);

export {
	closeGate,
	getGate,
	isGateOpen,
	openGate,
	type GateState,
	type GateWriteResult,
} from "./repository/gate.ts";
export {
	getOperation,
	operationResultStatuses,
	recordOperation,
	type OperationRecord,
	type RecordOperationResult,
} from "./repository/operations.ts";
export {
	getTombstone,
	insertTombstone,
	listTombstones,
	maxTombstoneLookup,
	tombstoneReasons,
	type InsertTombstoneResult,
	type Tombstone,
	type TombstoneReason,
	type TombstoneTarget,
} from "./repository/tombstones.ts";
export {
	beginForget,
	completeForget,
	countAllPendingTargets,
	countDoneTargets,
	countPendingTargets,
	getForget,
	listPendingForgetIds,
	listPendingTargets,
	markTargetsDone,
	maxForgetChunk,
	maxForgetSave,
	recordForgetChunk,
	saveForgetTargets,
	type ForgetOperation,
	type ForgetWriteResult,
} from "./repository/forget.ts";

export { checkTargetRef, maxSourceKeyBytes } from "./repository/target-ref.ts";
