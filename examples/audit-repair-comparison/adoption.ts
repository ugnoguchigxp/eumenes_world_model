import { summarize, type Cell } from "./results.ts";
import { questions, packets, regressions } from "./fixtures.ts";
import { design } from "./protocol.ts";
export function adoption(cells: readonly Cell[]) {
	const s = summarize(cells, questions);
	const candidate = cells.filter((c) => c.arm === "audit");
	const conditions = {
		complete:
			cells.length === design.plannedEndpoints &&
			cells.every((c) => c.status === "answered"),
		historicalRepairs: regressions
			.filter((r) => r.expectedTrigger)
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
		passingPreserved: regressions
			.filter((r) => !r.expectedTrigger)
			.every((r) =>
				[0, 1].every((repeat) =>
					candidate.some(
						(c) =>
							c.questionId === r.question.id &&
							c.repeat === repeat &&
							c.raw === r.seedRaw &&
							!c.review?.repairAttempted,
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
	const feedbackAdvantage =
		s.unseen.pairs.versusControl.better > s.unseen.pairs.versusControl.worse;
	const decisionPreservedAgainstControl = candidate.every((c) => {
		const b = cells.find(
			(b) =>
				b.questionId === c.questionId &&
				b.repeat === c.repeat &&
				b.arm === "control",
		);
		return !b?.score?.decisionCorrect || !!c.score?.decisionCorrect;
	});
	return {
		retained,
		preferred: retained && feedbackAdvantage && decisionPreservedAgainstControl,
		conditions,
		feedbackAdvantage,
		decisionPreservedAgainstControl,
	};
}
