import type { Tri } from "../../src/index.ts";
import type { Packet, Decision } from "../multi-source-comparison/fixtures.ts";
import {
	packets as heldoutPackets,
	questions as heldoutQuestions,
	observation,
	type HoldoutQuestion,
} from "../linked-answer-holdout/fixtures.ts";
import { packets as rolePackets } from "../source-role-comparison/fixtures.ts";
import inputs from "./inputs.json";
export const VERSION = "extraction-fallback-v1";
export interface Scenario {
	id: string;
	packet: Packet;
	raw: string;
	kind: "observed" | "injected" | "normal";
	fault: string;
	questions: HoldoutQuestion[];
}
const drone = heldoutPackets.find((p) => p.id === "drone-school")!;
const air = rolePackets.find((p) => p.id === "airlock")!;
const studio = rolePackets.find((p) => p.id === "studio-access")!;
const vault = rolePackets.find((p) => p.id === "mixed-vault")!;
type Value = boolean | string | readonly [number, string];
function q(
	packet: Packet,
	id: string,
	values: Record<string, Value>,
	decision: Decision,
	assessments: Record<string, Tri>,
	support: string[] = [],
	time = Date.UTC(2026, 11, 17),
): HoldoutQuestion {
	return {
		id,
		packet: packet.id,
		asOf: time,
		question: `この状況で${packet.name}を許可できるか。`,
		observations: Object.entries(values).map(([k, v]) =>
			observation(k, v, time),
		),
		expected: {
			decision,
			governingSources: [...Object.keys(assessments), ...support],
			reason: id,
		},
		expectedAssessments: assessments,
		category: "new-fallback-question",
	};
}
// Fault injection only in evaluation fixtures. Original sources are byte-identical.
function fault(raw: string, ids: string[], kind: "empty" | "hypothetical") {
	const parsed = JSON.parse(raw);
	for (const d of parsed.documents)
		if (ids.includes(d.documentId)) {
			if (kind === "empty") d.candidates = [];
			else for (const c of d.candidates) c.modality = "hypothetical";
		}
	return JSON.stringify(parsed);
}
const droneBase = { sector: "north", instructor: true, locked: false };
const airBase = { zone: "alpha", approved: true, backup: false, locked: false };
export const scenarios: Scenario[] = [
	{
		id: "observed-proposal",
		packet: drone,
		raw: inputs["drone-school"].raw,
		kind: "observed",
		fault: "unchanged historical DS3 HYPOTHETICAL_NOT_FACT",
		questions: heldoutQuestions.filter((q) => q.packet === drone.id),
	},
	{
		id: "replacement-refused",
		packet: drone,
		raw: fault(inputs["drone-school"].raw, ["DS2"], "hypothetical"),
		kind: "injected",
		fault: "DS2 hypothetical in addition to observed DS3 refusal",
		questions: [
			q(
				drone,
				"FR01",
				{ ...droneBase, battery: [50, "percent"] },
				"allow",
				{ DS1: "satisfied" },
				[],
				Date.UTC(2026, 10, 19, 23, 59, 59, 999),
			),
			q(
				drone,
				"FR02",
				{ ...droneBase, battery: [50, "percent"] },
				"deny",
				{ DS2: "violated" },
				[],
				Date.UTC(2026, 10, 20),
			),
			q(
				drone,
				"FR03",
				{ ...droneBase, battery: [56, "percent"], locked: true },
				"deny",
				{ DS2: "violated" },
				[],
				Date.UTC(2026, 10, 22),
			),
			q(
				drone,
				"FR04",
				droneBase,
				"hold",
				{ DS2: "unknown" },
				[],
				Date.UTC(2026, 10, 22),
			),
		],
	},
	{
		id: "all-refused",
		packet: air,
		raw: fault(
			inputs.airlock.raw,
			air.documents.map((d) => d.id),
			"hypothetical",
		),
		kind: "injected",
		fault: "all candidates hypothetical",
		questions: [
			q(
				air,
				"FA01",
				{ ...airBase, level: [12, "count"] },
				"allow",
				{ AX9: "satisfied" },
				["AX1"],
			),
			q(
				air,
				"FA02",
				{ ...airBase, level: [13, "count"] },
				"deny",
				{ AX9: "violated" },
				["AX1"],
			),
			q(
				air,
				"FA03",
				{ ...airBase, backup: true },
				"allow",
				{ AX9: "satisfied" },
				["AX1"],
			),
			q(air, "FA04", { ...airBase }, "hold", { AX9: "unknown" }, ["AX1"]),
		],
	},
	{
		id: "conflict-empty",
		packet: studio,
		raw: fault(inputs["studio-access"].raw, ["DK6"], "empty"),
		kind: "injected",
		fault:
			"DK6 no candidate; equally authoritative conflicting rule remains in originals",
		questions: [
			q(
				studio,
				"FC01",
				{ registered: true, badge: false, escort: true },
				"hold",
				{ DK3: "violated", DK6: "satisfied" },
				["DK1"],
			),
			q(
				studio,
				"FC02",
				{ registered: false, badge: true, escort: true },
				"deny",
				{ DK3: "violated", DK6: "violated" },
				["DK1"],
			),
			q(
				studio,
				"FC03",
				{ registered: true, badge: true },
				"allow",
				{ DK3: "satisfied", DK6: "satisfied" },
				["DK1"],
			),
			q(
				studio,
				"FC04",
				{ registered: true, escort: false },
				"hold",
				{ DK3: "unknown", DK6: "unknown" },
				["DK1"],
			),
		],
	},
	{
		id: "normal-world",
		packet: vault,
		raw: inputs["mixed-vault"].raw,
		kind: "normal",
		fault: "none",
		questions: [
			q(
				vault,
				"FN01",
				{ hall: "u", ready: true, witness: true, quarantine: false },
				"allow",
				{ BV2: "satisfied" },
			),
			q(
				vault,
				"FN02",
				{ hall: "u", ready: true, certificate: true, quarantine: true },
				"deny",
				{ BV2: "violated" },
			),
			q(
				vault,
				"FN03",
				{ hall: "v", ready: true, certificate: false, witness: true },
				"deny",
				{ BV8: "violated" },
			),
			q(
				vault,
				"FN04",
				{ hall: "u", ready: true, certificate: false, witness: false },
				"deny",
				{ BV2: "violated" },
			),
		],
	},
];
export const design = {
	repeats: 2,
	arms: ["strict-v5", "fallback-v5"] as const,
	plannedCells: 80,
	maximumNewAnswerCalls: 48,
	newExtractionCalls: 0,
	primary:
		"decision + source set + permission assessments + output audit; failures remain in denominator",
	adoption:
		"recover every observed cell; no false allow; all injected cells primary-correct; normal contexts byte-equal and no paired regression",
	limits:
		"Synthetic sources, 4 historical questions + 16 newly authored questions on previously extracted sources. Injected failures are not natural refusal-rate estimates. No partial World graph, transport recovery, missing-original recovery, or production integration.",
};
