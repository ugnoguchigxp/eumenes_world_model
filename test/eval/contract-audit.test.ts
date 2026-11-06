import { expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	comparisonFeasibility,
	comparisonGate,
} from "../../eval/api-quality/contracts.ts";
import {
	auditRepresentation,
	singleQuoteRepresentation,
	requireRepresentable,
} from "../../eval/api-quality/contract-audit.ts";
import { loadQuality } from "../../eval/api-quality/dataset.ts";
import { replay } from "../../eval/api-quality/pipeline.ts";
import { matches } from "../../eval/api-quality/scoring.ts";
import {
	decodeTypedCandidates,
	typedSingleQuoteSchema,
	typedExtractionSchema,
} from "../../eval/api/typed-wire.ts";
import { summary, runIndependent } from "../../eval/api-quality/main.ts";
import { arms } from "../../eval/api-quality/protocol.ts";
import type { ApiSession } from "../../eval/api/session.ts";

test("fixed comparator ceiling does not relax the legacy gate", () => {
	expect(comparisonGate).toEqual({
		cases: 40,
		evaluationCases: 30,
		minImprovements: 5,
		maxWorsened: 0,
	});
	expect(comparisonFeasibility(40, 30, 29)).toMatchObject({
		status: "unreachable",
		maxImprovements: 1,
	});
	expect(comparisonFeasibility(40, 30, 30)).toMatchObject({
		status: "unreachable",
		maxImprovements: 0,
	});
	expect(comparisonFeasibility(40, 30, 25).status).toBe("possible");
	expect(comparisonFeasibility(39, 29, 29).status).toBe("incomplete");
	expect(() => comparisonFeasibility(40, 30, 31)).toThrow(
		"INVALID_COMPARISON_COUNTS",
	);
});

test("a perfect World still fails when five improvements are impossible", () => {
	type Cell = Parameters<typeof summary>[0][number];
	const cells = Array.from({ length: 40 }, (_, i): Cell => ({
		id: `case-${i}`,
		split: i < 30 ? "evaluation" : "dev",
		profile: "grounded",
		extractor: "openai",
		reader: "claude",
		stages: {},
		error: null,
		errors: {},
		answers: Object.fromEntries(arms.map((a) => [a, null])) as Cell["answers"],
		grades: Object.fromEntries(
			arms.map((a) => [
				a,
				{
					passed: a === "world" || i !== 0,
					missing: false,
					unsupportedCitation: false,
					wrong: false,
				},
			]),
		) as Cell["grades"],
		judgments: Object.fromEntries(
			arms.map((a) => [
				a,
				{
					label: "output",
					correct: true,
					sourceSupported: true,
					qualificationsPreserved: true,
					appropriateHold: true,
					safetyViolation: false,
					referenceConflict: false,
					reason: "test",
				},
			]),
		) as Cell["judgments"],
		judgeError: null,
		contextBytes: { raw: 0, plain: 0, world: 0, oracle: 0 },
		usageValid: true,
	}));
	const result = summary(cells).find((s) => s.cases === 40)!;
	expect(result.byArm["world"]!.passed).toBe(40);
	expect(result.worldVsPlain).toMatchObject({
		passed: false,
		improvedEvaluation: 1,
		feasibility: { status: "unreachable" },
	});
	// With five fixed comparator failures the exact same unchanged gate is reachable.
	for (const c of cells.slice(0, 5)) c.grades.plain.passed = false;
	expect(summary(cells).find((s) => s.cases === 40)!.worldVsPlain.passed).toBe(
		true,
	);
});

test("source capacity audit follows requirements, not case names or source words", () => {
	const cases = loadQuality("independent");
	const audit = auditRepresentation(cases, singleQuoteRepresentation);
	expect(auditRepresentation(cases).issues).toEqual([]);
	expect(audit.issues).toEqual([
		{
			caseId: "I-lifecycle-09",
			factIndex: 0,
			code: "SUPPORTING_SOURCE_CAPACITY_EXCEEDED",
			requiredSources: ["s0", "s1"],
			capacity: 1,
		},
	]);
	const c = structuredClone(
		cases.find((c) => c.id === audit.issues[0]!.caseId)!,
	);
	c.id = "renamed";
	c.sources.forEach((s) => {
		s.text = "unrelated wording";
	});
	expect(
		auditRepresentation([c], singleQuoteRepresentation).issues[0]!.caseId,
	).toBe("renamed");
	c.expected[0]!.sourceIds = ["s0", "s0"];
	expect(auditRepresentation([c], singleQuoteRepresentation).status).toBe(
		"no_capacity_conflict",
	);
	expect(() => requireRepresentable(cases, singleQuoteRepresentation)).toThrow(
		"EVALUATION_REPRESENTATION_CONFLICT",
	);
});

