import type { AnswerContext } from "../multi-source-comparison/world.ts";
import type { Question } from "../multi-source-comparison/fixtures.ts";
import { inspect, type Response } from "../audit-repair-comparison/review.ts";
export { inspect, type Response } from "../audit-repair-comparison/review.ts";
import { presentation, schemaFor, type Arm } from "./protocol.ts";
export function reviewPrompt(
	question: Question,
	context: AnswerContext,
	raw: string,
) {
	return JSON.stringify({
		task: "Review the previous answer against the original evidence and return a complete answer.",
		originalInput: JSON.parse(presentation(question, context)),
		previousAnswer: raw,
		structuralAudit: inspect(raw, context),
	});
}
export async function review(
	question: Question,
	context: AnswerContext,
	initial: Response,
	arm: Arm,
	run: (prompt: string, schema: unknown) => Promise<Response>,
) {
	const initialAudit = inspect(initial.raw, context);
	if (arm === "baseline")
		return {
			...initial,
			initialAudit,
			finalAudit: initialAudit,
			repairAttempted: false,
			accepted: initialAudit.passed,
			outcome: "baseline" as const,
		};
	const revised = await run(
		reviewPrompt(question, context, initial.raw),
		schemaFor(context),
	);
	const finalAudit = inspect(revised.raw, context);
	return {
		...revised,
		inputTokens: initial.inputTokens + revised.inputTokens,
		outputTokens: initial.outputTokens + revised.outputTokens,
		latencyMs: initial.latencyMs + revised.latencyMs,
		initialAudit,
		finalAudit,
		repairAttempted: true,
		accepted: finalAudit.passed,
		outcome: finalAudit.passed ? ("reviewed" as const) : ("rejected" as const),
	};
}
