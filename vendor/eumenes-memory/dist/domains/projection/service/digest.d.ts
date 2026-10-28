import type { ReadyMemoryView } from "../../../contracts/types.ts";
import type { ReadyBody } from "./compose.ts";
export declare function computeViewDigest(body: ReadyBody): string;
/** viewDigest を付け、予算判定に使う最終 JSON の UTF-8 byte 長を返す。 */
export declare function finalizeReadyView(body: ReadyBody): {
    view: ReadyMemoryView;
    byteLength: number;
};
