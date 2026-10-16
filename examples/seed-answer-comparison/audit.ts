/** Post-run scorer audit. Original answers, protocol and scores remain unchanged. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { asRecord } from "../../src/index.ts";
import { hash } from "../../eval/seed/corpus.ts";
import { MODEL, withLuna } from "../seed-luna/luna.ts";
import {
	arms,
	judgeInstructions,
	judgeSchema,
	type Arm,
	type Question,
} from "./protocol.ts";
import {
	judgeMapping,
	parseAnswer,
	parseJudgement,
	summarize,
	type Cell,
	type Judgement,
} from "./results.ts";

const auditInstructions = `${judgeInstructions}
Audit clarification of the SAME rubric, not a changed expectation:
The frozen reference pack is YOUR grading reference. It was NOT necessarily available to each answerer.
Each answer includes availableSourceIds describing sources actually supplied to that answerer.
If no source was supplied and an answer honestly cannot retrieve a paper-specific number,
score accuracy=2 and calibration=2 unless it asserts something false, and completeness=0.
Its scope can still be 2 if it stays within the question and states the evidence limitation.
Never mark 'cannot verify from my provided material' as false merely because YOUR reference has the value.
For accuracy/scope, valid general knowledge is allowed beyond this narrow reference. A reference's
silence about residuals, confounding, study design or administrative details is not a contradiction.
Require the specifics actually requested by the question. Do not require numeric study results
in a question that only asks whether generalization is justified. Extra plausible diagnostic advice
is not by itself a scope violation. Penalize only a concrete material error or harmful extrapolation.
Continue to penalize wrong exact numbers and invented populations even when citations are empty.
If an extra statement cannot be assessed reliably, mark uncertain rather than assume it is wrong.
Do not infer labels' experimental roles. Labels and all conditions are evaluated symmetrically.`;

const { values } = parseArgs({
	options: { run: { type: "string" }, resume: { type: "string" } },
	strict: true,
});
if (!values.run)
	throw new Error("--run <completed comparison directory> is required");
const parent = resolve(values.run);
const reportBytes = await readFile(resolve(parent, "report.json"));
const original = asRecord(JSON.parse(reportBytes.toString("utf8")));
const protocolBytes = await readFile(resolve(parent, "protocol.json"));
const frozen = asRecord(JSON.parse(protocolBytes.toString("utf8")));
const prepared = JSON.parse(
	await readFile(resolve(parent, "contexts.json"), "utf8"),
) as unknown;
if (
	!original ||
	original["status"] !== "completed" ||
	original["model"] !== MODEL ||
	original["protocolDigest"] !== hash(protocolBytes) ||
	!frozen ||
	!Array.isArray(frozen["questions"]) ||
	!Number.isInteger(frozen["repeats"]) ||
	!Array.isArray(prepared) ||
	!Array.isArray(original["cells"])
)
	throw new Error("audit_invalid_completed_run");
const repeatCount = Number(frozen["repeats"]);
const auditQuestions = frozen["questions"].map(
	(value): Pick<Question, "id" | "recordId" | "question" | "expected"> => {
		const q = asRecord(value);
		if (
			!q ||
			typeof q["id"] !== "string" ||
			typeof q["recordId"] !== "string" ||
			typeof q["question"] !== "string" ||
			typeof q["expected"] !== "string"
		)
			throw new Error("audit_invalid_question");
		return {
			id: q["id"],
			recordId: q["recordId"],
			question: q["question"],
			expected: q["expected"],
		};
	},
);
// Parse stored responses again; never trust model output merely because it was cached.
const cells: Cell[] = original["cells"].map((value) => {
	const cell = asRecord(value);
	if (
		!cell ||
		typeof cell["questionId"] !== "string" ||
		typeof cell["repeat"] !== "number" ||
		!arms.includes(cell["arm"] as Arm) ||
		typeof cell["latencyMs"] !== "number" ||
		typeof cell["inputTokens"] !== "number" ||
		typeof cell["outputTokens"] !== "number" ||
		typeof cell["citationsValid"] !== "boolean"
	)
		throw new Error("audit_invalid_cell");
	return {
		questionId: cell["questionId"],
		repeat: cell["repeat"],
		arm: cell["arm"] as Arm,
		latencyMs: cell["latencyMs"],
		inputTokens: cell["inputTokens"],
		outputTokens: cell["outputTokens"],
		citationsValid: cell["citationsValid"],
		answer: parseAnswer(JSON.stringify(cell["answer"])),
	};
});
const output = values.resume
	? resolve(values.resume)
	: resolve(
			parent,
			`audit-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
		);
await mkdir(output, { recursive: true });
if (values.resume) {
	const previous = asRecord(
		JSON.parse(await readFile(resolve(output, "report.json"), "utf8")),
	);
	if (
		!previous ||
		previous["parentReportDigest"] !== hash(reportBytes) ||
		previous["instructions"] !== auditInstructions
	)
		throw new Error("audit_resume_mismatch");
}
const assessments: Judgement[] = [];
const audit: Record<string, unknown> = {
	status: "running",
	kind: "post-hoc-grader-audit",
	model: MODEL,
	parentReportDigest: hash(reportBytes),
	instructions: auditInstructions,
	rubricExpectedTextChanged: false,
	graderPromptChanged: true,
	evidenceAvailabilityDisclosed: true,
	answerRegeneration: false,
	judgements: assessments,
};
const save = () =>
	writeFile(
		resolve(output, "report.json"),
		JSON.stringify(
			{ ...audit, summary: summarize(cells, assessments) },
			null,
			2,
		),
	);
await save();
try {
	await withLuna(async (run) => {
		for (let repeat = 0; repeat < repeatCount; repeat++)
			for (const [index, question] of auditQuestions.entries()) {
				const item = prepared
					.map(asRecord)
					.find(
						(candidate) =>
							asRecord(candidate?.["question"])?.["id"] === question.id,
					);
				const context = asRecord(item?.["context"]);
				if (!context) throw new Error("audit_context_missing");
				const mapping = judgeMapping(index + 2, repeat);
				const answers = Object.entries(mapping).map(([label, arm]) => {
					const cell = cells.find(
						(c) =>
							c.questionId === question.id &&
							c.repeat === repeat &&
							c.arm === arm,
					);
					if (!cell) throw new Error("audit_answer_missing");
					return {
						label,
						...cell.answer,
						availableSourceIds: arm === "no-seed" ? [] : [question.recordId],
					};
				});
				const prompt = JSON.stringify({
					question: question.question,
					expected: question.expected,
					sources: context["raw-seed"],
					answers,
				});
				const key = `${question.id}-${repeat}`;
				const requestPath = resolve(output, `${key}-request.json`);
				const requestText = JSON.stringify(
					{ prompt, schema: judgeSchema },
					null,
					2,
				);
				if (await Bun.file(requestPath).exists()) {
					if ((await readFile(requestPath, "utf8")) !== requestText)
						throw new Error("audit_cached_request_mismatch");
				} else await writeFile(requestPath, requestText, { flag: "wx" });
				console.log(
					`Audit ${assessments.length + 1}/${repeatCount * auditQuestions.length} ${key}`,
				);
				const responsePath = resolve(output, `${key}-response.json`);
				const response = (await Bun.file(responsePath).exists())
					? asRecord(JSON.parse(await readFile(responsePath, "utf8")))
					: await run(prompt, judgeSchema);
				if (!response || typeof response["raw"] !== "string")
					throw new Error("audit_invalid_response");
				if (!(await Bun.file(responsePath).exists()))
					await writeFile(responsePath, JSON.stringify(response, null, 2), {
						flag: "wx",
					});
				assessments.push({
					questionId: question.id,
					repeat,
					mapping,
					grades: parseJudgement(response.raw, mapping),
				});
				await save();
			}
	}, auditInstructions);
	audit["status"] = "completed";
} catch (error) {
	audit["status"] = "failed";
	audit["error"] = error instanceof Error ? error.message : String(error);
	process.exitCode = 1;
} finally {
	await save();
	console.log(`Audit result: ${resolve(output, "report.json")}`);
}
