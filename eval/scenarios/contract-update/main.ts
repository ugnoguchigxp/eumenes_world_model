/** Offline local acceptance of wiring only; not real-model or product-host acceptance. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openTestStore } from "../../../test/support/sqlite-store.ts";
import {
	auditRepresentation,
	singleQuoteRepresentation,
} from "../../api-quality/contract-audit.ts";
import { loadQuality, fixtureDigests } from "../../api-quality/dataset.ts";
import { sourceSnapshot } from "../../measurement/run.ts";
import { cycleFixture, GOAL } from "./fixture.ts";
import {
	correctCycle,
	observeCycle,
	prepareCycle,
	readCycle,
	replayObservation,
	usage,
} from "./runner.ts";

if (import.meta.main) {
	const [directory, ...extra] = process.argv.slice(2);
	if (!directory || extra.length)
		throw new Error(
			"Usage: bun eval/scenarios/contract-update/main.ts <new-output>",
		);
	mkdirSync(directory, { recursive: false });
	const source = sourceSnapshot(resolve(import.meta.dir, "../../.."));
	const audit = auditRepresentation(
		loadQuality("independent"),
		singleQuoteRepresentation,
	);
	const f = cycleFixture(audit),
		store = openTestStore();
	try {
		const initial = prepareCycle(store, f);
		const observed = observeCycle(store, f);
		const oldUsage = usage(store, f, initial.before.receipt);
		const staleCorrection = correctCycle(store, f, initial.before.receipt);
		const correction = correctCycle(store, f, observed.context.receipt);
		const after = readCycle(store, f);
		const replay = replayObservation(store, f);
		const finalUsage = usage(store, f, after.receipt);
		const finalSource = sourceSnapshot(resolve(import.meta.dir, "../../.."));
		const checks = {
			actualAuditConflict: audit.issues.length === 1,
			oldContextBlocked: oldUsage.status === "blocked",
			staleProposalBlocked: staleCorrection.status === "blocked",
			correctionApplied: correction.status === "applied",
			freshDecision: after.slice.units.some(
				(u) => u.assertionId === "next-step" && u.revision === 4,
			),
			freshContextUsable: finalUsage.status === "valid",
			replayNoOp: replay.status === "no_op",
			sourceStable: source.digest === finalSource.digest,
		};
		const report = {
			protocol: "contract-decision-cycle/1",
			status: Object.values(checks).every(Boolean) ? "passed" : "failed",
			modelCalls: 0,
			newApiUsd: 0,
			legacyAcceptance: "unchanged; unaccepted",
			checks,
			evidence: {
				audit: "actual offline evaluator over frozen references",
				persistence:
					"real temporary file SQLite/WAL with host-owned transactions",
				semanticDecisions:
					"handwritten fixture proposals with explicit fixture-host approvals",
				externalHost: "not exercised",
				claudeLunaDecisionQuality: "not measured",
			},
			goal: GOAL,
			documents: f.documents,
			source,
			fixtureDigests,
			audit,
			before: initial.before,
			prediction: initial.prediction,
			observed,
			correction,
			staleCorrection,
			after,
			replay,
		};
		writeFileSync(
			join(directory, "cycle.json"),
			JSON.stringify(report, null, 2) + "\n",
			{ flag: "wx" },
		);
		console.log(
			JSON.stringify({
				status: report.status,
				checks,
				modelCalls: 0,
				newApiUsd: 0,
			}),
		);
		if (report.status !== "passed") process.exitCode = 1;
	} finally {
		store.close();
	}
}
