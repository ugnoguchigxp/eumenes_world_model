/** Minimal synchronous port, structurally satisfied by bun:sqlite Database. */
export type SqlValue = string | number | bigint | null | Uint8Array;

export interface WorldStatement {
	all(...params: SqlValue[]): unknown[];
	get(...params: SqlValue[]): unknown;
	run(...params: SqlValue[]): unknown;
}

/**
 * The host owns this connection and its transaction. Never retain it across calls.
 * inTransaction is required; future write APIs must reject false (or absent at runtime).
 * exec exists for schema SQL, not BEGIN/COMMIT/PRAGMA/connection management.
 * This structural type is not an authorization or readonly security boundary.
 */
export interface WorldDb {
	readonly inTransaction: boolean;
	exec(sql: string): void;
	query(sql: string): WorldStatement;
}

/** Immutable migration: sha256 is the SHA-256 (hex) of the exact `sql` UTF-8 bytes. */
export interface MigrationDescriptor {
	readonly id: string;
	readonly sql: string;
	readonly sha256: string;
}

/** Thrown by every write API when the host did not open a transaction. */
export class WorldTransactionRequiredError extends Error {
	constructor() {
		super("world_transaction_required");
		this.name = "WorldTransactionRequiredError";
	}
}
/** Unexpected row counts or inconsistent state after DML: the host must roll back. */
export class WorldIntegrityError extends Error {
	constructor(readonly reasonCode: string) {
		super(`world_integrity:${reasonCode}`);
		this.name = "WorldIntegrityError";
	}
}
/** `inTransaction` absent at runtime counts as false. */
export function requireTransaction(db: WorldDb): void {
	if ((db as { inTransaction?: unknown }).inTransaction !== true)
		throw new WorldTransactionRequiredError();
}
/** Expect `run()` to have changed exactly `count` rows; 0 is never silently success. */
export function expectChanges(
	result: unknown,
	count: number,
	reasonCode: string,
): void {
	const changes = (result as { changes?: unknown } | undefined)?.changes;
	if (changes !== count) throw new WorldIntegrityError(reasonCode);
}

/**
 * Entity IDs named anywhere inside a JSON value: `{kind:"entity", entityId}`
 * values (payload values and condition operands at any depth) and
 * `{kind:"relation", objectId}` payloads. Shared by forget discovery and the
 * tombstone guards so both agree on what "names an entity" means.
 */
export function collectEntityRefs(value: unknown, depth = 0): string[] {
	if (depth > 64 || typeof value !== "object" || value === null) return [];
	if (Array.isArray(value))
		return value.flatMap((item) => collectEntityRefs(item, depth + 1));
	const object = value as Record<string, unknown>;
	const found: string[] = [];
	if (object["kind"] === "entity" && typeof object["entityId"] === "string")
		found.push(object["entityId"]);
	if (object["kind"] === "relation" && typeof object["objectId"] === "string")
		found.push(object["objectId"]);
	for (const child of Object.values(object))
		found.push(...collectEntityRefs(child, depth + 1));
	return found;
}
