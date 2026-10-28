import type { ValidationReasonCode } from "../../../contracts/reason-codes.ts";
import type { SnapshotV2, ViewItemV2 } from "../../../contracts/view-v2.ts";
/**
 * V5（view の item を並び順に current と照合）と V6（current で view に入るはずの item が view にあるか）。
 * v1 との差: current 側の「view に入る item」は active かつ subject が self（省略は self）。
 * view にある item が current で `other:*` / `unknown` になっていたら、view に入れない状態なので
 * `ITEM_INACTIVE` とする。subject が self 以外の active item は ITEM_SET_CHANGED の対象にしない。
 */
export declare function diffItemsV2(viewItems: readonly ViewItemV2[], snapshot: SnapshotV2): ValidationReasonCode | null;
