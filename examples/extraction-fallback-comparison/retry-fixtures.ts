import { scenarios as original, type Scenario } from "./fixtures.ts";
import {
	observation,
	type HoldoutQuestion,
} from "../linked-answer-holdout/fixtures.ts";
import type { Tri } from "../../src/index.ts";
import type { Decision } from "../multi-source-comparison/fixtures.ts";
type Value = boolean | string | readonly [number, string];
function q(
	packet: string,
	id: string,
	values: Record<string, Value>,
	decision: Decision,
	expectedAssessments: Record<string, Tri>,
	support: string[] = [],
): HoldoutQuestion {
	const time = Date.UTC(2026, 11, 18);
	return {
		id,
		packet,
		asOf: time,
		question: `この状況で${original.find((s) => s.packet.id === packet)!.packet.name}を許可できるか。`,
		observations: Object.entries(values).map(([k, v]) =>
			observation(k, v, time),
		),
		expected: {
			decision,
			governingSources: [...Object.keys(expectedAssessments), ...support],
			reason: id,
		},
		expectedAssessments,
		category: "second-round-unseen",
	};
}
export const newQuestions = [
	q(
		"drone-school",
		"NR01",
		{
			sector: "north",
			instructor: false,
			battery: [80, "percent"],
			locked: false,
		},
		"deny",
		{ DS2: "violated" },
	),
	q(
		"drone-school",
		"NR02",
		{
			sector: "north",
			instructor: true,
			battery: [54.9, "percent"],
			locked: false,
		},
		"deny",
		{ DS2: "violated" },
	),
	q(
		"airlock",
		"NA01",
		{
			zone: "beta",
			approved: true,
			level: [3, "count"],
			backup: false,
			locked: true,
		},
		"allow",
		{ AX4: "satisfied" },
		["AX1"],
	),
	q(
		"airlock",
		"NA02",
		{ zone: "alpha", approved: false, backup: true, locked: false },
		"deny",
		{ AX9: "violated" },
		["AX1"],
	),
	q(
		"studio-access",
		"NC01",
		{ registered: false, badge: false },
		"deny",
		{ DK3: "violated", DK6: "violated" },
		["DK1"],
	),
	q(
		"studio-access",
		"NC02",
		{ registered: true, badge: false, escort: false },
		"deny",
		{ DK3: "violated", DK6: "violated" },
		["DK1"],
	),
	q(
		"mixed-vault",
		"NN01",
		{ hall: "v", ready: true, certificate: true, quarantine: true },
		"allow",
		{ BV8: "satisfied" },
	),
	q(
		"mixed-vault",
		"NN02",
		{
			hall: "u",
			ready: false,
			certificate: true,
			witness: true,
			quarantine: false,
		},
		"deny",
		{ BV2: "violated" },
	),
];
export const retryScenarios: Scenario[] = original.map((s) => ({
	...s,
	questions: [
		...s.questions,
		...(s.id === "observed-proposal"
			? []
			: newQuestions.filter((q) => q.packet === s.packet.id)),
	],
}));
export const retryDesign = {
	repeats: 2,
	arms: ["strict-v5", "retry-v5"] as const,
	plannedCells: 112,
	maximumNewAnswerCalls: 68,
	maximumRetryExtractionCalls: 4,
	primary:
		"decision + source set + permission assessments + output audit; failures remain in denominator",
	adoption:
		"all 8 observed cells recovered; all 36 injected cells primary-correct; false allow 0; normal 12 context-identical and no paired regression; eight newly authored semantic conditions evaluated separately",
	limits:
		"Adaptive second round: original 20 questions are development cases, additional 8 have new observation combinations. Fixed cached initial extractions, at most one whole-packet re-extraction. All original sources retained; no change to v5 answers or core validation.",
};
