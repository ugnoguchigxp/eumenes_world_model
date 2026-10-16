import {
	asRecord,
	buildWorldSlice,
	evaluateConditions,
	planAssertionTransition,
	type Assertion,
	type Condition,
	type ConditionSpec,
	type Entity,
	type ValidTime,
} from "../../src/index.ts";
import {
	applyWorldOperation,
	readAssertionHistory,
	readWorldSnapshot,
	type WorldDb,
	type WorldOperation,
} from "../../src/sqlite.ts";
import { hash, seedScope, type SeedDocument } from "../../eval/seed/corpus.ts";
import { validateOutput } from "../seed-luna/pipeline.ts";
import {
	MATERIAL_VERSION,
	VERSION,
	type Packet,
	type Question,
} from "./fixtures.ts";

export function documentInputs(packet: Packet) {
	return packet.documents.map((doc): SeedDocument => {
		const content = JSON.stringify(doc);
		return {
			recordId: doc.id,
			collection: "synthetic-multi-source-v1",
			content,
			source: {
				namespace: MATERIAL_VERSION,
				kind: "synthetic-document",
				id: doc.id,
				revision: "v1",
				digest: `sha256:${hash(Buffer.from(content))}`,
			},
		};
	});
}
export function extractionPrompt(packet: Packet) {
	return JSON.stringify({
		synthetic: true,
		entity: { id: packet.id, name: packet.name },
		observationKeys: packet.keys,
		documents: documentInputs(packet).map((doc) => ({
			id: doc.recordId,
			source: doc.source,
			text: doc.content,
		})),
	});
}
export function date(value: unknown): number {
	if (typeof value !== "string" || !value.endsWith("Z"))
		throw new Error("invalid_utc_instant");
	const result = Date.parse(value);
	if (!Number.isSafeInteger(result) || result < 0)
		throw new Error("invalid_utc_instant");
	return result;
}
export function interpret(packet: Packet, raw: string) {
	const output = asRecord(JSON.parse(raw));
	if (
		!Array.isArray(output?.["documents"]) ||
		output["documents"].length !== packet.documents.length
	)
		throw new Error("extraction_document_count");
	const entity: Entity = {
		id: packet.id,
		scope: seedScope,
		revision: 1,
		displayName: packet.name,
		aliases: [],
		externalRefs: [],
	};
	const documents = documentInputs(packet);
	const items: {
		document: SeedDocument;
		checked: ReturnType<typeof validateOutput>;
		assertion: Assertion;
	}[] = [];
	const withdrawals: { target: string; reason: string; effectiveAt: number }[] =
		[];
	for (const [index, document] of documents.entries()) {
		const item = asRecord(output["documents"][index]);
		if (!item || item["documentId"] !== document.recordId)
			throw new Error("extraction_document_order");
		const checked = validateOutput(
			document,
			entity,
			{ candidates: item["candidates"] },
			date(packet.documents[index]!.published),
		);
		const assertion = checked.assertions[0];
		if (
			!assertion ||
			checked.assertions.length !== 1 ||
			checked.bindings.some((b) => b.status !== "bound")
		)
			throw new Error(
				`extraction_not_one_valid_candidate:${document.recordId}`,
			);
		const refs = item["contradicts"];
		if (
			!Array.isArray(refs) ||
			refs.some(
				(id) =>
					typeof id !== "string" ||
					!items.some((prior) => prior.document.recordId === id),
			)
		)
			throw new Error("invalid_conflict_reference");
		let validTime: ValidTime | undefined;
		if (item["validFrom"] !== null || item["validUntil"] !== null) {
			const bound = (v: unknown) => {
				const at = date(v);
				return { earliest: at, latest: at };
			};
			validTime = {
				kind: "period",
				precision: "exact",
				original: packet.documents[index]!.statement,
				...(item["validFrom"] !== null
					? { start: bound(item["validFrom"]) }
					: {}),
				...(item["validUntil"] !== null
					? { end: bound(item["validUntil"]) }
					: {}),
			};
		}
		const changes = item["withdrawals"];
		if (!Array.isArray(changes)) throw new Error("invalid_withdrawals");
		for (const change of changes) {
			const entry = asRecord(change);
			if (
				!entry ||
				typeof entry["target"] !== "string" ||
				!items.some((prior) => prior.document.recordId === entry["target"])
			)
				throw new Error("invalid_withdrawal_target");
			withdrawals.push({
				target: entry["target"],
				reason: document.recordId,
				effectiveAt: date(entry["effectiveAt"]),
			});
		}
		items.push({
			document,
			checked,
			assertion: {
				...assertion,
				interpretationVersion: VERSION,
				contradicts: refs.map((id) => ({
					id: items.find((prior) => prior.document.recordId === id)!.assertion
						.id,
					revision: 1,
				})),
				...(validTime ? { validTime } : {}),
			},
		});
	}
	return { entity, items, withdrawals, observationKeys: packet.keys };
}
export type Interpretation = ReturnType<typeof interpret>;
const policyRevision = "multi-source-policy-v1";
function envelope(material: Interpretation) {
	return {
		contractVersion: 1,
		scope: seedScope,
		access: {
			principal: seedScope.principal,
			scopeKeys: [seedScope.scopeKey],
			purpose: "world",
			policyRevision,
		},
		hostChecks: {
			sourceSnapshot: {
				states: material.items.map((item) => item.checked.state),
			},
			forgetEpoch: "multi-source-forget-v1",
			restoreEpoch: "multi-source-restore-v1",
			policyRevision,
		},
	};
}

