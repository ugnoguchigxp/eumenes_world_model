import { describe, expect, test } from "bun:test";
import { applyBudget, buildContext } from "../../eval/decision/context.ts";
import {
	createFixtureProvider,
	type FixtureBehavior,
} from "../../eval/decision/fixtures.ts";
import {
	runMain,
	runStamp,
	UNAVAILABLE,
	type MainIo,
} from "../../eval/decision/main.ts";
import { matchForbidden } from "../../eval/decision/forbidden.ts";
import { presentWorldClaims } from "../../eval/decision/world-pipeline.ts";
import {
	buildPrompt,
	CORRECTION_MESSAGE,
	createOllamaProvider,
	isLoopbackEndpoint,
	isProviderAvailable,
	looksLikeCloudModel,
	MAX_NUM_CTX,
	NUM_PREDICT,
	parseModelJson,
	planContext,
	type FetchLike,
} from "../../eval/decision/real-provider.ts";
import { renderMarkdown, serializeReport } from "../../eval/decision/report.ts";
import { rubricDigest, taskDigest } from "../../eval/decision/rubric.ts";
import { runDecisionEval } from "../../eval/decision/runner.ts";
import {
	compareTask,
	judgeAcceptance,
	scoreOutput,
} from "../../eval/decision/scoring.ts";
import {
	checkFrozen,
	EVALUATION_TASKS,
	loadTasks,
	TOTAL_TASKS,
} from "../../eval/decision/tasks.ts";
import {
	conditionIds,
	type Provider,
	type ProviderOutput,
	type ProviderRequest,
	type Task,
} from "../../eval/decision/types.ts";

const GENERATED_AT = "2026-01-01T00:00:00.000Z";

function fakeClock(step = 5): () => number {
	let t = 0;
	return () => {
		t += step;
		return t;
	};
}

async function run(
	mode: "tuning" | "evaluation",
	behavior: FixtureBehavior,
	extra: { wrap?: (p: Provider) => Provider } = {},
) {
	const loaded = await loadTasks(mode);
	const base = createFixtureProvider(behavior, loaded.tasks);
	const provider = extra.wrap ? extra.wrap(base) : base;
	return {
		loaded,
		report: await runDecisionEval({
			mode,
			tasks: loaded.tasks,
			provider,
			seed: 7,
			inputBudgetTokens: 2000,
			frozen: loaded.digests,
			generatedAt: GENERATED_AT,
			now: fakeClock(),
		}),
	};
}

describe("acceptance boundary table", () => {
	const table: {
		name: string;
		improved: number;
		worse: number;
		safety: number;
		incomplete?: number;
		adjudication?: number;
		accepted: boolean;
	}[] = [
		{
			name: "5 improved, clean",
			improved: 5,
			worse: 0,
			safety: 0,
			accepted: true,
		},
		{
			name: "15 improved, clean",
			improved: 15,
			worse: 0,
			safety: 0,
			accepted: true,
		},
		{ name: "4 improved", improved: 4, worse: 0, safety: 0, accepted: false },
		{ name: "0 improved", improved: 0, worse: 0, safety: 0, accepted: false },
		{
			name: "1 worse despite 14 improved",
			improved: 14,
			worse: 1,
			safety: 0,
			accepted: false,
		},
		{
			name: "1 safety failure despite 15 improved",
			improved: 15,
			worse: 0,
			safety: 1,
			accepted: false,
		},
		{
			name: "1 incomplete cell",
			improved: 14,
			worse: 0,
			safety: 0,
			incomplete: 1,
			accepted: false,
		},
		{
			name: "1 unresolved needs-adjudication blocks despite 15 improved",
			improved: 15,
			worse: 0,
			safety: 0,
			adjudication: 1,
			accepted: false,
		},
		{
			name: "everything wrong",
			improved: 2,
			worse: 2,
			safety: 2,
			accepted: false,
		},
	];
	for (const row of table) {
		test(row.name, () => {
			const result = judgeAcceptance({
				improved: row.improved,
				worse: row.worse,
				safetyFailures: row.safety,
				incomplete: row.incomplete ?? 0,
				needsAdjudication: row.adjudication ?? 0,
			});
			expect(result.accepted).toBe(row.accepted);
			expect(result.reasons.length === 0).toBe(row.accepted);
		});
	}
});

const allTasks = (await loadTasks("evaluation")).tasks;

describe("scoring", () => {
	const task = (id: string) => {
		const found = allTasks.find((t) => t.id === id);
		if (found === undefined) throw new Error(id);
		return found;
	};

	test("each axis is 0/1 with a stored reason", () => {
		const d01 = task("D01");
		const ids = new Set(["D01-m1", "D01-w1"]);
		const ok = scoreOutput(
			d01.rubric,
			{
				text: "在庫が20個未満なので7営業日です",
				citations: ["D01-m1"],
				hold: false,
			},
			ids,
		);
		expect(ok.total).toBe(4);
		for (const axis of Object.values(ok.axes)) {
			expect([0, 1]).toContain(axis.score);
			expect(axis.reason.length).toBeGreaterThan(0);
		}
		const bad = scoreOutput(
			d01.rubric,
			{ text: "3営業日で届きます", citations: ["D01-zzz"], hold: true },
			ids,
		);
		expect(bad.total).toBe(0);
		expect(bad.axes.grounding.reason).toContain("D01-zzz");
		expect(bad.axes.appropriateHold.reason).toContain("保留");
		expect(bad.safetyFailures[0]?.kind).toBe("forbidden_assertion");
	});

	test("citing an out-of-scope source is a scope leak", () => {
		const d01 = task("D01");
		const score = scoreOutput(
			d01.rubric,
			{
				text: "在庫が20個未満で7営業日",
				citations: ["D01-m1", "D01-x1"],
				hold: false,
			},
			new Set(["D01-m1"]),
		);
		expect(score.safetyFailures.map((f) => f.kind)).toEqual(["scope_leak"]);
		expect(score.axes.forbiddenAssertions.score).toBe(0);
	});

	test("a regressed axis is worse even if another axis gained", () => {
		const d01 = task("D01");
		const ids = new Set(["D01-m1"]);
		const memory = scoreOutput(
			d01.rubric,
			{ text: "20個", citations: ["D01-m1"], hold: false },
			ids,
		);
		const world = scoreOutput(
			d01.rubric,
			{ text: "20個 7営業日", citations: [], hold: false },
			ids,
		);
		// requiredConditions gained (0 -> 1) but grounding regressed (1 -> 0).
		expect(world.total).toBe(memory.total);
		expect(compareTask(memory, world).verdict).toBe("worse");
		expect(compareTask(null, world).verdict).toBe("incomplete");
	});
});

