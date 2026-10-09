/** Synchronous persistence entry of the extraction domain. */
import { migration001 } from "./repository/migrations/001.ts";
import type { MigrationDescriptor } from "../../infrastructure/sqlite/db.ts";

export const extractionMigrations: readonly MigrationDescriptor[] =
	Object.freeze([migration001]);

export {
	advanceCheckpoint,
	countCheckpointsByKindPrefix,
	deleteCheckpoint,
	discardCheckpoints,
	protectedKinds,
	feedKeyOf,
	getCheckpoint,
	getCheckpointsByKeys,
	maxFeedScopeKeys,
	type AdvanceCheckpointInput,
	type AdvanceCheckpointResult,
	type Checkpoint,
	type CheckpointRejectCode,
	type FeedRef,
} from "./repository/checkpoint.ts";
export {
	deleteInbox,
	releaseUnsettledInbox,
	getInbox,
	inboxStatuses,
	listInboxByFeed,
	markInbox,
	maxInboxDelete,
	maxInboxPage,
	recordInbox,
	type InboxEvent,
	type InboxRejectCode,
	type InboxResult,
	type InboxStatus,
	type NewInboxEvent,
} from "./repository/inbox.ts";
export {
	deleteManifests,
	getManifest,
	listManifestSourceKeys,
	listManifestsBySourceKeys,
	manifestStatuses,
	markManifest,
	maxManifestDelete,
	maxManifestLookup,
	saveManifest,
	type Manifest,
	type ManifestRejectCode,
	type ManifestResult,
	type ManifestStatus,
} from "./repository/manifests.ts";