/** Only the host's test transaction writes; no semantic decisions are made here. */
export function persist(db: WorldDb, material: Interpretation, asOf: number) {
	const base = envelope(material);
	const apply = (key: string, operation: WorldOperation, clock = asOf) => {
		const result = applyWorldOperation(
			db,
			{ ...base, clock, operationKey: key, operation },
			{ hasher: hash },
		);
		if ("reasonCode" in result)
			throw new Error(`world_write:${result.reasonCode}`);
		return result.status;
	};
	apply(`entity:${material.entity.id}`, {
		kind: "entity.register",
		entity: {
			id: material.entity.id,
			displayName: material.entity.displayName,
			aliases: [],
			externalRefs: [],
		},
	});
	for (const item of material.items) {
		const operation = {
			kind: "assertion.register",
			assertion: item.assertion,
		} as const;
		if (
			apply(`register:${item.document.recordId}`, operation) !== "applied" ||
			apply(`register:${item.document.recordId}`, operation) !== "no_op"
		)
			throw new Error("world_register_replay_failed");
	}
	for (const withdrawal of [...material.withdrawals].sort(
		(a, b) => a.effectiveAt - b.effectiveAt,
	)) {
		if (withdrawal.effectiveAt > asOf) continue;
		const item = material.items.find(
			(i) => i.document.recordId === withdrawal.target,
		)!;
		const reason = material.items.find(
			(i) => i.document.recordId === withdrawal.reason,
		)!;
		const planned = planAssertionTransition({
			contractVersion: 1,
			scope: seedScope,
			current: {
				id: item.assertion.id,
				revision: 1,
				scope: seedScope,
				lifecycle: "candidate",
				origin: item.assertion.origin,
			},
			expectedRevision: 1,
			request: { action: "retract", reasonSource: reason.document.source },
			registeredAdoptionRules: [],
		});
		if (!planned.ok || planned.value.status !== "planned")
			throw new Error("world_retraction_not_planned");
		const operation = {
			kind: "assertion.transition",
			plan: planned.value.plan,
		} as const;
		const key = `withdraw:${withdrawal.target}:${withdrawal.reason}`;
		if (
			apply(key, operation, withdrawal.effectiveAt) !== "applied" ||
			apply(key, operation, withdrawal.effectiveAt) !== "no_op"
		)
			throw new Error("world_withdrawal_replay_failed");
	}
	return material.items.map((item) => {
		const result = readAssertionHistory(db, {
			...base,
			assertionId: item.assertion.id,
		});
		if (result.status !== "ready") throw new Error("world_history_not_ready");
		return { documentId: item.document.recordId, revisions: result.revisions };
	});
}
export function contexts(
	db: WorldDb,
	material: Interpretation,
	question: Question,
) {
	const result = readWorldSnapshot(db, {
		...envelope(material),
		asOf: question.asOf,
		focus: { subjectIds: [material.entity.id], depth: 0 },
	});
	if (result.status !== "ready") throw new Error("world_snapshot_not_ready");
	const slice = buildWorldSlice(
		{
			contractVersion: 1,
			snapshot: result.snapshot,
			request: { focusSubjectIds: [material.entity.id] },
		},
		hash,
	);
	if (
		!slice.ok ||
		slice.value.status !== "ready" ||
		!slice.value.completeness.complete
	)
		throw new Error("world_slice_incomplete");
	const evaluations = slice.value.units.map((unit) => {
		const evaluated = evaluateConditions({
			contractVersion: 1,
			asOf: question.asOf,
			authorized: true,
			maxAgeMs: 3_600_000,
			condition: unit.condition,
			...(unit.validTime ? { validTime: unit.validTime } : {}),
			observations: question.observations,
		});
		if (!evaluated.ok) throw new Error("world_condition_invalid");
		return { assertionId: unit.assertionId, ...evaluated.value };
	});
	const sources = material.items.map((i) => ({
		id: i.document.recordId,
		ref: i.document.source,
		text: i.document.content,
	}));
	return {
		raw: {
			sources,
			observationKeys: material.observationKeys,
			derivedView: null,
		},
		world: {
			sources,
			observationKeys: material.observationKeys,
			derivedView: { slice: slice.value, evaluations },
		},
	};
}
export type AnswerContext = ReturnType<typeof contexts>["raw" | "world"];

