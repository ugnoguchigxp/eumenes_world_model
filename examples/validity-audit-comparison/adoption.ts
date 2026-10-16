import { summarize, type Cell } from "./results.ts";
import { questions, packets, regressions } from "./fixtures.ts";
import { design } from "./protocol.ts";
export function adoption(cells: readonly Cell[]) {
	const s = summarize(cells, questions);
	const candidate = cells.filter((c) => c.arm === "validity");
	const complete =
		cells.length === design.plannedEndpoints &&
		new Set(cells.map((c) => `${c.questionId}:${c.repeat}:${c.arm}`)).size ===
			design.plannedEndpoints &&
		cells.every((c) => c.status === "answered");
	const detection = {
		complete,
		knownCaught: regressions
			.filter((r) => r.expectedInvalid)
			.every((r) =>
				[0, 1].every((repeat) =>
					candidate.some(
						(c) =>
							c.questionId === r.question.id &&
							c.repeat === repeat &&
							c.review?.initialAudit.passed &&
							c.review.initialValidity.invalidClaims.length,
					),
				),
			),
		noFalseInitialFlag: candidate.every((c) => {
			const b = cells.find(
				(b) =>
					b.arm === "baseline" &&
					b.questionId === c.questionId &&
					b.repeat === c.repeat,
			);
			return !b?.score?.primaryCorrect || c.review?.initialValidity.passed;
		}),
		noFalseRejection: candidate.every(
			(c) => !c.score?.primaryCorrect || c.review?.accepted,
		),
		unseenNewCatch: candidate.some(
			(c) =>
				c.suite === "unseen" &&
				c.review?.initialAudit.passed &&
				c.review.initialValidity.invalidClaims.length,
		),
	};
	const repair = {
		complete,
		historicalRepairs: regressions
			.filter((r) => r.expectedInvalid)
			.every((r) =>
				[0, 1].every((repeat) =>
					candidate.some(
						(c) =>
							c.questionId === r.question.id &&
							c.repeat === repeat &&
							c.score?.primaryCorrect &&
							c.review?.accepted,
					),
				),
			),
		passingPreserved: regressions
			.filter((r) => !r.expectedInvalid)
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
					b.arm === "baseline" &&
					b.questionId === c.questionId &&
					b.repeat === c.repeat,
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
			packets.filter(
				(p) =>
					s.byPacket[p.id]!.pairs.versusBaseline.better >
					s.byPacket[p.id]!.pairs.versusBaseline.worse,
			).length >= 2,
	};
	const guardRetained = Object.values(detection).every(Boolean);
	const repairRetained = guardRetained && Object.values(repair).every(Boolean);
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
			(!b?.score?.primaryCorrect || !!c.score?.primaryCorrect) &&
			(!b?.score?.decisionCorrect || !!c.score?.decisionCorrect)
		);
	});
	return {
		guardRetained,
		repairRetained,
		preferred: repairRetained && feedbackAdvantage && controlPreserved,
		detection,
		repair,
		feedbackAdvantage,
		controlPreserved,
	};
}
