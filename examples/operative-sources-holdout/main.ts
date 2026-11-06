import * as fixtures from "./fixtures.ts";
import * as protocol from "./protocol.ts";
import { runComparison } from "../operative-sources-comparison/runner.ts";

await runComparison({
	fixtures,
	protocol,
	artifactFolder: "artifacts/operative-sources-holdout",
	testFile: "test/eval/operative-sources-holdout.test.ts",
	codeFolders: [
		"src",
		"examples/linked-answer-holdout",
		"examples/operative-sources-comparison",
		"examples/operative-sources-holdout",
		"examples/multi-source-comparison",
		"examples/seed-luna",
	],
});
