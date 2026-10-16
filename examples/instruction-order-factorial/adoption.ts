import { summarize, type Cell } from "./results.ts";
import { questions, packets, regressions } from "./fixtures.ts";
import { arms, design, type Arm } from "./protocol.ts";
export function adoption(cells: readonly Cell[]) {
	const summary = summarize(cells, questions);
	const complete =
		cells.length === design.plannedAnswers &&
		cells.every((c) => c.status === "answered");
	const net = (x: { better: number; worse: number }) => x.better - x.worse;
	const contrast = (s: typeof summary.all, arm: Arm) =>
		arm === "instruction"
			? s.contrasts.instructionAtOriginalOrder
			: arm === "order"
				? s.contrasts.orderAtOriginalInstruction
				: s.contrasts.combinedVersusBaseline;
	const candidates = Object.fromEntries(
		arms
			.filter((a) => a !== "baseline")
			.map((arm) => {
				const rows = cells.filter((c) => c.arm === arm);
				const conditions = {
					complete,
					regressionControls: regressions.every(({ question: q }) =>
						[0, 1].every((repeat) =>
							rows.some(
								(c) =>
									c.questionId === q.id &&
									c.repeat === repeat &&
									c.score?.primaryCorrect,
							),
						),
					),
					nondecreasing: [summary.regression, summary.unseen].every(
						(s) =>
							s.byArm[arm]!.primaryCorrect >=
								s.byArm.baseline!.primaryCorrect &&
							s.byArm[arm]!.decisionCorrect >=
								s.byArm.baseline!.decisionCorrect,
					),
					noFalseAllow: !rows.some((c) => c.score?.falseAllow),
					noRetiredLeak: !rows.some((c) => c.score?.retiredSourceLeak),
					unseenNetImprovement: net(contrast(summary.unseen, arm)) > 0,
					multiplePackets:
						packets.filter(
							(p) => net(contrast(summary.byPacket[p.id]!, arm)) > 0,
						).length >= 2,
				};
				return [
					arm,
					{ retained: Object.values(conditions).every(Boolean), conditions },
				];
			}),
	);
	function support(factor: "instruction" | "order") {
		const keys =
			factor === "instruction"
				? (["instructionAtOriginalOrder", "instructionAtRevisedOrder"] as const)
				: ([
						"orderAtOriginalInstruction",
						"orderAtRevisedInstruction",
					] as const);
		const pairs = keys.map((k) => summary.unseen.contrasts[k]);
		const treated =
			factor === "instruction"
				? ["instruction", "combined"]
				: ["order", "combined"];
		const controls =
			factor === "instruction"
				? ["baseline", "order"]
				: ["baseline", "instruction"];
		const conditions = {
			complete,
			nonnegativeBoth: pairs.every((p) => net(p) >= 0),
			positiveSome: pairs.some((p) => net(p) > 0),
			multiplePackets:
				packets.filter(
					(p) =>
						keys.reduce(
							(n, k) => n + net(summary.byPacket[p.id]!.contrasts[k]),
							0,
						) > 0,
				).length >= 2,
			decisionPreserved: treated.every(
				(a, i) =>
					summary.unseen.byArm[a]!.decisionCorrect >=
					summary.unseen.byArm[controls[i]!]!.decisionCorrect,
			),
			noFalseAllowOrRetiredLeak: cells
				.filter((c) => treated.includes(c.arm))
				.every((c) => !c.score?.falseAllow && !c.score?.retiredSourceLeak),
		};
		return {
			descriptiveSupport: Object.values(conditions).every(Boolean),
			conditions,
		};
	}
	return {
		candidates,
		attribution: {
			instruction: support("instruction"),
			order: support("order"),
		},
	};
}
