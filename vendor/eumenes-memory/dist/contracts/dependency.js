/** Shared dependency and tombstone protocol; no lifecycle policy. */
/** `memory_dependency` の辺（dependent が dependency に依存する）の種別と役割。 */
export const DEPENDENCY_ROLES = Object.freeze([
    "primary",
    "support",
    "input",
    "derived_from",
]);
/** 依存する側。`external` は外部ドメインの派生物（`ExternalDependent`）。 */
export const DEPENDENT_NODE_TYPES = Object.freeze([
    "state_item",
    "candidate",
    "extraction_run",
    "external",
]);
/** 依存される側。`source` の id は `SourceKey`（会話 message と Records の両方）。 */
export const DEPENDENCY_NODE_TYPES = Object.freeze([
    "source",
    "state_item",
    "candidate",
    "extraction_run",
]);
/** 墓標が付く対象。`record`（recordId）と `source`（SourceKey）は別行。 */
export const TOMBSTONE_TARGET_TYPES = Object.freeze([
    "record",
    "source",
    "state_item",
    "candidate",
    "extraction_run",
    "external",
]);
