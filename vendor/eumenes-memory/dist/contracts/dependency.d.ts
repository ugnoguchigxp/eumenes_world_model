/** Shared dependency and tombstone protocol; no lifecycle policy. */
/** `memory_dependency` の辺（dependent が dependency に依存する）の種別と役割。 */
export declare const DEPENDENCY_ROLES: readonly ["primary", "support", "input", "derived_from"];
export type DependencyRole = (typeof DEPENDENCY_ROLES)[number];
/** 依存する側。`external` は外部ドメインの派生物（`ExternalDependent`）。 */
export declare const DEPENDENT_NODE_TYPES: readonly ["state_item", "candidate", "extraction_run", "external"];
export type DependentNodeType = (typeof DEPENDENT_NODE_TYPES)[number];
/** 依存される側。`source` の id は `SourceKey`（会話 message と Records の両方）。 */
export declare const DEPENDENCY_NODE_TYPES: readonly ["source", "state_item", "candidate", "extraction_run"];
export type DependencyNodeType = (typeof DEPENDENCY_NODE_TYPES)[number];
/** 墓標が付く対象。`record`（recordId）と `source`（SourceKey）は別行。 */
export declare const TOMBSTONE_TARGET_TYPES: readonly ["record", "source", "state_item", "candidate", "extraction_run", "external"];
export type TombstoneTargetType = (typeof TOMBSTONE_TARGET_TYPES)[number];
