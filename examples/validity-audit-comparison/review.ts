import type { AnswerContext } from "../multi-source-comparison/world.ts";
import type { Question } from "../multi-source-comparison/fixtures.ts";
import { inspect, type Response } from "../audit-repair-comparison/review.ts";
export { inspect, type Response } from "../audit-repair-comparison/review.ts";
import { auditValidity } from "./validity.ts";
import { presentation, schemaFor, type Arm } from "./protocol.ts";
export function reviewPrompt(
	q: Question,
	ctx: AnswerContext,
	raw: string,
	arm: "control" | "validity",
) {
	return JSON.stringify({
		task: "Review the previous answer against the original evidence and return a complete answer.",
		originalInput: JSON.parse(presentation(q, ctx)),
		previousAnswer: raw,
		structuralAudit: inspect(raw, ctx),
		...(arm === "validity" ? { validityAudit: auditValidity(raw, ctx) } : {}),
	});
}
export async function review(
	q: Question,
	ctx: AnswerContext,
	initial: Response,
	arm: Arm,
	run: (prompt: string, schema: unknown) => Promise<Response>,
) {
	const initialAudit = inspect(initial.raw, ctx);
	const initialValidity = auditValidity(initial.raw, ctx);
	if (arm === "baseline" || initialValidity.passed)
		return {
			...initial,
			initialAudit,
			initialValidity,
			finalAudit: initialAudit,
			finalValidity: initialValidity,
			repairAttempted: false,
			accepted:
				arm === "baseline" ? initialAudit.passed : initialValidity.passed,
			outcome:
				arm === "baseline" ? ("baseline" as const) : ("unchanged" as const),
		};
	const revised = await run(
		reviewPrompt(q, ctx, initial.raw, arm),
		schemaFor(ctx),
	);
	const finalAudit = inspect(revised.raw, ctx);
	const finalValidity = auditValidity(revised.raw, ctx);
	const accepted =
		arm === "validity" ? finalValidity.passed : finalAudit.passed;
	return {
		...revised,
		inputTokens: initial.inputTokens + revised.inputTokens,
		outputTokens: initial.outputTokens + revised.outputTokens,
		latencyMs: initial.latencyMs + revised.latencyMs,
		initialAudit,
		initialValidity,
		finalAudit,
		finalValidity,
		repairAttempted: true,
		accepted,
		outcome: accepted ? ("reviewed" as const) : ("rejected" as const),
	};
}
