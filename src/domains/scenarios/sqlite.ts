/** Synchronous persistence entry of the scenarios domain. */
import { migration001 } from "./repository/migrations/001.ts";
import type { MigrationDescriptor } from "../../infrastructure/sqlite/db.ts";

export const scenariosMigrations: readonly MigrationDescriptor[] =
	Object.freeze([migration001]);

export {
	getPrediction,
	insertPrediction,
	listPredictionsByBasisAssertion,
	listPredictionsByComparison,
	listPredictionsReferencingEntity,
	type BasisAssertion,
	type InsertResult,
	type Page,
	type PredictionInput,
	type RepositoryRejection,
	type StoredPrediction,
} from "./repository/predictions.ts";
export {
	deletePredictionsAndOutcomes,
	getOutcome,
	insertOutcome,
	listOutcomesByComparison,
	type OutcomeInput,
	type StoredOutcome,
} from "./repository/outcomes.ts";
