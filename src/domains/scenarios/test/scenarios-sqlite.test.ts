import { afterEach, describe, expect, test } from "bun:test";
import {
	openTestStore,
	type TestStore,
} from "../../../../test/support/sqlite-store.ts";
import { WorldTransactionRequiredError } from "../../../infrastructure/sqlite/db.ts";
import type { Outcome, QuantitativePrediction } from "../contracts/index.ts";
import {
	deletePredictionsAndOutcomes,
	getOutcome,
	getPrediction,
	insertOutcome,
	insertPrediction,
	listOutcomesByComparison,
	listPredictionsByBasisAssertion,
	listPredictionsByComparison,
} from "../sqlite.ts";

const scopeA = { principal: "p-a", scopeKey: "scope-a" };
const scopeB = { principal: "p-a", scopeKey: "scope-b" };
const conditions = {
	subjectId: "svc-1",
	metric: "latency",
	unit: "ms",
	statistic: "p95",
	configuration: "cfg-1",
	inputProfile: "in-1",
};
const prediction = (
	revision = 1,
	tolerance = 2,
	id = "pred-1",
): QuantitativePrediction => ({
	kind: "quantitative",
	predictionId: id,
	revision,
	comparisonId: "cmp-1",
	conditions,
	baselineRef: "base-1",
	baselineValue: 100,
	expectedWindow: { startMs: 1000, endMs: 2000 },
	expectedDirection: "decreases",
	measurementTolerance: tolerance,
	origin: "runtime_observation",
});
const outcome = (value = 90, revision = 1, id = "out-1"): Outcome => ({
	kind: "outcome",
	outcomeId: id,
	revision,
	comparisonId: "cmp-1",
	predictionRevision: 1,
	conditions,
	baselineRef: "base-1",
	window: { startMs: 1000, endMs: 2000 },
	value,
});

let store: TestStore | undefined;
afterEach(() => {
	store?.close();
	store = undefined;
});