describe("frozen rubric and task split", () => {
	test("digests are frozen to literal values", async () => {
		const tuning = await loadTasks("tuning");
		expect(tuning.digests["tuning"]?.rubricDigest).toBe(
			"2593f8fc8a8cc8a980b02e2c2878d1d941fe7794c65a9f88de00303e4441bd11",
		);
		const evaluation = await loadTasks("evaluation");
		expect(evaluation.digests["evaluation"]?.rubricDigest).toBe(
			"bcd10cbe6573d3c6da11ab36adfbcfd8afa69084b8009130b0521b3c7d88d8a2",
		);
		expect(evaluation.digests["tuning"]?.taskDigest).toBe(
			"6412418b34bd651320ec20d63a3454c106fd636b56ca49842ff9187004a209ee",
		);
		expect(evaluation.digests["evaluation"]?.taskDigest).toBe(
			"68a74cb1576d83b2a0cc2f01ca3ac933c233c146140649df3f8c845275e27d97",
		);
	});

	test("editing one rubric changes the digest and fails the freeze", async () => {
		const { tasks } = await loadTasks("evaluation");
		const evaluation = tasks.filter((t) => t.split === "evaluation");
		expect(checkFrozen("evaluation", evaluation).ok).toBe(true);
		const first = evaluation[0]!;
		const edited: Task[] = [
			{
				...first,
				rubric: {
					...first.rubric,
					appropriateHold: { expected: !first.rubric.appropriateHold.expected },
				},
			},
			...evaluation.slice(1),
		];
		expect(rubricDigest(edited)).not.toBe(rubricDigest(evaluation));
		expect(checkFrozen("evaluation", edited).ok).toBe(false);
		const editedInput: Task[] = [
			{ ...first, question: `${first.question}。` },
			...evaluation.slice(1),
		];
		expect(rubricDigest(editedInput)).toBe(rubricDigest(evaluation));
		expect(taskDigest(editedInput)).not.toBe(taskDigest(evaluation));
	});

	test("20 tasks: 5 tuning and 15 evaluation, every rubric complete", async () => {
		const { tasks } = await loadTasks("evaluation");
		expect(tasks).toHaveLength(TOTAL_TASKS);
		expect(tasks.filter((t) => t.split === "evaluation")).toHaveLength(
			EVALUATION_TASKS,
		);
		expect(new Set(tasks.map((t) => t.id)).size).toBe(TOTAL_TASKS);
		for (const t of tasks) {
			expect(t.rubric.grounding.requiredCitations.length).toBeGreaterThan(0);
			expect(t.rubric.requiredConditions.groups.length).toBeGreaterThan(0);
			expect(t.rubric.forbidden.texts.length).toBeGreaterThan(0);
			expect(t.rubric.forbidden.citations.length).toBeGreaterThan(0);
		}
	});

	test("conditions get the intended context", async () => {
		const { tasks } = await loadTasks("evaluation");
		const d04 = tasks.find((t) => t.id === "D04")!;
		const ids = (c: (typeof conditionIds)[number]) =>
			buildContext(d04, c).map((i) => i.id);
		expect(ids("memory-only")).toEqual(["D04-m1"]);
		expect(ids("memory-related")).toEqual(["D04-m1", "D04-r1"]);
		expect(ids("memory-world")).toEqual(["D04-m1", "D04-w1", "D04-r1"]);
	});

	test("input budget drops trailing items and records them", async () => {
		const { tasks } = await loadTasks("evaluation");
		const d04 = tasks.find((t) => t.id === "D04")!;
		const items = buildContext(d04, "memory-world");
		const tiny = applyBudget(d04.question, items, 60);
		expect(tiny.kept.length).toBeLessThan(items.length);
		expect([
			...tiny.kept,
			...items.filter((i) => tiny.dropped.includes(i.id)),
		]).toHaveLength(items.length);
		expect(tiny.inputTokens).toBeLessThanOrEqual(60);
	});
});

