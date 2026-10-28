import type { RunRef } from "../../../contracts/common.ts";
/**
 * run の ID（`src/domains/extraction/contracts/index.ts` の規則）。`jobId + ":" + attempt`。attempt は末尾の整数なので、
 * jobId に `:` を含んでも (jobId, attempt) から一意に決まる。attempt の大小は比較しない。
 */
export declare function runIdOf(run: RunRef): string;
/** 候補の ID。`"cand:" + sha256Hex(canonicalJson([runId, index]))`（index は出力内の 0 始まり位置）。 */
export declare function candidateIdOf(runId: string, index: number): string;