/** Lossless presentation join: a condition and its calculation travel together. */
export function linkedContext(context: AnswerContext, question?: Question) {
	if (!context.derivedView) return context;
	const { slice, evaluations } = context.derivedView;
	return {
		...context,
		derivedView: {
			slice: {
				...slice,
				units: slice.units.map((unit) => {
					const evaluation = evaluations.find(
						(e) => e.assertionId === unit.assertionId,
					);
					if (!evaluation) throw new Error("missing_unit_calculation");
					return {
						...unit,
						conditionEvaluation: evaluation,
						...(question
							? { comparisonChecks: comparisonChecks(unit.condition, question) }
							: {}),
					};
				}),
			},
		},
	};
}

/** Input binding and existing native calculation, never source interpretation.
 * These atomic checks exclude claim validity and parent boolean operators.
 */
export function comparisonChecks(
	condition: ConditionSpec | undefined,
	question: Question,
) {
	const checks: {
		path: string;
		comparison: Extract<Condition, { kind: "compare" }>;
		providedObservationIds: string[];
		evaluation: { result: string; reasons: readonly string[] };
	}[] = [];
	function visit(node: Condition, path: string) {
		if (node.kind === "compare") {
			const evaluated = evaluateConditions({
				contractVersion: 1,
				asOf: question.asOf,
				authorized: true,
				maxAgeMs: 3_600_000,
				condition: { kind: "expression", expression: node },
				observations: question.observations,
			});
			if (!evaluated.ok) throw new Error("comparison_check_invalid");
			checks.push({
				path,
				comparison: node,
				providedObservationIds: question.observations
					.filter((observation) => observation.key === node.key)
					.map((observation) => observation.observationId),
				evaluation: evaluated.value,
			});
		} else if (node.kind === "not") visit(node.item, `${path}/item`);
		else if (node.kind === "all" || node.kind === "any")
			node.items.forEach((item, index) =>
				visit(item, `${path}/items/${index}`),
			);
	}
	if (condition?.kind === "expression")
		visit(condition.expression, "/expression");
	return checks;
}
export function answerPrompt(question: Question, context: AnswerContext) {
	return JSON.stringify({
		synthetic: true,
		asOf: new Date(question.asOf).toISOString(),
		asOfEpochMs: question.asOf,
		question: question.question,
		observations: question.observations.map((observation) => ({
			...observation,
			observedAtIso: new Date(observation.observedAt).toISOString(),
		})),
		observationAvailability: Object.fromEntries(
			Object.keys(context.observationKeys).map((key) => [
				key,
				question.observations
					.filter((observation) => observation.key === key)
					.map((observation) => observation.observationId),
			]),
		),
		context: linkedContext(context, question),
	});
}