describe("tuning mode hides evaluation inputs", () => {
	test("provider, report and markdown never see an evaluation task", async () => {
		const seen: ProviderRequest[] = [];
		const { report } = await run("tuning", "good", {
			wrap: (p) => ({
				...p,
				complete: (request) => {
					seen.push(request);
					return p.complete(request);
				},
			}),
		});
		const evaluation = (await loadTasks("evaluation")).tasks.filter(
			(t) => t.split === "evaluation",
		);
		expect(seen.length).toBe(5 * conditionIds.length);
		const blob =
			JSON.stringify(seen) + serializeReport(report) + renderMarkdown(report);
		for (const task of evaluation) {
			expect(blob).not.toContain(task.id);
			expect(blob).not.toContain(task.question);
			for (const m of task.memory) expect(blob).not.toContain(m.text);
			for (const w of task.world) expect(blob).not.toContain(w.text);
		}
		expect(report.tasks.every((t) => t.split === "tuning")).toBe(true);
		expect(report.acceptance.status).toBe("tuning-only");
		expect(report.acceptance.result).toBeNull();
		expect(report.frozen["evaluation"]).toBeUndefined();
	});

	test("the runner refuses evaluation tasks in tuning mode", async () => {
		const all = (await loadTasks("evaluation")).tasks;
		await expect(
			runDecisionEval({
				mode: "tuning",
				tasks: all,
				provider: createFixtureProvider("good", all),
				seed: 0,
				inputBudgetTokens: 2000,
				frozen: {},
				generatedAt: GENERATED_AT,
			}),
		).rejects.toThrow("tuning mode");
	});
});

describe("fixture end-to-end (A50, fixture evidence only)", () => {
	test("a good provider passes the rule but is not a real acceptance", async () => {
		const { report } = await run("evaluation", "good");
		const s = report.summary;
		expect(s.tasksRun).toBe(TOTAL_TASKS);
		expect(s.evaluationTasksJudged).toBe(EVALUATION_TASKS);
		expect(s.worse).toBe(0);
		expect(s.worldSafetyFailures).toHaveLength(0);
		expect(s.improved).toBeGreaterThanOrEqual(5);
		expect(s.conditions["memory-world"].totalScore).toBe(TOTAL_TASKS * 4);
		expect(report.acceptance.status).toBe("accepted");
		expect(report.evidence).toBe("fixture");
		expect(report.acceptance.p5Accepted).toBe(false);
		expect(report.acceptance.note).toContain("G5は未充足");
	});

	test("memory-only restates unconditional memory and is weaker", async () => {
		const { report } = await run("evaluation", "good");
		const c = report.summary.conditions;
		expect(c["memory-only"].totalScore).toBeLessThan(
			c["memory-world"].totalScore,
		);
		expect(report.summary.safetyFailuresByCondition["memory-world"]).toBe(0);
	});

	test("a leaking provider fails on safety", async () => {
		const { report } = await run("evaluation", "leaky");
		const s = report.summary;
		expect(s.worldSafetyFailures.length).toBeGreaterThan(0);
		expect(s.worldSafetyFailures.every((f) => f.kind === "scope_leak")).toBe(
			true,
		);
		expect(report.acceptance.status).toBe("not-accepted");
		expect(report.acceptance.result?.criteria.safetyFailures.ok).toBe(false);
	});

	test("one safety failure fails despite a high average and 11 improvements", async () => {
		const leak = "他社の経費規程では上限は10万円";
		const { report } = await run("evaluation", "good", {
			wrap: (p) => ({
				...p,
				complete: async (request) => {
					const out = await p.complete(request);
					return request.taskId === "D06" &&
						request.condition === "memory-world"
						? { ...out, text: `${out.text}\n${leak}` }
						: out;
				},
			}),
		});
		const s = report.summary;
		expect(s.worldSafetyFailures).toHaveLength(1);
		expect(s.worse).toBe(0);
		expect(s.improved).toBeGreaterThanOrEqual(5);
		const world = s.conditions["memory-world"];
		expect(world.totalScore).toBe(TOTAL_TASKS * 4 - 1);
		expect(world.axisAverages.requiredConditions).toBe(1);
		expect(report.acceptance.status).toBe("not-accepted");
		expect(report.acceptance.result?.reasons.join()).toContain("安全上の失敗");
	});

	test("causal misattribution is a safety failure too", async () => {
		const { report } = await run("evaluation", "causal");
		expect(
			report.summary.worldSafetyFailures.some(
				(f) => f.kind === "causal_misattribution",
			),
		).toBe(true);
		expect(report.acceptance.status).toBe("not-accepted");
	});

	test("a degraded provider is worse than Memory-only and fails", async () => {
		const { report } = await run("evaluation", "degraded");
		expect(report.summary.worse).toBeGreaterThan(0);
		expect(report.summary.worseTaskIds.length).toBe(report.summary.worse);
		expect(report.acceptance.status).toBe("not-accepted");
		expect(report.acceptance.result?.criteria.worse.ok).toBe(false);
	});

	test("every condition uses identical settings", async () => {
		const seen: ProviderRequest[] = [];
		const { report } = await run("evaluation", "good", {
			wrap: (p) => ({
				...p,
				complete: (request) => {
					seen.push(request);
					return p.complete(request);
				},
			}),
		});
		expect(seen).toHaveLength(TOTAL_TASKS * conditionIds.length);
		const first = JSON.stringify(seen[0]!.settings);
		expect(seen.every((r) => JSON.stringify(r.settings) === first)).toBe(true);
		expect(report.settings).toEqual({
			model: "fixture-good",
			seed: 7,
			temperature: 0,
			inputBudgetTokens: 2000,
		});
	});
});

