/**
 * World condition built through the real World pure pipeline.
 *
 * What is real: every World claim is turned into a ledger-shaped assertion
 * record, validated, scoped, source-checked and presented by
 * `buildWorldSlice` from the public barrel. The claim shown to the model is
 * the slice unit (conclusion, sources, status, freshness), not free text
 * copied around the harness. A claim whose record is rejected, or a slice
 * that is not `ready`, makes the World cell fail instead of silently falling
 * back to the hand-written text.
 *
 * What is NOT real, and stated plainly: in this version the claim statement
 * and the natural-language condition / supersedes / holdUntil framing of
 * every task are hand-authored (see HAND_AUTHORED). The pure pipeline has no
 * way to derive them from the Memory/related sources: ConditionSpec only
 * evaluates structured observations, and the tasks carry none. So this
 * module proves the claims survive the real validation and presentation
 * path; it does not prove World can produce them. Usefulness is therefore
 * judged against the plain-facts control (same statements, no framing), not
 * by the Memory-only comparison alone.
 */
import { createHash } from "node:crypto";
import {
	buildWorldSlice,
	type SliceReasonCode,
	type SliceStatus,
} from "../../src/index.ts";
import type { ContextItem, SourceItem, Task, WorldClaim } from "./types.ts";

/** Fixed clock so the slice is reproducible. */
export const PIPELINE_AS_OF = 1_791_500_000_000;
const PRINCIPAL = "decision-eval";

/** Which parts of a World claim are authored by hand rather than derived. */
export const HAND_AUTHORED = [
	"statement",
	"conditions",
	"supersedes",
	"holdUntil",
] as const;

export interface WorldPresentation {
	readonly status: SliceStatus;
	readonly reasonCodes: readonly SliceReasonCode[];
	readonly digest: string;
	readonly items: readonly ContextItem[];
}

const sha256 = (bytes: Uint8Array): string =>
	createHash("sha256").update(bytes).digest("hex");

function sourceRef(item: SourceItem) {
	return {
		namespace: "eval",
		kind: "item",
		id: item.id,
		revision: "r1",
		digest: `sha256:${sha256(new TextEncoder().encode(item.text))}`,
	};
}

function record(
	task: Task,
	claim: WorldClaim,
	sources: Map<string, SourceItem>,
) {
	return {
		id: claim.id,
		revision: 1,
		scope: { principal: PRINCIPAL, scopeKey: task.scope },
		subjectId: `${task.id}-decision`,
		predicate: "decision_claim",
		payload: {
			kind: "value",
			value: { kind: "string", value: claim.text },
		},
		evidence: claim.evidence.map((id) => {
			const item = sources.get(id);
			if (item === undefined) {
				throw new Error(`${claim.id} cites unknown source ${id}`);
			}
			return {
				evidenceId: `ev-${claim.id}-${id}`,
				kind: "document",
				stance: "supports",
				source: sourceRef(item),
				rootEvidenceId: id,
			};
		}),
		inputManifest: [],
		origin: "document_claim",
		observedAt: PIPELINE_AS_OF - 1000,
		recordedAt: PIPELINE_AS_OF - 1000,
		freshnessPolicy: { maxAgeMs: 86_400_000 },
		condition: { kind: "unspecified" },
		supersedes: [],
		contradicts: [],
		interpretationVersion: "decision-eval-1",
		lifecycle: "active",
		rootEvidenceIds: [...new Set(claim.evidence)].sort(),
	};
}

/**
 * Presents the task's World claims through the pure pipeline.
 * Throws when the pipeline rejects the input or the slice is not complete.
 */
export function presentWorldClaims(task: Task): WorldPresentation {
	const sources = new Map<string, SourceItem>(
		[...task.memory, ...task.related].map((s) => [s.id, s]),
	);
	const cited = new Map<string, SourceItem>();
	for (const claim of task.world) {
		for (const id of claim.evidence) {
			const item = sources.get(id);
			if (item !== undefined) cited.set(id, item);
		}
	}
	const result = buildWorldSlice(
		{
			contractVersion: 1,
			snapshot: {
				scope: { principal: PRINCIPAL, scopeKey: task.scope },
				asOf: PIPELINE_AS_OF,
				worldEnabled: true,
				complete: true,
				checks: {
					authorized: true,
					correctionsResolved: true,
					restoreVerified: true,
				},
				scopeEpoch: 1,
				policyRevision: "decision-eval-policy-1",
				forgetEpoch: "forget-1",
				restoreEpoch: "restore-1",
				interpretationVersion: "decision-eval-1",
				assertions: task.world.map((claim) => record(task, claim, sources)),
				sources: [...cited.values()].map((item) => ({
					...sourceRef(item),
					principal: PRINCIPAL,
					scopeKey: task.scope,
					status: "available",
				})),
			},
			request: {},
		},
		sha256,
	);
	if (!result.ok) {
		throw new Error(
			`World pipeline rejected ${task.id}: ${result.code}@${result.path}`,
		);
	}
	const slice = result.value;
	if (slice.status !== "ready") {
		throw new Error(
			`World slice for ${task.id} is ${slice.status}: ${slice.reasonCodes.join(",")}`,
		);
	}
	const items: ContextItem[] = task.world.map((claim) => {
		const unit = slice.units.find((u) => u.assertionId === claim.id);
		if (unit === undefined) {
			throw new Error(`World slice for ${task.id} omitted ${claim.id}`);
		}
		const payload = unit.conclusion.payload;
		if (payload.kind !== "value" || payload.value.kind !== "string") {
			throw new Error(`World slice for ${task.id} changed the payload kind`);
		}
		return {
			id: claim.id,
			kind: "world",
			text: payload.value.value,
			conditions: claim.conditions,
			evidence: unit.sources.map((s) => s.id),
			...(claim.supersedes === undefined
				? {}
				: { supersedes: claim.supersedes }),
			...(claim.holdUntil === undefined ? {} : { holdUntil: claim.holdUntil }),
		};
	});
	return {
		status: slice.status,
		reasonCodes: slice.reasonCodes,
		digest: slice.digest,
		items,
	};
}
