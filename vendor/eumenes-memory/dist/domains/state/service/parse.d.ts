import type { StateSubject } from "../../../contracts/common.ts";
import type { AssertUserStateInput, EditStateInput, ListStateInput, ListStateScopesInput, ReadMemorySnapshotPartInput, StateTargetInput, StateValue } from "../contracts/index.ts";
export declare function readStateSubject(value: unknown, path: string): StateSubject;
export declare function readStateValue(value: unknown, path: string): StateValue;
export declare function parseAssertUserStateInput(value: unknown): AssertUserStateInput;
export declare function parseEditStateInput(value: unknown): EditStateInput;
/** deactivate / reactivate / retract 共通。 */
export declare function parseStateTargetInput(value: unknown): StateTargetInput;
export declare function parseListStateInput(value: unknown): ListStateInput;
export declare function parseReadSnapshotPartInput(value: unknown): ReadMemorySnapshotPartInput;
export declare function parseListStateScopesInput(value: unknown): ListStateScopesInput;