for (const mode of ["file", "memory"] as const) {
	describe(`scenarios repository (${mode})`, () => {
		const open = () => (store = openTestStore({ mode }));

		test("A18 round trip keeps comparisonId, tolerance and basis", () => {
			const s = open();
			s.write((db) => {
				expect(
					insertPrediction(db, scopeA, {
						prediction: prediction(),
						dueAt: 2000,
						basis: { assertionId: "claim-1", revision: 1 },
					}),
				).toEqual({ status: "inserted" });
				expect(
					insertOutcome(db, scopeA, {
						predictionId: "pred-1",
						outcome: outcome(),
					}),
				).toEqual({ status: "inserted" });
			});
			s.read((db) => {
				const stored = getPrediction(db, scopeA, "pred-1", 1);
				const p = stored?.prediction as QuantitativePrediction;
				expect(p.comparisonId).toBe("cmp-1");
				expect(p.baselineValue).toBe(100);
				expect(p.measurementTolerance).toBe(2);
				expect(stored?.dueAt).toBe(2000);
				expect(stored?.basis).toEqual({ assertionId: "claim-1", revision: 1 });
				expect(getOutcome(db, scopeA, "out-1", 1)?.outcome.value).toBe(90);
				expect(
					listPredictionsByComparison(db, scopeA, "cmp-1", 10).items,
				).toHaveLength(1);
				expect(
					listPredictionsByBasisAssertion(db, scopeA, "claim-1", 10).items,
				).toHaveLength(1);
				expect(
					listOutcomesByComparison(db, scopeA, "cmp-1", 10).items,
				).toHaveLength(1);
				expect(getPrediction(db, scopeB, "pred-1", 1)).toBeUndefined();
			});
		});

		test("same payload is unchanged; changed tolerance on the same revision is rejected, new revision accepted", () => {
			const s = open();
			s.write((db) => {
				insertPrediction(db, scopeA, { prediction: prediction(), dueAt: 2000 });
				expect(
					insertPrediction(db, scopeA, {
						prediction: prediction(),
						dueAt: 2000,
					}),
				).toEqual({ status: "unchanged" });
				expect(
					insertPrediction(db, scopeA, {
						prediction: prediction(1, 5),
						dueAt: 2000,
					}),
				).toEqual({
					status: "rejected",
					reasonCode: "PREDICTION_REVISION_CONFLICT",
				});
				expect(
					insertPrediction(db, scopeA, {
						prediction: prediction(2, 5),
						dueAt: 2000,
					}),
				).toEqual({ status: "inserted" });
			});
			s.read((db) => {
				const stored = getPrediction(db, scopeA, "pred-1", 1)
					?.prediction as QuantitativePrediction;
				expect(stored.measurementTolerance).toBe(2);
			});
		});

		test("outcome needs an existing prediction of the same scope and comparison", () => {
			const s = open();
			s.write((db) => {
				expect(
					insertOutcome(db, scopeA, {
						predictionId: "pred-1",
						outcome: outcome(),
					}),
				).toEqual({ status: "rejected", reasonCode: "PREDICTION_NOT_FOUND" });
				insertPrediction(db, scopeA, { prediction: prediction(), dueAt: 2000 });
				// scope-b cannot reference the scope-a prediction
				expect(
					insertOutcome(db, scopeB, {
						predictionId: "pred-1",
						outcome: outcome(),
					}),
				).toEqual({ status: "rejected", reasonCode: "PREDICTION_NOT_FOUND" });
				expect(
					insertOutcome(db, scopeA, {
						predictionId: "pred-1",
						outcome: { ...outcome(), comparisonId: "cmp-other" },
					}),
				).toEqual({ status: "rejected", reasonCode: "COMPARISON_MISMATCH" });
				insertOutcome(db, scopeA, {
					predictionId: "pred-1",
					outcome: outcome(),
				});
				expect(
					insertOutcome(db, scopeA, {
						predictionId: "pred-1",
						outcome: outcome(99),
					}),
				).toEqual({
					status: "rejected",
					reasonCode: "OUTCOME_REVISION_CONFLICT",
				});
			});
			s.read((db) => {
				expect(getOutcome(db, scopeB, "out-1", 1)).toBeUndefined();
			});
		});

		test("A21 constraints: NULL scope and duplicate primary key are refused by SQL", () => {
			const s = open();
			s.write((db) => {
				expect(() =>
					db
						.query(
							"INSERT INTO world_prediction (principal, scope_key, id, revision, comparison_id, metric, due_at, payload_json) VALUES (NULL, 's', 'x', 1, 'c', 'm', 1, '{}')",
						)
						.run(),
				).toThrow();
				insertPrediction(db, scopeA, { prediction: prediction(), dueAt: 2000 });
				expect(() =>
					db
						.query(
							"INSERT INTO world_prediction (principal, scope_key, id, revision, comparison_id, metric, due_at, payload_json) VALUES ('p-a', 'scope-a', 'pred-1', 1, 'c', 'm', 1, '{}')",
						)
						.run(),
				).toThrow();
				expect(() =>
					db
						.query(
							"INSERT INTO world_prediction (principal, scope_key, id, revision, comparison_id, metric, due_at, payload_json) VALUES ('p-a', 'scope-a', 'y', 0, 'c', 'm', 1, '{}')",
						)
						.run(),
				).toThrow();
			});
		});

		test("A21 write outside a transaction throws WorldTransactionRequiredError", () => {
			const s = open();
			// the read connection's db is inside a read transaction; use a db-shaped object without one
			s.write((db) => {
				const noTx = {
					...db,
					inTransaction: false,
					query: db.query.bind(db),
					exec: db.exec.bind(db),
				};
				expect(() =>
					insertPrediction(noTx, scopeA, {
						prediction: prediction(),
						dueAt: 1,
					}),
				).toThrow(WorldTransactionRequiredError);
				expect(() =>
					insertOutcome(noTx, scopeA, {
						predictionId: "pred-1",
						outcome: outcome(),
					}),
				).toThrow(WorldTransactionRequiredError);
				expect(() => deletePredictionsAndOutcomes(noTx, scopeA, [])).toThrow(
					WorldTransactionRequiredError,
				);
			});
		});

		test("A23 mid-write failure rolls back the prediction and the host probe row", () => {
			const s = open();
			expect(() =>
				s.write((db) => {
					db.exec("CREATE TABLE IF NOT EXISTS host_probe (v INTEGER)");
					db.query("INSERT INTO host_probe (v) VALUES (1)").run();
					insertPrediction(db, scopeA, {
						prediction: prediction(),
						dueAt: 2000,
					});
					insertOutcome(db, scopeA, {
						predictionId: "pred-1",
						outcome: outcome(),
					});
					throw new Error("boom");
				}),
			).toThrow("boom");
			s.read((db) => {
				expect(getPrediction(db, scopeA, "pred-1", 1)).toBeUndefined();
				expect(getOutcome(db, scopeA, "out-1", 1)).toBeUndefined();
			});
		});

		test("list uses a limit+1 sentinel and reports truncation", () => {
			const s = open();
			s.write((db) => {
				for (const r of [1, 2, 3])
					insertPrediction(db, scopeA, {
						prediction: prediction(r),
						dueAt: 2000,
					});
			});
			s.read((db) => {
				const first = listPredictionsByComparison(db, scopeA, "cmp-1", 2);
				expect(first.items).toHaveLength(2);
				expect(first.truncated).toBe(true);
				const all = listPredictionsByComparison(db, scopeA, "cmp-1", 3);
				expect(all.truncated).toBe(false);
				expect(
					listPredictionsByComparison(db, scopeB, "cmp-1", 3).items,
				).toEqual([]);
			});
		});

		test("forget path deletes outcomes before predictions, only inside the scope, and is repeatable", () => {
			const s = open();
			s.write((db) => {
				insertPrediction(db, scopeA, { prediction: prediction(), dueAt: 2000 });
				insertOutcome(db, scopeA, {
					predictionId: "pred-1",
					outcome: outcome(),
				});
				insertPrediction(db, scopeB, { prediction: prediction(), dueAt: 2000 });
			});
			s.write((db) => {
				expect(
					deletePredictionsAndOutcomes(db, scopeA, [
						{ kind: "prediction", id: "pred-1", revision: 1 },
					]),
				).toEqual({ outcomes: 1, predictions: 1 });
				expect(
					deletePredictionsAndOutcomes(db, scopeA, [
						{ kind: "prediction", id: "pred-1", revision: 1 },
					]),
				).toEqual({ outcomes: 0, predictions: 0 });
			});
			s.read((db) => {
				expect(getPrediction(db, scopeA, "pred-1", 1)).toBeUndefined();
				expect(getOutcome(db, scopeA, "out-1", 1)).toBeUndefined();
				expect(getPrediction(db, scopeB, "pred-1", 1)).toBeDefined();
				expect(
					db
						.query(
							"SELECT count(*) AS n FROM world_prediction WHERE payload_json LIKE '%latency%'",
						)
						.get(),
				).toEqual({ n: 1 });
			});
		});
	});
}