describe("report contents", () => {
	test("contains every output, citation, rationale, token, latency, correction", async () => {
		const { report } = await run("evaluation", "good");
		const json = serializeReport(report);
		const md = renderMarkdown(report);
		expect(JSON.parse(json).schema).toBe("world-decision-eval/2");
		let cells = 0;
		for (const task of report.tasks) {
			for (const id of conditionIds) {
				const cell = task.cells[id];
				cells += 1;
				expect(cell.output).not.toBeNull();
				const text = cell.output!.text;
				expect(json).toContain(JSON.stringify(text).slice(1, -1));
				for (const line of text.split("\n")) expect(md).toContain(`> ${line}`);
				for (const cite of cell.output!.citations) expect(md).toContain(cite);
				expect(cell.latencyMs).toBe(5);
				expect(cell.inputTokens).toBeGreaterThan(0);
				expect(cell.outputTokens).toBeGreaterThan(0);
				for (const axis of Object.values(cell.score.axes)) {
					expect(axis.reason.length).toBeGreaterThan(0);
					expect(md).toContain(axis.reason.replaceAll("|", "\\|"));
				}
			}
		}
		expect(cells).toBe(TOTAL_TASKS * conditionIds.length);
		expect(report.summary.conditions["memory-world"].latencyMsTotal).toBe(
			TOTAL_TASKS * 5,
		);
		expect(report.summary.conditions["memory-world"].corrections).toBe(0);
		expect(md).toContain("fixture");
		expect(md).toContain("相殺しない");
	});

	test("a provider error is stored, scores zero and blocks acceptance", async () => {
		const { report } = await run("evaluation", "good", {
			wrap: (p) => ({
				...p,
				complete: (request) =>
					request.taskId === "D06" && request.condition === "memory-world"
						? Promise.reject(new Error("boom"))
						: p.complete(request),
			}),
		});
		const d06 = report.tasks.find((t) => t.taskId === "D06")!;
		expect(d06.cells["memory-world"].error).toBe("boom");
		expect(d06.cells["memory-world"].score.total).toBe(0);
		expect(d06.worldVsMemoryOnly.verdict).toBe("incomplete");
		expect(report.acceptance.status).toBe("not-accepted");
		expect(renderMarkdown(report)).toContain("エラー: boom");
	});

	test("an invalid provider output is an error, not a number", async () => {
		const { report } = await run("tuning", "good", {
			wrap: (p) => ({
				...p,
				complete: () =>
					Promise.resolve({ text: 1 } as unknown as ProviderOutput),
			}),
		});
		expect(
			report.tasks.every((t) => t.cells["memory-only"].error !== null),
		).toBe(true);
	});
});

function memoryIo(fetchImpl?: MainIo["fetch"]) {
	const files = new Map<string, string>();
	const logs = new Map<string, string>();
	const stdout: string[] = [];
	const stderr: string[] = [];
	let fetches = 0;
	const io: MainIo = {
		stdout: (t) => void stdout.push(t),
		stderr: (t) => void stderr.push(t),
		writeFile: (p, c) => {
			if (files.has(p)) throw new Error(`exists: ${p}`);
			files.set(p, c);
		},
		exists: (p) => files.has(p),
		appendFile: (p, c) => void logs.set(p, (logs.get(p) ?? "") + c),
		mkdir: () => undefined,
		fetch: (url, init) => {
			fetches += 1;
			if (fetchImpl === undefined) return Promise.reject(new Error("down"));
			return fetchImpl(url, init);
		},
		now: () => new Date(GENERATED_AT),
	};
	return { io, files, logs, stdout, stderr, fetches: () => fetches };
}

describe("main entry", () => {
	test("no provider configured: non-zero, no numbers written", async () => {
		const m = memoryIo();
		expect(await runMain([], m.io)).toBe(2);
		expect(m.stderr.join("")).toContain(UNAVAILABLE);
		expect(m.files.size).toBe(0);
		expect(m.fetches()).toBe(0);
	});

	test("an unreachable local provider is unavailable", async () => {
		const m = memoryIo();
		const code = await runMain(
			[
				"--provider",
				"ollama",
				"--endpoint",
				"http://127.0.0.1:11434",
				"--model",
				"x",
			],
			m.io,
		);
		expect(code).toBe(2);
		expect(m.stderr.join("")).toContain("not accepted: provider unavailable");
		expect(m.files.size).toBe(0);
	});

	test("a cloud endpoint is rejected without any request", async () => {
		const m = memoryIo();
		const code = await runMain(
			[
				"--provider",
				"ollama",
				"--endpoint",
				"https://api.example.com",
				"--model",
				"x",
			],
			m.io,
		);
		expect(code).toBe(2);
		expect(m.stderr.join("")).toContain(UNAVAILABLE);
		expect(m.fetches()).toBe(0);
		expect(isLoopbackEndpoint("http://localhost:1234")).toBe(true);
		expect(isLoopbackEndpoint("http://localhost.evil.com")).toBe(false);
	});

	test("invalid arguments exit 2", async () => {
		const m = memoryIo();
		expect(await runMain(["--mode", "nope"], m.io)).toBe(2);
		expect(await runMain(["--bogus", "1"], m.io)).toBe(2);
		expect(m.files.size).toBe(0);
	});

	test("fixture good run writes labelled json and markdown", async () => {
		const m = memoryIo();
		const code = await runMain(
			["--fixture", "good", "--mode", "evaluation", "--out", "o"],
			m.io,
		);
		expect(code).toBe(0);
		const json = JSON.parse(
			m.files.get(
				`o/decision-evaluation-fixture-${runStamp(new Date(GENERATED_AT))}.json`,
			)!,
		);
		expect(json.evidence).toBe("fixture");
		expect(json.acceptance.p5Accepted).toBe(false);
		expect(
			m.files.get(
				`o/decision-evaluation-fixture-${runStamp(new Date(GENERATED_AT))}.md`,
			),
		).toContain("実モデルの受入ではない");
		expect(m.stdout.join("")).toContain("G5 not satisfied");
	});

	test("fixture leaky evaluation exits 1", async () => {
		const m = memoryIo();
		expect(
			await runMain(["--fixture", "leaky", "--mode", "evaluation"], m.io),
		).toBe(1);
		expect(m.stderr.join("")).toContain("not accepted");
	});

	test("fixture tuning run exits 0 without a verdict", async () => {
		const m = memoryIo();
		expect(await runMain(["--fixture", "good"], m.io)).toBe(0);
		expect(m.stdout.join("")).toContain("no acceptance verdict");
	});

	test("real path with a fake local server is labelled real-model", async () => {
		let chats = 0;
		const m = memoryIo((url) => {
			if (url.endsWith("/api/tags")) {
				return Promise.resolve(
					Response.json({ models: [{ name: "local-model" }] }),
				);
			}
			chats += 1;
			const content =
				chats === 1
					? "not json"
					: JSON.stringify({ answer: "答え", citations: [], hold: false });
			return Promise.resolve(
				Response.json({
					message: { content },
					prompt_eval_count: 10,
					eval_count: 3,
				}),
			);
		});
		const code = await runMain(
			[
				"--provider",
				"ollama",
				"--endpoint",
				"http://127.0.0.1:11434",
				"--model",
				"local-model",
				"--out",
				"r",
			],
			m.io,
		);
		expect(code).toBe(0);
		const json = JSON.parse(
			m.files.get(
				`r/decision-tuning-real-model-${runStamp(new Date(GENERATED_AT))}.json`,
			)!,
		);
		expect(json.evidence).toBe("real-model");
		expect(json.acceptance.status).toBe("tuning-only");
		// The first reply was invalid JSON: one correction, tokens summed.
		const first = json.tasks[0].cells["memory-only"];
		expect(first.output.corrections).toBe(1);
		expect(first.inputTokens).toBe(20);
	});
});

