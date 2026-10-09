import type { PlanOutcome } from "../contracts/plan.ts";
import { planClosure } from "./closure.ts";

/**
 * Invalidation plan: every transitive dependent of the changed roots,
 * EXCLUDING the roots themselves (already changed by the caller).
 */
export function planInvalidation(input: unknown): PlanOutcome {
	return planClosure(input, false);
}
