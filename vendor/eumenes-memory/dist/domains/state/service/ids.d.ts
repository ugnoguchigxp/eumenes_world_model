/**
 * state item の ID（`src/domains/state/contracts/index.ts` の規則）。
 * `"state:" + sha256Hex(canonicalJson([principal, scopeKey, createdSeq]))`。
 * createdSeq は item を作る操作の seq（1 操作が作る item は高々 1 件）なので、同じ入力に対して一意。
 */
export declare function stateItemId(principal: string, scopeKey: string, createdSeq: number): string;
