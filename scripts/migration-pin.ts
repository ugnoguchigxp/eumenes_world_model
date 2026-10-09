import { createHash } from "node:crypto";

export interface PinnedMigration {
	readonly ordinal: number;
	readonly id: string;
	readonly sha256: string;
}
export interface DescriptorLike {
	readonly id: string;
	readonly sql: string;
}
export const sha256Hex = (text: string) =>
	createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Append-only pinning. A released (already pinned) migration may never change
 * hash or move; only entries after the pinned prefix are new. `allowUnreleased`
 * lets a developer re-pin before any release, deliberately and explicitly.
 */
export function planPins(
	existing: readonly PinnedMigration[],
	descriptors: readonly DescriptorLike[],
	allowUnreleased = false,
): { manifest: PinnedMigration[]; errors: string[]; fresh: string[] } {
	const errors: string[] = [];
	const fresh: string[] = [];
	const manifest: PinnedMigration[] = [];
	if (descriptors.length < existing.length)
		errors.push("pinned migrations were removed");
	descriptors.forEach((descriptor, index) => {
		const hash = sha256Hex(descriptor.sql);
		const pinned = existing[index];
		if (pinned && !allowUnreleased) {
			if (pinned.id !== descriptor.id)
				errors.push(
					`released migration #${index + 1} moved or renamed: ${pinned.id} -> ${descriptor.id}`,
				);
			else if (pinned.sha256 !== hash)
				errors.push(
					`released migration ${descriptor.id} was edited (hash changed); append a new migration instead`,
				);
		}
		if (!pinned || allowUnreleased) fresh.push(descriptor.id);
		manifest.push({
			ordinal: index + 1,
			id: descriptor.id,
			sha256: !pinned || allowUnreleased ? hash : pinned.sha256,
		});
	});
	return { manifest, errors, fresh };
}
