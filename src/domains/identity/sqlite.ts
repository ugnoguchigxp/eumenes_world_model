/** Synchronous persistence entry of the identity domain. */
import { migration001 } from "./repository/migrations/001.ts";
import type { MigrationDescriptor } from "../../infrastructure/sqlite/db.ts";

export const identityMigrations: readonly MigrationDescriptor[] = Object.freeze(
	[migration001],
);

export {
	applyMergePlan,
	applySplitPlan,
	deleteEntities,
	findAliasCandidates,
	getEntity,
	listEvents,
	listMergedMembers,
	listMergedMembersOf,
	registerEntity,
} from "./repository/entities.ts";
export type {
	AliasCandidates,
	DeleteEntitiesResult,
	EntityRejectCode,
	EntityWriteResult,
	IdentityEvent,
	NewEntity,
} from "./repository/entities.ts";
