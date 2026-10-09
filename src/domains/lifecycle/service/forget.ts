import type { PlanOutcome } from "../contracts/plan.ts";
import { planClosure } from "./closure.ts";

/**
 * Forget plan: the closure INCLUDING the forgotten roots, over every input
 * dependency edge (cited or not). Targets come in closure order; the host
 * persists the cursor (next pending targets) before erasing so deleting edges
 * cannot lose unscanned derivatives. Budget exhaustion keeps the gate closed.
 */
export function planForget(input: unknown): PlanOutcome {
	return planClosure(input, true);
}