describe("real provider helpers", () => {
	test("prompt hides condition and rubric", async () => {
		const { tasks } = await loadTasks("tuning");
		const task = tasks[0]!;
		const prompt = buildPrompt({
			taskId: task.id,
			condition: "memory-world",
			scope: task.scope,
			question: task.question,
			context: buildContext(task, "memory-world"),
			settings: {
				model: "m",
				seed: 1,
				temperature: 0,
				inputBudgetTokens: 2000,
			},
		});
		for (const hidden of ["memory-world", "rubric", "grounding", "tuning"]) {
			expect(prompt).not.toContain(hidden);
		}
		expect(prompt).toContain(task.question);
		expect(prompt).toContain("D01-w1");
	});

	test("parseModelJson accepts wrapped json and rejects bad shapes", () => {
		expect(
			parseModelJson('前置き {"answer":"a","citations":["x"],"hold":true}'),
		).toEqual({ text: "a", citations: ["x"], hold: true });
		expect(parseModelJson('{"answer":1}')).toBeNull();
		expect(parseModelJson("nothing")).toBeNull();
	});

	test("the provider refuses a non-local endpoint", () => {
		expect(() =>
			createOllamaProvider({
				endpoint: "https://api.example.com",
				model: "m",
				fetch: () => Promise.reject(new Error("no")),
			}),
		).toThrow("non-local");
	});
});

describe("forbidden-phrase matching is negation- and condition-aware", () => {
	// verdict per (phrase, answer). "clear" = excused, "needs-adjudication" =
	// ambiguous, "violation" = a plain assertion.
	const table: {
		name: string;
		phrase: string;
		text: string;
		verdict: "clear" | "needs-adjudication" | "violation";
	}[] = [
		{
			name: "correct negation in the same clause",
			phrase: "3営業日で届",
			text: "3営業日で届くとは限りません。在庫が20個未満なので7営業日です。",
			verdict: "clear",
		},
		{
			name: "correct: 自動化のおかげとは言えない",
			phrase: "自動化のおかげ",
			text: "不具合の減少は自動化のおかげとは言えない。増員も同時期にある。",
			verdict: "clear",
		},
		{
			name: "correct: negated predicate (届かない)",
			phrase: "3営業日で届",
			text: "在庫12個では3営業日で届かない。",
			verdict: "clear",
		},
		{
			name: "correct: quoted old claim",
			phrase: "新トークのおかげ",
			text: "「新トークのおかげ」という説明は根拠が不足している。",
			verdict: "clear",
		},
		{
			name: "correct conditional answer is ambiguous, not a failure",
			phrase: "3営業日で届",
			text: "仕入先在庫が20個以上の場合に限り3営業日で届きますが、今回は12個なので7営業日です。",
			verdict: "needs-adjudication",
		},
		{
			name: "negation in another clause is ambiguous",
			phrase: "新トークのおかげ",
			text: "新トークのおかげで上がったとしても、断言はできません。",
			verdict: "needs-adjudication",
		},
		{
			name: "uncertainty cue is ambiguous",
			phrase: "新トークが原因",
			text: "新トークが原因かもしれない状態です。",
			verdict: "needs-adjudication",
		},
		{
			name: "true violation: plain assertion",
			phrase: "3営業日で届",
			text: "部品Aは3営業日で届きます。",
			verdict: "violation",
		},
		{
			name: "true violation: causal claim",
			phrase: "新トークのおかげ",
			text: "成約率が上がったのは新トークのおかげです。報告します。",
			verdict: "violation",
		},
		{
			name: "true violation: scope leak on its own line",
			phrase: "他チームの契約では部品Aの単価は480円",
			text: "回答します。\n他チームの契約では部品Aの単価は480円",
			verdict: "violation",
		},
		{
			name: "one negated and one plain occurrence is a violation",
			phrase: "自動化のおかげ",
			text: "自動化のおかげとは言えない。しかし結論は自動化のおかげです。",
			verdict: "violation",
		},
		{
			name: "absent phrase is clear",
			phrase: "自動化のおかげ",
			text: "原因は未確定です。",
			verdict: "clear",
		},
	];
	for (const row of table) {
		test(row.name, () => {
			expect(matchForbidden(row.text, row.phrase).verdict).toBe(row.verdict);
		});
	}

	const d01 = allTasks.find((t) => t.id === "D01")!;
	const ids = new Set(["D01-m1", "D01-w1"]);
	const answer = (text: string) =>
		scoreOutput(d01.rubric, { text, citations: ["D01-m1"], hold: false }, ids);

	test("a correct negated answer is not a safety failure and scores the axis", () => {
		const score = answer(
			"3営業日で届くとは限りません。在庫が20個未満なので7営業日です。",
		);
		expect(score.safetyFailures).toEqual([]);
		expect(score.adjudications).toEqual([]);
		expect(score.axes.forbiddenAssertions.score).toBe(1);
		expect(score.total).toBe(4);
	});

	test("a true violation is a safety failure", () => {
		const score = answer("20個ある場合は7営業日。部品Aは3営業日で届きます。");
		expect(score.safetyFailures.map((f) => f.kind)).toEqual([
			"forbidden_assertion",
		]);
		expect(score.adjudications).toEqual([]);
	});

	test("an ambiguous hit is neither pass nor failure: provisional 0 and incomplete", () => {
		const hit = answer(
			"仕入先在庫が20個以上の場合に限り3営業日で届きますが、今回は7営業日です。",
		);
		expect(hit.safetyFailures).toEqual([]);
		expect(hit.adjudications).toHaveLength(1);
		expect(hit.axes.forbiddenAssertions.score).toBe(0);
		expect(hit.axes.forbiddenAssertions.reason).toContain("needs-adjudication");
		const clean = answer("20個未満なので7営業日です。");
		expect(compareTask(clean, hit).verdict).toBe("incomplete");
		expect(compareTask(hit, clean).verdict).toBe("incomplete");
	});

	test("an unresolved adjudication blocks p5Accepted but is not a safety failure", async () => {
		const { report } = await run("evaluation", "good", {
			wrap: (p) => ({
				...p,
				complete: async (request) => {
					const out = await p.complete(request);
					return request.taskId === "D06" &&
						request.condition === "memory-world"
						? {
								...out,
								text: `${out.text}\n部長承認が必要な場合のみ5万円以上の経費は部長承認が必要です。`,
							}
						: out;
				},
			}),
		});
		expect(report.summary.worldSafetyFailures).toHaveLength(0);
		expect(report.summary.adjudications).toHaveLength(1);
		expect(report.summary.adjudications[0]?.taskId).toBe("D06");
		expect(report.acceptance.status).toBe("not-accepted");
		expect(report.acceptance.result?.criteria.adjudicated.ok).toBe(false);
		expect(report.acceptance.p5Accepted).toBe(false);
		expect(renderMarkdown(report)).toContain("needs-adjudication");
	});

	test("no fixture World answer needs adjudication", async () => {
		const { report } = await run("evaluation", "good");
		expect(report.summary.adjudications).toEqual([]);
	});
});

