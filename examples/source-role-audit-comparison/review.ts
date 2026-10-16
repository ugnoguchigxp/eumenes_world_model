import type { AnswerContext } from "../multi-source-comparison/world.ts";
import type { Question } from "../multi-source-comparison/fixtures.ts";
import { inspect, type Response } from "../audit-repair-comparison/review.ts";
export { inspect, type Response } from "../audit-repair-comparison/review.ts";
import {
	auditPrompt,
	auditSchema,
	validateAudit,
	type RoleAudit,
} from "./audit.ts";
import { presentation, schemaFor, type Arm } from "./protocol.ts";
export function reviewPrompt(
	q: Question,
	ctx: AnswerContext,
	raw: string,
	arm: "control" | "role",
	roleAudit: RoleAudit,
) {
	return JSON.stringify({
		task: "Review the previous answer against the original evidence and return a complete answer.",
		originalInput: JSON.parse(presentation(q, ctx)),
		previousAnswer: raw,
		structuralAudit: inspect(raw, ctx),
		...(arm === "role" ? { sourceRoleAudit: roleAudit } : {}),
	});
}
type Run = (prompt: string, schema: unknown) => Promise<Response>;
export async function review(
	q: Question,
	ctx: AnswerContext,
	initial: Response,
	arm: Arm,
	auditRun: (
		stage: "initial" | "final",
		prompt: string,
		schema: unknown,
	) => Promise<Response>,
	run: Run,
) {
	const initialAudit = inspect(initial.raw, ctx);
	if (arm === "baseline")
		return {
			...initial,
			initialAudit,
			finalAudit: initialAudit,
			initialRole: null,
			finalRole: null,
			repairAttempted: false,
			accepted: initialAudit.passed,
			outcome: "baseline" as const,
		};
	const first = await auditRun(
		"initial",
		auditPrompt(q, ctx, initial.raw),
		auditSchema,
	);
	const initialRole = validateAudit(first.raw, initial.raw, ctx);
	const cost = {
		inputTokens: initial.inputTokens + first.inputTokens,
		outputTokens: initial.outputTokens + first.outputTokens,
		latencyMs: initial.latencyMs + first.latencyMs,
	};
	if (initialAudit.passed && initialRole.passed)
		return {
			...initial,
			...cost,
			initialAudit,
			finalAudit: initialAudit,
			initialRole,
			finalRole: initialRole,
			repairAttempted: false,
			accepted: true,
			outcome: "unchanged" as const,
		};
	const revised = await run(
		reviewPrompt(q, ctx, initial.raw, arm, initialRole),
		schemaFor(ctx),
	);
	const finalAudit = inspect(revised.raw, ctx);
	const last = await auditRun(
		"final",
		auditPrompt(q, ctx, revised.raw),
		auditSchema,
	);
	const finalRole = validateAudit(last.raw, revised.raw, ctx);
	const accepted = finalAudit.passed && (arm === "control" || finalRole.passed);
	return {
		...revised,
		inputTokens: cost.inputTokens + revised.inputTokens + last.inputTokens,
		outputTokens: cost.outputTokens + revised.outputTokens + last.outputTokens,
		latencyMs: cost.latencyMs + revised.latencyMs + last.latencyMs,
		initialAudit,
		finalAudit,
		initialRole,
		finalRole,
		repairAttempted: true,
		accepted,
		outcome: accepted ? ("reviewed" as const) : ("rejected" as const),
	};
}
