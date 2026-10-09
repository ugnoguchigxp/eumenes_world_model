import {
	asRecord,
	canonicalBytes,
	canonicalDigest,
	limits,
	type CanonicalHasher,
	type Checked,
	type Digest,
} from "../../contracts/index.ts";
import type { WorldOperationInput } from "./types.ts";

/** Operations whose documented limits (500 targets of long IDs...) exceed 64KiB. */
const largeOperationBytes = 4 * 1024 * 1024;
const largeKinds = new Set([
	"forget.chunk",
	"invalidate",
	"candidate.settle",
	"inbox.receive",
	"restore.register",
	"restore.reconcile",
]);

const decoder = new TextDecoder();
/** Set-valued field: canonical element order, so a reordered resend is the same operation. */
function sortSet(value: unknown): unknown {
	if (!Array.isArray(value)) return value;
	const keyed = value.map((item) => {
		const bytes = canonicalBytes(item, largeOperationBytes);
		return { item, text: bytes.ok ? decoder.decode(bytes.value) : "" };
	});
	keyed.sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
	return keyed.map((entry) => entry.item);
}

/** The operation with every set-valued field in canonical order. */
export function normalizedOperation(
	operation: WorldOperationInput["operation"],
): unknown {
	const op = operation as unknown as Record<string, unknown>;
	switch (operation.kind) {
		case "forget.chunk":
			return { ...op, roots: sortSet(op["roots"]) };
		case "invalidate":
			return {
				...op,
				targets: sortSet(op["targets"]),
				...(op["sourceKeys"] === undefined
					? {}
					: { sourceKeys: sortSet(op["sourceKeys"]) }),
			};
		case "restore.register":
			return { ...op, registrations: sortSet(op["registrations"]) };
		case "restore.reconcile": {
			const journal = asRecord(op["journal"]);
			return journal
				? {
						...op,
						journal: { ...journal, tombstones: sortSet(journal["tombstones"]) },
					}
				: op;
		}
		case "candidate.settle": {
			const manifest = asRecord(op["manifest"]);
			return manifest
				? {
						...op,
						manifest: {
							...manifest,
							dependencies: sortSet(manifest["dependencies"]),
						},
					}
				: op;
		}
		default:
			return op;
	}
}

/**
 * Replay digest of an operation: contract version, Scope and the normalized
 * operation. operationKey and clock are excluded. Operations whose meaning
 * depends on the host's restore epoch (restore.*, rebuild) include it, so a
 * reused key under a new epoch is a different operation, not a silent no_op.
 */
export function operationDigest(
	input: WorldOperationInput,
	hasher: CanonicalHasher,
): Checked<Digest> {
	const kind = input.operation.kind;
	const epochBound = kind.startsWith("restore.") || kind === "rebuild";
	return canonicalDigest(
		{
			contractVersion: input.contractVersion,
			scope: input.scope,
			operation: normalizedOperation(input.operation),
			...(epochBound ? { restoreEpoch: input.hostChecks.restoreEpoch } : {}),
		},
		hasher,
		largeKinds.has(kind) ? largeOperationBytes : limits.payloadBytes,
	);
}
