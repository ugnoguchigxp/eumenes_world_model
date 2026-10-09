/**
 * Context assembly for the four conditions, with one shared input budget.
 */
import { presentWorldClaims } from "./world-pipeline.ts";
import type { ConditionId, ContextItem, Task } from "./types.ts";

/** Deterministic token estimate (no tokenizer dependency). */
export function estimateTokens(text: string): number {
	return Math.ceil([...text].length / 2);
}

export function renderItem(item: ContextItem): string {
	const lines = [`[${item.id}] (${item.kind}) ${item.text}`];
	if (item.conditions !== undefined) lines.push(`条件: ${item.conditions}`);
	if (item.evidence !== undefined && item.evidence.length > 0) {
		lines.push(`根拠: ${item.evidence.join(", ")}`);
	}
	if (item.supersedes !== undefined && item.supersedes.length > 0) {
		lines.push(`条件付きに置き換える元: ${item.supersedes.join(", ")}`);
	}
	if (item.holdUntil !== undefined) {
		lines.push(`保留条件: ${item.holdUntil}`);
	}
	return lines.join("\n");
}

function memoryItems(task: Task): ContextItem[] {
	return task.memory.map((m) => ({
		id: m.id,
		kind: "memory" as const,
		text: m.text,
	}));
}

function relatedItems(task: Task, only?: ReadonlySet<string>): ContextItem[] {
	return task.related
		.filter((r) => only === undefined || only.has(r.id))
		.map((r) => ({ id: r.id, kind: "related" as const, text: r.text }));
}

/** World claims as the real pure pipeline presents them (throws if not ready). */
function worldItems(task: Task): ContextItem[] {
	return [...presentWorldClaims(task).items];
}

/**
 * The same claim statements as plain facts: no conditions, no supersedes, no
 * hold, no evidence list. This is the control that separates the effect of
 * World framing from the effect of merely supplying the claim text.
 */
function factItems(task: Task): ContextItem[] {
	return task.world.map((w) => ({
		id: w.id,
		kind: "fact" as const,
		text: w.text,
	}));
}

/**
 * Memory only: memory. Memory+related: memory then related.
 * Memory+plain-facts: memory, the claim statements as plain facts, and the
 * same cited sources as the World condition (identical information).
 * Memory+World: memory, conditional World claims (built through the pure
 * pipeline), and the related sources a claim cites as evidence (so the claim
 * stays traceable to its origin).
 */
export function buildContext(
	task: Task,
	condition: ConditionId,
): ContextItem[] {
	if (condition === "memory-only") return memoryItems(task);
	if (condition === "memory-related") {
		return [...memoryItems(task), ...relatedItems(task)];
	}
	const evidence = new Set(task.world.flatMap((w) => w.evidence));
	const claims =
		condition === "memory-plain-facts" ? factItems(task) : worldItems(task);
	return [...memoryItems(task), ...claims, ...relatedItems(task, evidence)];
}

export interface BudgetedContext {
	readonly kept: readonly ContextItem[];
	readonly dropped: readonly string[];
	readonly inputTokens: number;
}

/** Drops trailing items that no longer fit; order is preserved. */
export function applyBudget(
	question: string,
	items: readonly ContextItem[],
	budgetTokens: number,
): BudgetedContext {
	let used = estimateTokens(question);
	const kept: ContextItem[] = [];
	const dropped: string[] = [];
	let full = false;
	for (const item of items) {
		const cost = estimateTokens(renderItem(item));
		if (!full && used + cost <= budgetTokens) {
			kept.push(item);
			used += cost;
		} else {
			full = true;
			dropped.push(item.id);
		}
	}
	return { kept, dropped, inputTokens: used };
}
