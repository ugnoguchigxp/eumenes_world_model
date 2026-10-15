/** Synchronous persistence entry of the identity domain. */
import { migration001 } from "./repository/migrations/001.ts";
import type { MigrationDescriptor } from "../../infrastructure/sqlite/db.ts";

export const identityMigrations: readonly MigrationDescriptor[] = Object.freeze(
	[migration001],
);

export {
	aliasPrefixRange,
	applyMergePlan,
	applySplitPlan,
	deleteEntities,
	filterActiveIdsByAliasPrefix,
	findAliasCandidates,
	getEntity,
	listActiveEntityIds,
	listEvents,
	listMergedMembers,
	listMergedMembersOf,
	registerEntity,
	resolveRepresentativeId,
} from "./repository/entities.ts";
export type {
	AliasCandidates,
	AliasPrefixRange,
	DeleteEntitiesResult,
	EntityRejectCode,
	EntityWriteResult,
	IdentityEvent,
	NewEntity,
} from "./repository/entities.ts";