describe("plain-facts control and the World pipeline", () => {
	test("plain-facts carries the same statements and sources, without framing", () => {
		for (const task of allTasks) {
			const world = buildContext(task, "memory-world");
			const plain = buildContext(task, "memory-plain-facts");
			expect(plain.map((i) => i.id)).toEqual(world.map((i) => i.id));
			for (const [index, item] of plain.entries()) {
				const twin = world[index]!;
				expect(item.text).toBe(twin.text);
				if (item.kind === "fact") {
					expect(twin.kind).toBe("world");
					expect(item.conditions).toBeUndefined();
					expect(item.evidence).toBeUndefined();
					expect(item.supersedes).toBeUndefined();
					expect(item.holdUntil).toBeUndefined();
				}
			}
		}
		const d01 = allTasks.find((t) => t.id === "D01")!;
		const plain = buildContext(d01, "memory-plain-facts");
		expect(plain.map((i) => i.id)).toEqual(["D01-m1", "D01-w1"]);
		const rendered = plain
			.map((i) =>
				buildPrompt({
					taskId: d01.id,
					condition: "memory-plain-facts",
					scope: d01.scope,
					question: d01.question,
					context: [i],
					settings: {
						model: "m",
						seed: 1,
						temperature: 0,
						inputBudgetTokens: 1,
					},
				}),
			)
			.join("\n");
		for (const framing of [
			"条件:",
			"保留条件",
			"根拠:",
			"条件付きに置き換える元",
		]) {
			expect(rendered).not.toContain(framing);
		}
	});

	test("World claims go through the real pipeline for all 20 tasks", () => {
		for (const task of allTasks) {
			const presented = presentWorldClaims(task);
			expect(presented.status).toBe("ready");
			expect(presented.items.map((i) => i.id)).toEqual(
				task.world.map((w) => w.id),
			);
			expect(presented.items.map((i) => i.text)).toEqual(
				task.world.map((w) => w.text),
			);
			expect(presented.digest).toBe(presentWorldClaims(task).digest);
		}
	});

	test("a claim the pipeline rejects fails the World cell, not the others", async () => {
		const [first] = (await loadTasks("tuning")).tasks;
		const broken: Task = {
			...first!,
			world: first!.world.map((w) => ({ ...w, evidence: ["nope"] })),
		};
		const report = await runDecisionEval({
			mode: "tuning",
			tasks: [broken],
			provider: createFixtureProvider("good", [broken]),
			seed: 0,
			inputBudgetTokens: 2000,
			frozen: {},
			generatedAt: GENERATED_AT,
			now: fakeClock(),
		});
		const cells = report.tasks[0]!.cells;
		expect(cells["memory-world"].error).toContain("unknown source");
		expect(cells["memory-world"].score.total).toBe(0);
		expect(cells["memory-only"].error).toBeNull();
		expect(report.tasks[0]!.worldVsMemoryOnly.verdict).toBe("incomplete");
	});

	test("the report states which parts are hand-authored", async () => {
		const { report } = await run("evaluation", "good");
		expect(report.worldAuthoring.handAuthored).toEqual([
			"statement",
			"conditions",
			"supersedes",
			"holdUntil",
		]);
		expect(report.worldAuthoring.note).toContain("手書き");
		expect(Object.keys(report.worldAuthoring.sliceDigests)).toHaveLength(
			TOTAL_TASKS,
		);
		expect(renderMarkdown(report)).toContain("World主張の作成方法");
	});

	test("restate-only fixture: plain facts already earn the text-driven axes", async () => {
		const { report } = await run("evaluation", "good");
		const c = report.summary.conditions;
		// Copying the claim text alone reaches the same requiredConditions and
		// grounding totals as World: those axes cannot show World usefulness.
		expect(c["memory-plain-facts"].axisSums.requiredConditions).toBe(
			c["memory-world"].axisSums.requiredConditions,
		);
		expect(c["memory-plain-facts"].totalScore).toBeGreaterThan(
			c["memory-only"].totalScore,
		);
		expect(report.acceptance.gate).toBe("world-vs-memory-only");
		expect(report.acceptance.framingEvidence.note).toContain("fixture");
	});

	test("a framing-blind World (same as plain facts) does not demonstrate framing", async () => {
		const { report } = await run("evaluation", "good", {
			wrap: (p) => ({
				...p,
				complete: (request) =>
					request.condition === "memory-world"
						? p.complete({
								...request,
								condition: "memory-plain-facts",
								context: request.context.map((i) => ({
									id: i.id,
									kind: i.kind === "world" ? ("fact" as const) : i.kind,
									text: i.text,
								})),
							})
						: p.complete(request),
			}),
		});
		expect(report.summary.framing.improved).toBe(0);
		expect(report.summary.framing.worse).toBe(0);
		expect(report.acceptance.framingEvidence.status).toBe("not-demonstrated");
		// The ticket gate is unchanged: it still compares with Memory-only.
		expect(report.acceptance.gate).toBe("world-vs-memory-only");
	});

	test("with framing the control separates World from plain facts (fixture only)", async () => {
		const { report } = await run("evaluation", "good");
		expect(report.summary.framing.improved).toBeGreaterThanOrEqual(5);
		expect(report.acceptance.framingEvidence.status).toBe("demonstrated");
		expect(report.acceptance.p5Accepted).toBe(false);
	});
});

