import type { AccessReasonCode } from "../../../contracts/reason-codes.ts";
import type { AccessContext, Snapshot } from "../../../contracts/types.ts";
/** build 2a–2d と validate V3 の共通判定。通れば null。 */
export declare function checkAccess(access: AccessContext, snapshot: Pick<Snapshot, "principal" | "scopeKey" | "policyRevision" | "complete">): AccessReasonCode | null;
