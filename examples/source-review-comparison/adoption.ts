import { summarize, type Cell } from "./results.ts";
import { questions, packets, regressions } from "./fixtures.ts";
import { design } from "./protocol.ts";
export function adoption(cells: readonly Cell[]) {
	const s = summarize(cells, questions);
	const candidate = cells.filter((c) => c.arm === "selection");
	const conditions = {
		complete:
			cells.length === design.plannedEndpoints &&
			cells.every((c) => c.status === "answered"),
		historicalRepairs: regressions
			.filter((r) => !r.expectedCorrect)
			.every((r) =>
				[0, 1].every((repeat) =>
					candidate.some(
						(c) =>
							c.questionId === r.question.id &&
							c.repeat === repeat &&
							c.score?.primaryCorrect,
					),
				),
			),
		noPairedRegression: candidate.every((c) => {
			const b = cells.find(
				(b) =>
					b.questionId === c.questionId &&
					b.repeat === c.repeat &&
					b.arm === "baseline",
			);
			return (
				(!b?.score?.primaryCorrect || !!c.score?.primaryCorrect) &&
				(!b?.score?.decisionCorrect || !!c.score?.decisionCorrect) &&
				(!c.score?.falseAllow || !!b?.score?.falseAllow) &&
				(!c.score?.retiredSourceLeak || !!b?.score?.retiredSourceLeak)
			);
		}),
		unseenImprovement:
			s.unseen.pairs.versusBaseline.better >
			s.unseen.pairs.versusBaseline.worse,
		multiplePackets:
			packets.filter((p) => {
				const x = s.byPacket[p.id]!.pairs.versusBaseline;
				return x.better > x.worse;
			}).length >= 2,
	};
	const retained = Object.values(conditions).every(Boolean);
	const instructionAdvantage =
		s.unseen.pairs.versusControl.better > s.unseen.pairs.versusControl.worse;
	const correctnessPreservedAgainstControl = candidate.every((c) => {
		const b = cells.find(
			(b) =>
				b.questionId === c.questionId &&
				b.repeat === c.repeat &&
				b.arm === "control",
		);
		return (
			(!b?.score?.decisionCorrect || !!c.score?.decisionCorrect) &&
			(!b?.score?.primaryCorrect || !!c.score?.primaryCorrect)
		);
	});
	return {
		retained,
		preferred:
			retained && instructionAdvantage && correctnessPreservedAgainstControl,
		conditions,
		instructionAdvantage,
		correctnessPreservedAgainstControl,
	};
}
