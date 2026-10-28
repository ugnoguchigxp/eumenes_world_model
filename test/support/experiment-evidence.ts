import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
/** Frozen model-run evidence; compression changes storage, never the scored bytes. */
export function readExperimentEvidence(url: URL, _encoding: "utf8"): string {
	return gunzipSync(readFileSync(url)).toString("utf8");
}
