/** Synchronous persistence entry of the assertions domain. */
import { migration001 } from "./repository/migrations/001.ts";
import type { MigrationDescriptor } from "../../infrastructure/sqlite/db.ts";

export const assertionsMigrations: readonly MigrationDescriptor[] =
	Object.freeze([migration001]);

export {
	applyTransition,
	deleteAssertions,
	getAssertion,
	getHead,
	insertAssertion,
	listBySubject,
	listAssertionsReferencingEntities,
	listAssertionsReferencingEntity,
	listAssertionRevisionsBySubject,
	listScopeAssertions,
} from "./repository/assertions.ts";
export type {
	AssertionWriteResult,
	ListOptions,
	WriteRejectCode,
	WriteRejected,
} from "./repository/assertions.ts";
export { insertEvidence, listEvidence } from "./repository/evidence.ts";
export {
	addInput,
	getInputRevision,
	insertInputs,
	listAssertionsBySourceKeys,
	listInputSourceKeys,
} from "./repository/dependencies.ts";
