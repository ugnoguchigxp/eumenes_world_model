import type {
	Entity,
	Observation,
	SliceUnit,
	EvaluationResult,
	SliceReceipt,
} from "../../src/index.ts";
import type { WorldOperation } from "../../src/sqlite.ts";

export interface PipelineCase {
	readonly id: string;
	readonly recordedAt?: number;
	/** Explicit fixture-host commands, never inferred from model text or gold. */
	readonly beforeReadOperations?: readonly WorldOperation[];
	readonly entities: readonly Pick<Entity, "id" | "displayName" | "aliases">[];
	readonly sources: readonly { readonly id: string; readonly text: string }[];
	/** Frozen first response, fixture-authored or explicitly recorded in dev. */
	readonly rawOutput: unknown;
	/** Explicit fixture-host decisions, independent of quote validity and gold. */
	readonly adoptIndexes: readonly number[];
	readonly queries: readonly {
		readonly id: string;
		readonly asOf: number;
		readonly maxBytes: number;
		readonly subjectIds: readonly string[];
		readonly depth?: number;
		/** Models/hosts select these indexes; the harness does no name matching. */
		readonly selectedIndexes: readonly number[];
		readonly observations: readonly Observation[];
		/** Offline scoring only; never sent to any World API or provider. */
		readonly expectedEvidenceIds: readonly string[];
	}[];
}
export interface Presentation {
	readonly receipt?: SliceReceipt;
	readonly status: string;
	readonly reasonCodes: readonly string[];
	readonly text: string;
	readonly bytes: number;
	readonly plainText: string;
	readonly plainEvidenceIds: readonly string[];
	readonly evidenceIds: readonly string[];
	readonly units: readonly SliceUnit[];
	readonly evaluations: readonly {
		readonly assertionId: string;
		readonly result: EvaluationResult;
	}[];
}
