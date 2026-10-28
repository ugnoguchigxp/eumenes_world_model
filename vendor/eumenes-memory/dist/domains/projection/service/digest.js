import { canonicalJson } from "../../../canonical/json.js";
import { sha256Hex } from "../../../canonical/sha256.js";
import { utf8ByteLength } from "../../../canonical/utf8.js";
export function computeViewDigest(body) {
    return sha256Hex(canonicalJson(body));
}
/** viewDigest を付け、予算判定に使う最終 JSON の UTF-8 byte 長を返す。 */
export function finalizeReadyView(body) {
    const view = {
        ...body,
        viewDigest: computeViewDigest(body),
    };
    return { view, byteLength: utf8ByteLength(canonicalJson(view)) };
}
