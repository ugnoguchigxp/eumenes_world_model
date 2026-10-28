import type { StateValue } from "../contracts/index.ts";
/**
 * 値の等価。text・polarity・attributes（キーの集合と各値）がすべて同じなら true。
 * `attributes` の省略と空オブジェクトは同じとみなす。冪等判定（`unchanged`）と、
 * 同 key の別値判定（supersede / dispute）に使う。
 */
export declare function stateValueEquals(a: StateValue, b: StateValue): boolean;
