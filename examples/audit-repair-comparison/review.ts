import {
	auditGrounding,
	parseGroundedAnswer,
} from "../multi-source-comparison/grounding.ts";
import type { AnswerContext } from "../multi-source-comparison/world.ts";
import type { Question } from "../multi-source-comparison/fixtures.ts";
import { presentation, schemaFor, type Arm } from "./protocol.ts";
export function inspect(raw: string, context: AnswerContext) {
	try {
		const audit = auditGrounding(parseGroundedAnswer(raw), context);
		return { passed: audit.passed, audit, parseError: null };
	} catch (e) {
		return {
			passed: false,
			audit: null,
			parseError: e instanceof Error ? e.message : String(e),
		};
	}
}
export type Inspection = ReturnType<typeof inspect>;
export interface Response {
	raw: string;
	inputTokens: number;
	outputTokens: number;
	latencyMs: number;
}
export function reviewPrompt(
	question: Question,
	context: AnswerContext,
	raw: string,
	arm: "control" | "audit",
) {
	return JSON.stringify({
		task: "Review the previous answer against the original evidence and return a complete answer.",
		originalInput: JSON.parse(presentation(question, context)),
		previousAnswer: raw,
		...(arm === "audit" ? { structuralAudit: inspect(raw, context) } : {}),
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
	if (arm === "baseline" || initialAudit.passed)
		return {
			...initial,
			initialAudit,
			finalAudit: initialAudit,
			repairAttempted: false,
			accepted: initialAudit.passed,
			outcome:
				arm === "baseline" ? ("baseline" as const) : ("unchanged" as const),
		};
	const revised = await run(
		reviewPrompt(question, context, initial.raw, arm),
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
		outcome: finalAudit.passed ? ("repaired" as const) : ("rejected" as const),
	};
}