test("both native-wire alternatives validate, but neither can meet two-source gold", () => {
	const c = loadQuality("independent").find((c) => c.id === "I-lifecycle-09")!;
	const f = c.expected[0]!;
	// Test-only oracle probes; these never go to a generation provider.
	const drafts = c.sources.map((s) => {
		const raw = decodeTypedCandidates(
			JSON.stringify({
				candidates: [
					{
						subject: { kind: "id", id: f.subjectId },
						predicate: f.predicate,
						payload: f.payload,
						modality: "asserted",
						condition: null,
						validTime: null,
						quote: { utteranceId: s.id, text: s.text, occurrence: 0 },
					},
				],
			}),
			c.sources.map((s) => ({
				utteranceId: s.id,
				text: s.text,
				origin: "document_claim",
			})),
		);
		const draft = replay(c, raw).validation.handoff[0]!.draft;
		expect(draft.evidence.map((e) => e.source.id)).toEqual([s.id]);
		expect(draft.inputManifest.map((s) => s.id)).toEqual(["s0", "s1"]);
		expect(matches(draft, f, c)).toBe(false);
		return draft;
	});
	expect(drafts.some((d) => matches(d, f, c))).toBe(false);
	// Contract drift must require a deliberate audit update.
	const properties = (
		typedSingleQuoteSchema as unknown as {
			properties: {
				candidates: { items: { properties: Record<string, unknown> } };
			};
		}
	).properties.candidates.items.properties;
	expect(properties["quote"]).toBeDefined();
	expect(properties["quotes"]).toBeUndefined();
	expect(JSON.stringify(typedExtractionSchema)).toContain("quotes");
});

test("independent suite rejects a contract conflict before any API use", async () => {
	let calls = 0;
	const session = {
		complete() {
			calls++;
			throw new Error("API_NOT_ALLOWED");
		},
	} as unknown as ApiSession;
	await expect(runIndependent(session, "unused")).rejects.toThrow(
		"EVALUATION_REPRESENTATION_CONFLICT",
	);
	expect(calls).toBe(0);
});

test("paid CLI preflights stop before even creating a budget", async () => {
	const directory = mkdtempSync(join(tmpdir(), "world-contract-preflight-"));
	try {
		const preload = join(directory, "deny-network.ts");
		writeFileSync(
			preload,
			'globalThis.fetch = () => { throw new Error("NETWORK_FORBIDDEN"); };\n',
		);
		for (const [script, mode] of [["main.ts", "acceptance"]]) {
			const out = join(directory, mode!),
				ledger = join(directory, `budget-${mode}.jsonl`);
			const child = Bun.spawn(
				[
					process.execPath,
					"--preload",
					preload,
					`eval/api-quality/${script}`,
					mode!,
					out,
					ledger,
				],
				{
					cwd: resolve(import.meta.dir, "../.."),
					stdout: "pipe",
					stderr: "pipe",
					env: {
						PATH: process.env["PATH"] ?? "",
						CLAUDE_API_KEY: "",
						OPEN_AI_API_KEY: "",
						OPENAI_API_KEY: "",
						ANTHROPIC_API_KEY: "",
					},
				},
			);
			const timer = setTimeout(() => child.kill(), 5000);
			try {
				const stderr = await new Response(child.stderr).text();
				expect(await child.exited).toBe(1);
				expect(stderr).toContain("EVALUATION_REPRESENTATION_CONFLICT");
				expect(stderr).not.toContain("NETWORK_FORBIDDEN");
				expect(existsSync(ledger)).toBe(false);
				expect(
					JSON.parse(readFileSync(join(out, "contract-audit.json"), "utf8"))
						.status,
				).toBe("incompatible");
			} finally {
				clearTimeout(timer);
				child.kill();
			}
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
