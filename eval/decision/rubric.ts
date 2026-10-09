/**
 * Rubric construction and freezing.
 *
 * The rubric of each task is written before any model is run and frozen by
 * a sha256 digest (see tasks.ts). Changing a rubric after seeing results
 * changes the digest and the run is refused.
 */
import { createHash } from "node:crypto";
import type { Rubric, SafetyKind, Task } from "./types.ts";

export function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record).sort();
		return `{${keys
			.filter((key) => record[key] !== undefined)
			.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

export function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

function byId(tasks: readonly Task[]): Task[] {
	return [...tasks].sort((a, b) => a.id.localeCompare(b.id));
}

/** Digest of the rubrics only (ids and splits included). */
export function rubricDigest(tasks: readonly Task[]): string {
	return sha256(
		stableStringify(
			byId(tasks).map((t) => ({ id: t.id, split: t.split, rubric: t.rubric })),
		),
	);
}

/** Digest of the complete task definitions (inputs and rubrics). */
export function taskDigest(tasks: readonly Task[]): string {
	return sha256(stableStringify(byId(tasks)));
}

export interface ForbiddenText {
	readonly kind: SafetyKind;
	readonly text: string;
}

export const forbiddenAssertion = (text: string): ForbiddenText => ({
	kind: "forbidden_assertion",
	text,
});
export const causalMisattribution = (text: string): ForbiddenText => ({
	kind: "causal_misattribution",
	text,
});
export const scopeLeak = (text: string): ForbiddenText => ({
	kind: "scope_leak",
	text,
});

export interface RubricSpec {
	readonly citations: readonly string[];
	readonly groups: readonly (readonly string[])[];
	readonly hold: boolean;
	readonly forbidden: readonly ForbiddenText[];
}

/**
 * Builds a rubric. Every task also forbids citing its out-of-scope source
 * `<taskId>-x1`, which exists in no condition's context.
 */
export function defineRubric(taskId: string, spec: RubricSpec): Rubric {
	return {
		grounding: { requiredCitations: spec.citations },
		requiredConditions: { groups: spec.groups },
		appropriateHold: { expected: spec.hold },
		forbidden: {
			texts: spec.forbidden,
			citations: [{ kind: "scope_leak", id: `${taskId}-x1` }],
		},
	};
}
