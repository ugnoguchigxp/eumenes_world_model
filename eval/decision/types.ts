/**
 * Shared types for the decision-quality evaluation (P5-04 / A50).
 *
 * Nothing here talks to a model, a clock or the network. Real-model access
 * is isolated behind the Provider interface and is only wired in main.ts.
 */

/**
 * memory-plain-facts is the control for World framing: the same claim
 * statements and the same evidence sources as memory-world, delivered as
 * plain facts without conditions, supersedes, hold or evidence metadata.
 */
export const conditionIds = [
	"memory-only",
	"memory-related",
	"memory-plain-facts",
	"memory-world",
] as const;
export type ConditionId = (typeof conditionIds)[number];

export const axes = [
	"grounding",
	"requiredConditions",
	"appropriateHold",
	"forbiddenAssertions",
] as const;
export type Axis = (typeof axes)[number];

/** Safety failures are never offset by averages. */
export const safetyKinds = [
	"scope_leak",
	"causal_misattribution",
	"forbidden_assertion",
] as const;
export type SafetyKind = (typeof safetyKinds)[number];

export type Split = "tuning" | "evaluation";
export type Mode = "tuning" | "evaluation";

export interface SourceItem {
	readonly id: string;
	readonly text: string;
}

/** A conditional World claim as it would be delivered to the model. */
export interface WorldClaim {
	readonly id: string;
	readonly text: string;
	/** Natural-language condition under which the claim holds. */
	readonly conditions: string;
	/** Memory/related item ids the claim is derived from. */
	readonly evidence: readonly string[];
	/** Memory items this claim narrows (unconditional version). */
	readonly supersedes?: readonly string[];
	/** Set when the claim says the answer must be held until confirmed. */
	readonly holdUntil?: string;
}

/**
 * Pre-defined rubric. Frozen by digest; the scorer never consults anything
 * but this structure and the provider output.
 */
export interface Rubric {
	/** Every id must be cited; no cited id may be absent from the context. */
	readonly grounding: { readonly requiredCitations: readonly string[] };
	/** Each group needs at least one of its phrases in the answer text. */
	readonly requiredConditions: {
		readonly groups: readonly (readonly string[])[];
	};
	/** The answer must hold exactly when expected. */
	readonly appropriateHold: { readonly expected: boolean };
	readonly forbidden: {
		readonly texts: readonly {
			readonly kind: SafetyKind;
			readonly text: string;
		}[];
		readonly citations: readonly {
			readonly kind: SafetyKind;
			readonly id: string;
		}[];
	};
}

export interface Task {
	readonly id: string;
	readonly split: Split;
	readonly scope: string;
	readonly title: string;
	readonly question: string;
	readonly memory: readonly SourceItem[];
	readonly related: readonly SourceItem[];
	readonly world: readonly WorldClaim[];
	readonly rubric: Rubric;
}

export interface ContextItem {
	readonly id: string;
	readonly kind: "memory" | "related" | "fact" | "world";
	readonly text: string;
	readonly conditions?: string;
	readonly evidence?: readonly string[];
	readonly supersedes?: readonly string[];
	readonly holdUntil?: string;
}

export interface RunSettings {
	readonly model: string;
	readonly seed: number;
	readonly temperature: number;
	readonly inputBudgetTokens: number;
}

export interface ProviderRequest {
	readonly taskId: string;
	/** For bookkeeping and fixtures. Real prompts must not mention it. */
	readonly condition: ConditionId;
	readonly scope: string;
	readonly question: string;
	readonly context: readonly ContextItem[];
	readonly settings: RunSettings;
}

export interface ProviderOutput {
	readonly text: string;
	readonly citations: readonly string[];
	readonly hold: boolean;
	/** Number of correction/regeneration rounds the provider needed. */
	readonly corrections: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
}

export interface Provider {
	readonly id: string;
	readonly kind: "fixture" | "real";
	readonly model: string;
	complete(request: ProviderRequest): Promise<ProviderOutput>;
}

export interface AxisScore {
	readonly score: 0 | 1;
	readonly reason: string;
}

export interface SafetyFailure {
	readonly kind: SafetyKind;
	readonly detail: string;
}

/**
 * A forbidden-phrase hit that the clause-level check could neither excuse
 * (negated / quoted) nor confirm as an assertion. A human decides; until
 * then it is counted as neither pass nor safety failure and blocks acceptance.
 */
export interface Adjudication {
	readonly kind: SafetyKind;
	readonly phrase: string;
	/** The sentence the phrase occurred in. */
	readonly context: string;
	readonly reason: string;
}

export interface TaskScore {
	readonly axes: Readonly<Record<Axis, AxisScore>>;
	readonly total: number;
	readonly safetyFailures: readonly SafetyFailure[];
	/** Unresolved ambiguous hits. Non-empty makes the comparison incomplete. */
	readonly adjudications: readonly Adjudication[];
}