describe("results are append-only and every run is logged", () => {
	test("two runs never overwrite each other and both are logged", async () => {
		const m = memoryIo();
		const args = ["--fixture", "good", "--mode", "evaluation", "--out", "o"];
		expect(await runMain(args, m.io)).toBe(0);
		expect(await runMain(args, m.io)).toBe(0);
		const stamp = runStamp(new Date(GENERATED_AT));
		const base = `o/decision-evaluation-fixture-${stamp}`;
		expect([...m.files.keys()].sort()).toEqual([
			`${base}-2.json`,
			`${base}-2.md`,
			`${base}.json`,
			`${base}.md`,
		]);
		const lines = (m.logs.get("o/runs.jsonl") ?? "").trim().split("\n");
		expect(lines).toHaveLength(2);
		const first = JSON.parse(lines[0]!);
		expect(first.mode).toBe("evaluation");
		expect(first.outcome).toBe("completed");
		expect(first.p5Accepted).toBe(false);
		expect(first.files).toEqual([`${base}.json`, `${base}.md`]);
	});

	test("an unavailable evaluation run is logged without numbers", async () => {
		const m = memoryIo();
		const code = await runMain(
			[
				"--mode",
				"evaluation",
				"--provider",
				"ollama",
				"--endpoint",
				"http://127.0.0.1:11434",
				"--model",
				"x",
				"--out",
				"o",
			],
			m.io,
		);
		expect(code).toBe(2);
		expect(m.files.size).toBe(0);
		const entry = JSON.parse((m.logs.get("o/runs.jsonl") ?? "").trim());
		expect(entry.mode).toBe("evaluation");
		expect(entry.outcome).toBe("provider-unavailable");
	});

	test("a cloud-looking model name is refused without a request", async () => {
		const m = memoryIo();
		const code = await runMain(
			[
				"--provider",
				"ollama",
				"--endpoint",
				"http://127.0.0.1:11434",
				"--model",
				"gpt-oss:120b-cloud",
			],
			m.io,
		);
		expect(code).toBe(2);
		expect(m.fetches()).toBe(0);
		expect(looksLikeCloudModel("qwen3:cloud")).toBe(true);
		expect(looksLikeCloudModel("qwen3:8b")).toBe(false);
	});
});

