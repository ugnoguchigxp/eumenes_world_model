import type { ValidationReasonCode } from "../../../contracts/reason-codes.ts";
import type { Snapshot, SourceRef, ViewItem } from "../../../contracts/types.ts";
/** kind / text / origin / primarySource / 正規化済み dependencies の比較用 JSON。 */
export declare function contentFingerprint(item: {
    readonly kind: string;
    readonly text: string;
    readonly origin: string;
    readonly primarySource: SourceRef;
    readonly dependencies: readonly SourceRef[];
}): string;
/**
 * V5（view の item を並び順に current と照合）と V6（current の active item が
 * view にあるか）。最初の差分の reasonCode を返す。
 */
export declare function diffItems(viewItems: readonly ViewItem[], snapshot: Snapshot): ValidationReasonCode | null;
