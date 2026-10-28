import type { PredicateDictionary } from "../contracts/index.ts";
export type KeyResolution = {
    readonly status: "resolved";
    readonly key: string;
    readonly predicate: string;
    readonly via: "exact" | "alias";
} | {
    readonly status: "ambiguous";
    readonly candidates: readonly string[];
} | {
    readonly status: "unknown";
};
/** 辞書の検査。predicate ID と alias の重複（別 predicate が同じ alias を持つ場合は許すが ambiguous になる）以外の不正は例外。 */
export declare function assertPredicateDictionary(dictionary: PredicateDictionary): void;
export interface KeyResolver {
    /** 確定できたときだけ正規の key。不明・曖昧は元のまま。 */
    canonical(rawKey: string): string;
    resolve(rawKey: string): KeyResolution;
}
/** 辞書を 1 度だけ検査し、照合表を作る（候補ごとに作り直さない）。 */
export declare function makeKeyResolver(dictionary: PredicateDictionary): KeyResolver;
export declare function resolveSemanticKey(rawKey: string, dictionary: PredicateDictionary): KeyResolution;
/** 確定できたときだけ正規の key を返し、それ以外は元の key のまま（統合しない）。 */
export declare function canonicalSemanticKey(rawKey: string, dictionary: PredicateDictionary | undefined): string;
/** 2 つの key が同じ対象かを、辞書で確定できる場合だけ true。不明・曖昧は false（統合しない）。 */
export declare function sameSemanticKey(a: string, b: string, dictionary: PredicateDictionary): boolean;
