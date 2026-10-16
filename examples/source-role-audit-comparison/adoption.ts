import { summarize, type Cell } from "./results.ts";
import { questions, packets } from "./fixtures.ts";
import { design } from "./protocol.ts";
export function adoption(cells: readonly Cell[]) {
	const candidate = cells.filter((c) => c.arm === "role");
	const s = summarize(cells, questions);
	const complete =
		cells.length === design.plannedEndpoints &&
		new Set(cells.map((c) => `${c.questionId}:${c.repeat}:${c.arm}`)).size ===
			design.plannedEndpoints &&
		cells.every((c) => c.status === "answered");
	const detection = {
		complete,
		knownCaught: [0, 1].every((repeat) =>
			candidate.some(
				(c) =>
					c.questionId === "SR01" &&
					c.repeat === repeat &&
					c.review?.initialRole?.reviews.some(
						(r) => r.sourceId === "DT2" && r.verdict === "inapplicable",
					),
			),
		),
		noFalseFlag: candidate.every((c) => {
			const q = questions.find((q) => q.id === c.questionId)!;
			return (
				c.review?.initialRole?.reviews.every(
					(r) =>
						!q.expected.governingSources.includes(r.sourceId) ||
						r.verdict === "applicable",
				) === true
			);
		}),
		noFalseRejection: candidate.every(
			(c) => !c.score?.primaryCorrect || c.review?.accepted,
		),
		unseenCatch: candidate.some((c) => {
			const q = questions.find((q) => q.id === c.questionId)!;
			return (
				c.suite === "unseen" &&
				c.review?.initialAudit.passed &&
				c.review.initialRole?.reviews.some(
					(r) =>
						r.verdict === "inapplicable" &&
						!q.expected.governingSources.includes(r.sourceId),
				)
			);
		}),
	};
	const repairs = {
		complete,
		knownRepaired: [0, 1].every((repeat) =>
			candidate.some(
				(c) =>
					c.questionId === "SR01" &&
					c.repeat === repeat &&
					c.score?.primaryCorrect &&
					c.review?.accepted,
			),
		),
		passingPreserved: candidate
			.filter((c) => c.questionId === "SR02" || c.questionId === "SR03")
			.every((c) => c.score?.primaryCorrect && !c.review?.repairAttempted),
		noRegression: candidate.every((c) => {
			const b = cells.find(
				(b) =>
					b.arm === "baseline" &&
					b.questionId === c.questionId &&
					b.repeat === c.repeat,
			);
			return (
				(!b?.score?.primaryCorrect || c.score?.primaryCorrect) &&
				(!b?.score?.decisionCorrect || c.score?.decisionCorrect) &&
				(!c.score?.falseAllow || b?.score?.falseAllow) &&
				(!c.score?.retiredSourceLeak || b?.score?.retiredSourceLeak)
			);
		}),
		unseenImprovement:
			s.unseen.pairs.versusBaseline.better >
			s.unseen.pairs.versusBaseline.worse,
		multiplePackets:
			packets.filter(
				(p) =>
					s.byPacket[p.id]!.pairs.versusBaseline.better >
					s.byPacket[p.id]!.pairs.versusBaseline.worse,
			).length >= 2,
	};
	const guardRetained = Object.values(detection).every(Boolean);
	const repairRetained = guardRetained && Object.values(repairs).every(Boolean);
	const feedbackAdvantage =
		s.unseen.pairs.versusControl.better > s.unseen.pairs.versusControl.worse;
	const controlPreserved = candidate.every((c) => {
		const b = cells.find(
			(b) =>
				b.arm === "control" &&
				b.questionId === c.questionId &&
				b.repeat === c.repeat,
		);
		return (
			(!b?.score?.primaryCorrect || c.score?.primaryCorrect) &&
			(!b?.score?.decisionCorrect || c.score?.decisionCorrect)
		);
	});
	return {
		guardRetained,
		repairRetained,
		preferred: repairRetained && feedbackAdvantage && controlPreserved,
		detection,
		repairs,
		feedbackAdvantage,
		controlPreserved,
	};
}
