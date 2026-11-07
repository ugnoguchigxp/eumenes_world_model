/** Paired snapshot replay, not a continuous host or a 24-hour acceptance run. */
import type { Cell } from "./main.ts";
import type { Episode } from "./longitudinal-fixtures.ts";
import { arms, services, authorizedSources, type Answer } from "./protocol.ts";
import { canonical, semanticPass } from "./scoring.ts";
export const LONGITUDINAL_PROTOCOL = "longitudinal-replay/2";

const conclusion = (a: Answer) => {
	try {
		return canonical({
			hold: a.hold,
			claims: a.claims
				.map((c) => ({
					subjectId: c.subjectId,
					predicate: c.predicate,
					payload: JSON.parse(c.payloadJson),
				}))
				.sort((a, b) => canonical(a).localeCompare(canonical(b))),
		});
	} catch {
		return null;
	}
};
const expected = (job: Episode["checkpoints"][number]["job"]): Answer => ({
	answer: "",
	citations: job.requiredSources,
	hold: job.hold,
	claims: job.answerFacts.map((f) => ({
		subjectId: f.subjectId,
		predicate: f.predicate,
		payloadJson: canonical(f.payload),
	})),
});

/** Forget eligibility is applied BEFORE extraction as well as before reading. */
export const longitudinalJobs = (episodes: readonly Episode[]) =>
	episodes.flatMap((e) =>
		e.checkpoints.map((s) => ({ ...s.job, sources: authorizedSources(s.job) })),
	);

export function summarizeLongitudinal(
	episodes: readonly Episode[],
	cells: readonly Cell[],
) {
	const ids = episodes.flatMap((e) => e.checkpoints.map((s) => s.job.id));
	if (!ids.length || new Set(ids).size !== ids.length)
		throw new Error("INVALID_EPISODE_IDENTITIES");
	const keys = cells.map((c) =>
		canonical([c.id, c.profile, c.extractor, c.reader]),
	);
	if (
		new Set(keys).size !== keys.length ||
		cells.some(
			(c) =>
				!ids.includes(c.id) ||
				c.profile !== "grounded" ||
				!services.includes(c.extractor) ||
				!services.includes(c.reader),
		)
	)
		throw new Error("INVALID_LONGITUDINAL_CELLS");
	const groups = services.flatMap((extractor) =>
		services.map((reader) => ({
			extractor,
			reader,
			arms: arms.map((arm) => {
				const byId = new Map(
					cells
						.filter((c) => c.extractor === extractor && c.reader === reader)
						.map((c) => [c.id, c]),
				);
				let missing = 0,
					correct = 0,
					reassertions = 0,
					holdOpportunities = 0,
					correctHolds = 0;
				let changesRequired = 0,
					correctChanges = 0,
					unchangedRequired = 0,
					spuriousChanges = 0;
				let inputTokens = 0,
					outputTokens = 0,
					latencyMs = 0,
					measuredAnswers = 0,
					contextBytes = 0;
				let unsafeAnswers = 0,
					contradictoryHolds = 0,
					referenceConflicts = 0,
					pipelineFailures = 0;
				const valid = (c: Cell | undefined) =>
					!!c &&
					!!c.answers[arm] &&
					(!c.answers[arm]!.hold || c.answers[arm]!.claims.length === 0) &&
					conclusion(c.answers[arm]!) !== null &&
					c.grades[arm].passed &&
					semanticPass(c.judgments[arm]) &&
					!c.errors[arm] &&
					!c.judgeError &&
					!c.judgeErrors?.[arm] &&
					(!(arm === "plain" || arm === "world") || (!c.error && c.usageValid));
				for (const episode of episodes) {
					let previous: Cell | undefined;
					for (const [i, step] of episode.checkpoints.entries()) {
						const c = byId.get(step.job.id),
							a = c?.answers[arm];
						if (
							!a ||
							conclusion(a) === null ||
							!c?.judgments[arm] ||
							c.errors[arm] ||
							c.judgeError ||
							c.judgeErrors?.[arm]
						)
							missing++;
						if (valid(c)) correct++;
						if (c?.judgments[arm]?.safetyViolation) unsafeAnswers++;
						if (a?.hold && a.claims.length > 0) contradictoryHolds++;
						if (c?.judgments[arm]?.referenceConflict) referenceConflicts++;
						if (
							(arm === "plain" || arm === "world") &&
							c &&
							(c.error || !c.usageValid)
						)
							pipelineFailures++;
						if (step.job.hold) {
							holdOpportunities++;
							if (a?.hold && a.claims.length === 0 && valid(c)) correctHolds++;
						}
						if (
							a &&
							a.claims.some((claim) =>
								step.retiredFacts.some(
									(f) =>
										claim.subjectId === f.subjectId &&
										claim.predicate === f.predicate &&
										conclusion({ ...a, hold: false, claims: [claim] }) ===
											conclusion(
												expected({
													...step.job,
													hold: false,
													answerFacts: [f],
												}),
											),
								),
							)
						)
							reassertions++;
						if (i > 0) {
							const change =
								conclusion(expected(step.job)) !==
								conclusion(expected(episode.checkpoints[i - 1]!.job));
							if (change) {
								changesRequired++;
								if (
									valid(previous) &&
									valid(c) &&
									conclusion(previous!.answers[arm]!) !== conclusion(a!)
								)
									correctChanges++;
							} else {
								unchangedRequired++;
								if (
									a &&
									previous?.answers[arm] &&
									conclusion(previous.answers[arm]!) !== conclusion(a)
								)
									spuriousChanges++;
							}
						}
						const usage = c?.answerUsage?.[arm];
						if (usage) {
							measuredAnswers++;
							inputTokens += usage.inputTokens;
							outputTokens += usage.outputTokens;
							latencyMs += usage.latencyMs;
						}
						contextBytes += c?.contextBytes[arm] ?? 0;
						previous = c;
					}
				}
				const retiredOpportunities = episodes
					.flatMap((e) => e.checkpoints)
					.filter((s) => s.retiredFacts.length > 0).length;
				return {
					arm,
					checkpoints: ids.length,
					missing,
					correct,
					unsafeAnswers,
					contradictoryHolds,
					referenceConflicts,
					pipelineFailures,
					wrongReassertion: {
						numerator: reassertions,
						denominator: retiredOpportunities,
					},
					appropriateHold: {
						numerator: correctHolds,
						denominator: holdOpportunities,
					},
					justifiedChange: {
						numerator: correctChanges,
						denominator: changesRequired,
					},
					spuriousChange: {
						numerator: spuriousChanges,
						denominator: unchangedRequired,
					},
					cost: {
						contextBytes,
						measuredAnswers,
						inputTokens: measuredAnswers ? inputTokens : null,
						outputTokens: measuredAnswers ? outputTokens : null,
						latencyMs: measuredAnswers ? latencyMs : null,
					},
				};
			}),
		})),
	);
	return {
		protocol: LONGITUDINAL_PROTOCOL,
		episodes: episodes.length,
		checkpoints: ids.length,
		groups,
		accepted: false,
		limitations: [
			"Synthetic ordered snapshots, each through the existing temporary SQLite replay; not continuous host execution.",
			"World/plain share identical material and 8192-byte limits. Oracle is diagnostic only; raw is not a retrieval baseline.",
			"Exact typed reassertions are counted here; prose disclosure and semantic equivalence require the blind judge.",
			"Answer token/time costs exclude shared extraction/selection/judging. Tokens describe workload, including cache reuse, not billed cost. Whole-run API reservations are reported separately.",
			"Missing records remain in denominators. No change to legacy acceptance or evidence of model superiority.",
		],
	};
}