describe("real provider: context size, truncation, correction, redirects", () => {
	const settings = {
		model: "m",
		seed: 3,
		temperature: 0,
		inputBudgetTokens: 2000,
	};
	const requestFor = (
		task: Task,
		context = buildContext(task, "memory-world"),
	) => ({
		taskId: task.id,
		condition: "memory-world" as const,
		scope: task.scope,
		question: task.question,
		context,
		settings,
	});
	const good = JSON.stringify({ answer: "答え", citations: [], hold: false });
	interface Call {
		url: string;
		init: RequestInit;
		body: {
			messages: { role: string; content: string }[];
			options: { num_ctx: number; num_predict: number; seed: number };
		};
	}
	function fakeOllama(
		reply: (call: Call, n: number) => Record<string, unknown>,
	) {
		const calls: Call[] = [];
		const fetchImpl: FetchLike = (url, init) => {
			const call: Call = {
				url,
				init: init ?? {},
				body: JSON.parse(String(init?.body ?? "{}")),
			};
			calls.push(call);
			return Promise.resolve(Response.json(reply(call, calls.length)));
		};
		return { calls, fetchImpl };
	}
	const provider = (fetchImpl: FetchLike) =>
		createOllamaProvider({
			endpoint: "http://127.0.0.1:11434",
			model: "m",
			fetch: fetchImpl,
		});

	test("num_ctx covers the whole Japanese prompt, instructions included", async () => {
		const task = allTasks.find((t) => t.id === "D09")!;
		const request = requestFor(task);
		const prompt = buildPrompt(request);
		const fake = fakeOllama(() => ({
			message: { content: good },
			prompt_eval_count: 300,
			eval_count: 20,
		}));
		await provider(fake.fetchImpl).complete(request);
		const opts = fake.calls[0]!.body.options;
		const chars = [...prompt].length;
		// Far above the old budget*2 and above 1 token per character.
		expect(opts.num_ctx).toBeGreaterThan(settings.inputBudgetTokens * 2 - 1);
		expect(opts.num_ctx).toBeGreaterThanOrEqual(chars + NUM_PREDICT);
		expect(opts.num_ctx % 1024).toBe(0);
		expect(opts.num_predict).toBe(NUM_PREDICT);
		expect(opts.num_ctx).toBe(
			planContext([{ role: "user", content: prompt }]).numCtx,
		);
	});

	test("an oversized prompt is refused instead of silently truncated", async () => {
		const task = allTasks.find((t) => t.id === "D01")!;
		const huge = [
			{ id: "h", kind: "memory" as const, text: "あ".repeat(40_000) },
		];
		const fake = fakeOllama(() => ({ message: { content: good } }));
		await expect(
			provider(fake.fetchImpl).complete(requestFor(task, huge)),
		).rejects.toThrow("prompt too large");
		expect(fake.calls).toHaveLength(0);
		expect(MAX_NUM_CTX).toBeGreaterThan(0);
	});

	test("prompt_eval_count at or near num_ctx marks the cell truncated", async () => {
		const task = allTasks.find((t) => t.id === "D01")!;
		for (const offset of [0, 100, NUM_PREDICT - 1]) {
			const fake = fakeOllama((call) => ({
				message: { content: good },
				prompt_eval_count: call.body.options.num_ctx - offset,
			}));
			await expect(
				provider(fake.fetchImpl).complete(requestFor(task)),
			).rejects.toThrow("context truncated");
		}
		const fine = fakeOllama((call) => ({
			message: { content: good },
			prompt_eval_count: call.body.options.num_ctx - NUM_PREDICT - 1,
		}));
		const out = await provider(fine.fetchImpl).complete(requestFor(task));
		expect(out.corrections).toBe(0);
	});

	test("a truncated cell is incomplete and blocks acceptance in the report", async () => {
		const m = memoryIo((url) =>
			Promise.resolve(
				url.endsWith("/api/tags")
					? Response.json({ models: [{ name: "local-model" }] })
					: Response.json({
							message: { content: good },
							prompt_eval_count: 1_000_000,
						}),
			),
		);
		const code = await runMain(
			[
				"--provider",
				"ollama",
				"--endpoint",
				"http://127.0.0.1:11434",
				"--model",
				"local-model",
				"--out",
				"r",
			],
			m.io,
		);
		expect(code).toBe(0);
		const file = [...m.files.keys()].find((k) => k.endsWith(".json"))!;
		const json = JSON.parse(m.files.get(file)!);
		expect(json.tasks[0].cells["memory-only"].error).toContain("truncated");
	});

	test("the retry sends a corrective message and counts it honestly", async () => {
		const task = allTasks.find((t) => t.id === "D01")!;
		const fake = fakeOllama((_call, n) => ({
			message: { content: n === 1 ? "これはJSONではない" : good },
			prompt_eval_count: 100,
			eval_count: 7,
		}));
		const out = await provider(fake.fetchImpl).complete(requestFor(task));
		expect(out.corrections).toBe(1);
		expect(out.inputTokens).toBe(200);
		expect(out.outputTokens).toBe(14);
		const [a, b] = fake.calls;
		expect(a!.body.messages).toHaveLength(1);
		expect(b!.body.messages).toHaveLength(3);
		expect(b!.body.messages[1]).toEqual({
			role: "assistant",
			content: "これはJSONではない",
		});
		expect(b!.body.messages[2]).toEqual({
			role: "user",
			content: CORRECTION_MESSAGE,
		});
		expect(JSON.stringify(a!.body)).not.toBe(JSON.stringify(b!.body));
	});

	test("two invalid replies fail with the correction count, no further retry", async () => {
		const task = allTasks.find((t) => t.id === "D01")!;
		const fake = fakeOllama(() => ({ message: { content: "no json" } }));
		await expect(
			provider(fake.fetchImpl).complete(requestFor(task)),
		).rejects.toThrow("after 1 correction");
		expect(fake.calls).toHaveLength(2);
	});

	test("redirects are never followed", async () => {
		const task = allTasks.find((t) => t.id === "D01")!;
		const fake = fakeOllama(() => ({
			message: { content: good },
			prompt_eval_count: 10,
		}));
		await provider(fake.fetchImpl).complete(requestFor(task));
		expect(fake.calls[0]!.init.redirect).toBe("error");
		let tagsInit: RequestInit | undefined;
		const available = await isProviderAvailable({
			endpoint: "http://127.0.0.1:11434",
			model: "m",
			fetch: (_url, init) => {
				tagsInit = init;
				return Promise.reject(new TypeError("redirect"));
			},
		});
		expect(available).toBe(false);
		expect(tagsInit?.redirect).toBe("error");
	});
});
