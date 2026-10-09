/**
 * The only import point of Memory's public types (contract C3). Types come from
 * the pinned vendor distribution; never redefine them by hand.
 */
import type {
	AccessContext,
	ByteRange,
	SourceRef,
	SourceState,
	SourceStatus,
} from "eumenes-memory";

export type { AccessContext, ByteRange, SourceRef, SourceState, SourceStatus };

/**
 * Host-verified view of current source states. SourceRef alone carries no
 * owner Scope; principal/scopeKey/status/revision come from SourceState.
 */
export interface SourceSnapshot {
	readonly states: readonly SourceState[];
}
