import { expect, test } from "bun:test";
import { scenarios } from "../../examples/extraction-fallback-comparison/fixtures.ts";
import { recover } from "../../examples/extraction-fallback-comparison/recovery.ts";
import {
	interpret,
	documentInputs,
	persist,
	contexts,
	answerPrompt,
} from "../../examples/multi-source-comparison/world.ts";
import { openTestStore } from "../support/sqlite-store.ts";

test("real refusal remains rejected and all original sources survive without derived claims", () => {
	for (const s of scenarios.filter((s) => s.kind !== "normal")) {
		expect(() => interpret(s.packet, s.raw)).toThrow(
			"extraction_not_one_valid_candidate",
		);
		const r = recover(s.packet, s.raw);
		expect(r.mode).toBe("source-only");
		if (r.mode !== "source-only") throw new Error("expected_recovery");
		expect(r.context.derivedView).toBeNull();
		expect(r.context.sources.map((d) => d.text)).toEqual(
			documentInputs(s.packet).map((d) => d.content),
		);
		expect("material" in r).toBe(false);
		expect(r.diagnostics.some((d) => d.status === "unavailable")).toBe(true);
	}
});
test("normal path preserves native SQLite contexts and calculations exactly", () => {
	const s = scenarios.find((s) => s.kind === "normal")!;
	const r = recover(s.packet, s.raw);
	if (r.mode !== "world") throw new Error("expected_world");
	expect(r.material).toEqual(interpret(s.packet, s.raw));
	for (const q of s.questions) {
		const context = (material: typeof r.material) => {
			const store = openTestStore();
			try {
				store.write((db) => persist(db, material, q.asOf));
				return store.read((db) => contexts(db, material, q).world);
			} finally {
				store.close();
			}
		};
		const a = context(r.material),
			b = context(interpret(s.packet, s.raw));
		expect(a).toEqual(b);
		for (const [id, result] of Object.entries(q.expectedAssessments)) {
			const unit = a.derivedView.slice.units.find((u) =>
				u.sources.some((s) => s.id === id),
			)!;
			expect(
				a.derivedView.evaluations.find(
					(e) => e.assertionId === unit.assertionId,
				)?.result,
			).toBe(result);
		}
	}
});
test("recovery does not mask malformed JSON, missing sources, broken bindings or invalid later references", () => {
	const s = scenarios[0]!;
	expect(() => recover(s.packet, "refused")).toThrow();
	const change = (fn: (value: any) => void) => {
		const v = JSON.parse(s.raw);
		fn(v);
		return () => recover(s.packet, JSON.stringify(v));
	};
	expect(change((v) => v.documents.pop())).toThrow("extraction_document_count");
	expect(change((v) => (v.documents[2].documentId = "wrong"))).toThrow(
		"extraction_document_order",
	);
	expect(change((v) => (v.documents[2].contradicts = ["unknown"]))).toThrow(
		"invalid_conflict_reference",
	);
	expect(
		change(
			(v) =>
				(v.documents[2].withdrawals = [
					{ target: "unknown", effectiveAt: "bad" },
				]),
		),
	).toThrow("invalid_withdrawal_target");
	expect(change((v) => (v.documents[2].validFrom = "bad"))).toThrow(
		"invalid_utc_instant",
	);
	expect(
		change((v) => (v.documents[2].candidates[0].quote.pointer = "/absent")),
	).toThrow("unbound_quote");
	expect(change((v) => (v.documents[2].candidates = [{}]))).toThrow();
	expect(
		change((v) => v.documents[2].candidates.push(v.documents[2].candidates[0])),
	).toThrow("unsupported_candidate_count");
});
test("unseen oracles and injection labels are absent from answer input", () => {
	expect(scenarios.flatMap((s) => s.questions)).toHaveLength(20);
	for (const s of scenarios.filter((s) => s.kind !== "normal")) {
		const r = recover(s.packet, s.raw);
		if (r.mode !== "source-only") throw new Error("expected_recovery");
		for (const q of s.questions) {
			const altered = {
				...q,
				category: "SENTINEL",
				expectedAssessments: {},
				expected: {
					decision: "allow" as const,
					governingSources: [],
					reason: "SENTINEL",
				},
			};
			expect(answerPrompt(q, r.context)).toBe(answerPrompt(altered, r.context));
			expect(
				JSON.parse(answerPrompt(q, r.context)).context.derivedView,
			).toBeNull();
		}
	}
});

test("retry calls once, keeps rejection final if repeated, and never calls on normal or malformed input", async () => {
	const { retryExtraction } =
		await import("../../examples/extraction-fallback-comparison/retry.ts");
	const s = scenarios[0]!;
	let calls = 0;
	await expect(
		retryExtraction(s.packet, s.raw, async () => {
			calls++;
			return { raw: s.raw };
		}),
	).rejects.toThrow("extraction_not_one_valid_candidate");
	expect(calls).toBe(1);
	const normal = scenarios.find((s) => s.kind === "normal")!;
	const result = await retryExtraction(normal.packet, normal.raw, async () => {
		throw new Error("unexpected_model_call");
	});
	expect(result.attempted).toBe(false);
	expect(result.material).toEqual(interpret(normal.packet, normal.raw));
	await expect(
		retryExtraction(s.packet, "bad-json", async () => {
			throw new Error("unexpected_model_call");
		}),
	).rejects.toThrow();
	await expect(
		retryExtraction(s.packet, s.raw, async (prompt) => {
			const p = JSON.parse(prompt);
			expect(Object.keys(p).sort()).toEqual([
				"documents",
				"entity",
				"observationKeys",
				"previousValidation",
				"synthetic",
			]);
			expect(
				p.previousValidation.find((d: any) => d.documentId === "DS3").reasons,
			).toEqual(["HYPOTHETICAL_NOT_FACT"]);
			throw new Error("transport_failed");
		}),
	).rejects.toThrow("transport_failed");
});
test("second-round new observations do not duplicate any earlier evaluated combination", async () => {
	const { newQuestions } =
		await import("../../examples/extraction-fallback-comparison/retry-fixtures.ts");
	const { questions: role } =
		await import("../../examples/source-role-comparison/fixtures.ts");
	const { questions: hold } =
		await import("../../examples/linked-answer-holdout/fixtures.ts");
	const signature = (q: (typeof newQuestions)[number]) =>
		JSON.stringify(q.observations.map((o) => [o.key, o.value]).sort());
	const previous = [...role, ...hold, ...scenarios.flatMap((s) => s.questions)];
	expect(newQuestions).toHaveLength(8);
	for (const q of newQuestions)
		expect(
			previous.filter(
				(p) => p.packet === q.packet && signature(p) === signature(q),
			),
		).toHaveLength(0);
});

test("saved live failures pass self-consistency but fail independent semantic expectations", async () => {
	const { default: failures } =
		await import("../../examples/extraction-fallback-comparison/observed-failures.json");
	const { assess } =
		await import("../../examples/linked-answer-holdout/results.ts");
	for (const f of failures) {
		const score = assess(
			f.question as Parameters<typeof assess>[0],
			f.context as Parameters<typeof assess>[1],
			"linked",
			f.raw,
		);
		expect(score.grounding?.passed).toBe(true);
		expect(score.jointCorrect && score.assessmentsCorrect).toBe(false);
	}
});
