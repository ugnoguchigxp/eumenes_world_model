import type { SelectionInput, SelectionResult } from "../contracts/index.ts";
export declare function requiredDigestOf(items: readonly {
    readonly id: string;
    readonly revision: string;
}[]): string;
/**
 * 適用条件を先に検査し（認可 → scope 適用 → 今回/今後 → 時間）、必須集合を確定してから、残りの予算で追加集合を順位付けする。
 * 必須の矛盾は、今回の依頼で本人が述べた指示（`explicit`）が優先し、次に明示された例外（`exception`）が、より一般の制約に対して
 * 優先する。scope が具体的だというだけでは上書きしない。解けなければ `hold`。
 */
export declare function selectContext(input: SelectionInput): SelectionResult;
