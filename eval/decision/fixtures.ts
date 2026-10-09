/**
 * Fixture providers. They simulate a reader that restates the context it is
 * given, so results depend only on what each condition supplies. They exist
 * to test the harness (A50 pure/fixture evidence) and say nothing about a
 * real model.
 *
 * CEILING WARNING: a restating reader scores well exactly because the World
 * claims were written to contain the rubric phrases. A fixture pass shows
 * the ceiling of mere context copying, not that World is useful. The
 * memory-plain-facts condition (same statements, no framing) is the control.
 * This fixture consumes World metadata mechanically (supersedes, holdUntil),
 * so its World-versus-plain-facts difference is a harness check, not
 * evidence about framing.
 *
 * behaviors:
 *   good      restates context faithfully; conditional claims replace the
 *             unconditional memory they narrow.
 *   leaky     like good, but the World condition also cites and repeats an
 *             out-of-scope source (scope leak).
 *   causal    like good, but the World condition asserts a causal claim the
 *             rubric forbids (causal misattribution).
 *   degraded  like good, but the World condition drops its citations and
 *             keeps only the first statement (worse than Memory-only).
 */
import { estimateTokens, renderItem } from "./context.ts";
import type {
	ContextItem,
	Provider,
	ProviderOutput,
	ProviderRequest,
	SafetyKind,
	Task,
} from "./types.ts";

export const fixtureBehaviors = [
	"good",
	"leaky",
	"causal",
	"degraded",
] as const;
export type FixtureBehavior = (typeof fixtureBehaviors)[number];

function restate(context: readonly ContextItem[]): {
	text: string;
	hold: boolean;
} {
	const superseded = new Set(context.flatMap((i) => i.supersedes ?? []));
	const lines: string[] = [];
	let hold = false;
	for (const item of context) {
		if (superseded.has(item.id)) continue;
		if (item.kind === "world") {
			lines.push(`${item.text}（条件: ${item.conditions}）`);
			if (item.holdUntil !== undefined) {
				hold = true;
				lines.push(`${item.holdUntil}まで断定せず保留する。`);
			}
		} else {
			lines.push(item.text);
		}
	}
	return { text: lines.join("\n"), hold };
}

function trapFor(task: Task, kind: SafetyKind): string | undefined {
	return task.rubric.forbidden.texts.find((t) => t.kind === kind)?.text;
}

export function createFixtureProvider(
	behavior: FixtureBehavior,
	tasks: readonly Task[],
): Provider {
	const byId = new Map(tasks.map((t) => [t.id, t]));
	return {
		id: `fixture-${behavior}`,
		kind: "fixture",
		model: `fixture-${behavior}`,
		async complete(request: ProviderRequest): Promise<ProviderOutput> {
			const task = byId.get(request.taskId);
			if (task === undefined) throw new Error("unknown task");
			const world = request.condition === "memory-world";
			let { text, hold } = restate(request.context);
			let citations = request.context.map((i) => i.id);
			if (world && behavior === "degraded") {
				text = text.split("\n")[0] ?? "";
				hold = false;
				citations = [];
			}
			if (world && behavior === "leaky") {
				const trap = trapFor(task, "scope_leak");
				if (trap !== undefined) {
					text = `${text}\n${trap}`;
					citations = [...citations, `${task.id}-x1`];
				}
			}
			if (world && behavior === "causal") {
				const trap = trapFor(task, "causal_misattribution");
				if (trap !== undefined) text = `${text}\n${trap}`;
			}
			return {
				text,
				citations,
				hold,
				corrections: 0,
				inputTokens: estimateTokens(
					[request.question, ...request.context.map(renderItem)].join("\n"),
				),
				outputTokens: estimateTokens(text),
			};
		},
	};
}
