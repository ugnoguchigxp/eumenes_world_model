/**
 * Task loading with the tuning/evaluation split.
 *
 * Tuning mode imports only the tuning file; the evaluation file is loaded
 * (dynamically) solely when mode is "evaluation". Both splits are frozen by
 * digest: editing a rubric or an input after the fact changes the digest and
 * loading fails, so rubrics cannot be tuned against observed results.
 */
import { rubricDigest, taskDigest } from "./rubric.ts";
import { tuningTasks } from "./tasks-tuning.ts";
import type { Mode, Task } from "./types.ts";

export const FROZEN_DIGESTS = {
	tuning: {
		rubric: "2593f8fc8a8cc8a980b02e2c2878d1d941fe7794c65a9f88de00303e4441bd11",
		task: "6412418b34bd651320ec20d63a3454c106fd636b56ca49842ff9187004a209ee",
	},
	evaluation: {
		rubric: "bcd10cbe6573d3c6da11ab36adfbcfd8afa69084b8009130b0521b3c7d88d8a2",
		task: "68a74cb1576d83b2a0cc2f01ca3ac933c233c146140649df3f8c845275e27d97",
	},
} as const;

export const TOTAL_TASKS = 20;
export const EVALUATION_TASKS = 15;

export interface FrozenCheck {
	readonly split: "tuning" | "evaluation";
	readonly ok: boolean;
	readonly rubricDigest: string;
	readonly taskDigest: string;
}

export function checkFrozen(
	split: "tuning" | "evaluation",
	tasks: readonly Task[],
): FrozenCheck {
	const rubric = rubricDigest(tasks);
	const task = taskDigest(tasks);
	return {
		split,
		ok:
			rubric === FROZEN_DIGESTS[split].rubric &&
			task === FROZEN_DIGESTS[split].task,
		rubricDigest: rubric,
		taskDigest: task,
	};
}

function assertFrozen(split: "tuning" | "evaluation", tasks: readonly Task[]) {
	const check = checkFrozen(split, tasks);
	if (!check.ok) {
		throw new Error(
			`${split} tasks differ from the frozen digest (rubric ${check.rubricDigest}, task ${check.taskDigest})`,
		);
	}
}

export interface LoadedTasks {
	readonly tasks: readonly Task[];
	readonly digests: Readonly<Record<string, FrozenCheck>>;
}

/**
 * tuning: tuning tasks only. evaluation: tuning + evaluation tasks (all 20
 * outputs are saved; improvement is judged on the evaluation split only).
 */
export async function loadTasks(mode: Mode): Promise<LoadedTasks> {
	assertFrozen("tuning", tuningTasks);
	const digests: Record<string, FrozenCheck> = {
		tuning: checkFrozen("tuning", tuningTasks),
	};
	if (mode === "tuning") return { tasks: tuningTasks, digests };
	const { evaluationTasks } = await import("./tasks-evaluation.ts");
	assertFrozen("evaluation", evaluationTasks);
	digests["evaluation"] = checkFrozen("evaluation", evaluationTasks);
	return { tasks: [...tuningTasks, ...evaluationTasks], digests };
}
