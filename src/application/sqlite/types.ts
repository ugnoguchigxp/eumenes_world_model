import type {
	AccessContext,
	DependentRef,
	ScopeRef,
	SourceRef,
	SourceSnapshot,
} from "../../contracts/index.ts";
import type {
	Assertion,
	InvalidationReason,
	TransitionPlan,
} from "../../domains/assertions/index.ts";
import type { TombstoneReason } from "../../domains/lifecycle/sqlite.ts";
import type { MergePlan, SplitPlan } from "../../domains/identity/index.ts";
import type { NewEntity } from "../../domains/identity/sqlite.ts";
import type {
	OutcomeInput,
	PredictionInput,
} from "../../domains/scenarios/sqlite.ts";

/** Facts the host read in the SAME writer snapshot. Never trusted as verdict bools. */
export interface HostChecks {
	/** Host-side switch: "closed" blocks like the World ledger gate. */
	readonly gate?: "open" | "closed";
	readonly sourceSnapshot: SourceSnapshot;
	readonly forgetEpoch: string;
	readonly restoreEpoch: string;
	readonly policyRevision: string;
}

export type WorldOperation =
	| { readonly kind: "entity.register"; readonly entity: NewEntity }
	| { readonly kind: "entity.merge"; readonly plan: MergePlan }
	| { readonly kind: "entity.split"; readonly plan: SplitPlan }
	| { readonly kind: "assertion.register"; readonly assertion: Assertion }
	| {
			readonly kind: "assertion.transition";
			readonly plan: TransitionPlan;
			/** Required for (and only for) supersede. */
			readonly replacement?: Assertion;
	  }
	| { readonly kind: "prediction.register"; readonly input: PredictionInput }
	| { readonly kind: "outcome.register"; readonly input: OutcomeInput }
	/** Durable intake of one feed event; advances only the received cursor. */
	| {
			readonly kind: "inbox.receive";
			readonly feed: FeedSpec;
			readonly event: {
				readonly eventId: string;
				readonly seq: number;
				readonly payload: unknown;
			};
			readonly receivedCursor: string;
	  }
	/**
	 * Settles one received event: candidate assertions (from the explicitly
	 * selected validateCandidates handoff, built into Assertions), the input
	 * manifest, the inbox status and the applied cursor, all or nothing.
	 */
	| {
			readonly kind: "candidate.settle";
			readonly feed: FeedSpec;
			readonly eventId: string;
			/** held keeps the event pending and does not move the applied cursor. */
			readonly disposition: "applied" | "held" | "rejected";
			/** Required for "applied": ALL input dependencies, cited or not. */
			readonly manifest?: {
				readonly manifestId: string;
				readonly dependencies: readonly SourceRef[];
			};
			readonly assertions: readonly Assertion[];
			/** Required for "applied" and "rejected". */
			readonly appliedCursor?: string;
	  }
	/**
	 * Stops assertions at once (correction / input invalidation), without
	 * waiting for any new extraction. Targets are explicit and/or found by the
	 * source keys (sourceIdentityKey) they depend on; terminal ones are skipped.
	 */
	| {
			readonly kind: "invalidate";
			readonly reasonCode: InvalidationReason;
			readonly targets: readonly {
				readonly id: string;
				readonly expectedRevision: number;
			}[];
			readonly sourceKeys?: readonly string[];
	  }
	/**
	 * One bounded chunk (max 500 targets) of a forget. The first chunk closes
	 * the Scope gate. Roots are host-provided; source/state roots use
	 * sourceIdentityKey as id. Independent of World ON/OFF and of any model.
	 */
	/**
	 * Restore from an older database (steps, all in the host's transaction):
	 * begin -> register* -> reconcile* -> finish. Rebuild stands alone.
	 */
	| { readonly kind: "restore.begin" }
	| {
			readonly kind: "restore.register";
			readonly registrations: readonly {
				readonly sourceKey: string;
				readonly status: RegistrationStatus;
			}[];
	  }
	| {
			readonly kind: "restore.reconcile";
			readonly journal: {
				/** Journal head sequence the host read; a lower value than seen before is a rollback. */
				readonly seq: number;
				/** True on the last page of the journal's tombstones. */
				readonly final: boolean;
				readonly tombstones: readonly {
					readonly ref: DependentRef;
					readonly forgetId: string;
					readonly reasonCode: TombstoneReason;
				}[];
			};
	  }
	| { readonly kind: "restore.finish" }
	| { readonly kind: "rebuild" }
	| {
			readonly kind: "forget.chunk";
			readonly forgetId: string;
			readonly reasonCode: TombstoneReason;
			readonly roots: readonly DependentRef[];
	  }
	| {
			/** Reopens a Scope closed by a COMPLETE forget (not by a restore). */
			readonly kind: "forget.reopen";
			readonly forgetId: string;
			/** Host confirmed the external (Memory) deletion finished. */
			readonly externalDeletionConfirmed: boolean;
	  };

export type RegistrationStatus = "registered" | "unknown" | "tombstoned";

/** Counts and state only; never content. */
export interface RestoreProgress {
	readonly state: "pending" | "complete";
	/** Forget targets still pending in the Scope. */
	readonly pendingForget?: number;
	/** Dependencies the host reported unknown in this step. */
	readonly unknown?: number;
	/** Recorded dependencies not yet registered or tombstoned. */
	readonly unaccounted?: number;
}

export interface FeedSpec {
	/** Every Scope the feed spans; must include the operation's Scope. */
	readonly scopeKeys: readonly string[];
	readonly kind: string;
	/** Restore epoch under which the host issued the cursors; must be current. */
	readonly cursorRestoreEpoch: string;
}

export interface WorldOperationInput {
	readonly contractVersion: 1;
	readonly access: AccessContext;
	readonly scope: ScopeRef;
	readonly operationKey: string;
	/** Caller-supplied UTC epoch ms; excluded from the replay digest. */
	readonly clock: number;
	readonly hostChecks: HostChecks;
	readonly operation: WorldOperation;
}

export interface WorldReceipt {
	/** Opaque reference. Never carries content. */
	readonly ref: string;
}
/**
 * applied/no_op mean "applied inside the current host transaction", not a
 * durable commit: the host commits after its own follow-up (Memory) steps.
 */
export type WorldOperationResult =
	| {
			readonly status: "applied" | "no_op";
			readonly receipt: WorldReceipt;
			/** forget.chunk only: progress of the whole forget (metadata only). */
			readonly forget?: ForgetProgress;
			/** restore.* only. */
			readonly restore?: RestoreProgress;
	  }
	| {
			readonly status: "rejected" | "blocked";
			readonly reasonCode: string;
			readonly restore?: RestoreProgress;
	  };

/**
 * "applied" on the result means THIS chunk was applied. The forget as a whole
 * is pending until zero targets remain; the Scope gate stays closed either
 * way and is reopened only by the host/restore procedure.
 */
export interface ForgetProgress {
	readonly state: "pending" | "complete";
	readonly processed: number;
	readonly pending: number;
}

export const maxInvalidateTargets = 50;
export const WORLD_INTERPRETATION_VERSION = "ledger-v1";
/** Rebuild ceiling per Scope (configurable per call); writes are not counted. */
export const maxLedgerAssertions = 200_000;
export const maxSettleAssertions = 8;

/** Gate reason while a restore is running; a forget must never overwrite it. */
export const RESTORE_GATE_REASON = "RESTORE_IN_PROGRESS";
