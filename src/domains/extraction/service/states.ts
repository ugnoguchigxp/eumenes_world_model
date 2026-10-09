import {
	sameScope,
	type ScopeRef,
	type SourceRef,
	type SourceState,
} from "../../../contracts/index.ts";

/** The available state exactly matching a source ref inside the Scope. */
export function findState(
	scope: ScopeRef,
	ref: SourceRef,
	states: readonly SourceState[],
): SourceState | undefined {
	return states.find(
		(s) =>
			sameScope(scope, s) &&
			s.namespace === ref.namespace &&
			s.kind === ref.kind &&
			s.id === ref.id &&
			s.representation === ref.representation &&
			s.revision === ref.revision &&
			s.digest === ref.digest &&
			s.status === "available",
	);
}
