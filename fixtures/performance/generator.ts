/**
 * Deterministic synthetic ledgers for the performance baseline. Everything is
 * derived from (seed, claims): no clock, no ambient randomness. Content is
 * synthetic; no real user data.
 */
import { createHash } from "node:crypto";

export interface GenOptions {
	readonly seed: number;
	readonly claims: number;
	/** Distinct subjects; default claims / 10. */
	readonly subjects?: number;
	/** Relation claims out of the hub subject (high degree); default 400. */
	readonly hubFanout?: number;
	/** Distinct source documents cited round-robin; default 50. */
	readonly sources?: number;
}

export const PERF_SCOPE = { principal: "p-perf", scopeKey: "scope-perf" };
export const PERF_NOW = 1791500000000;

/** mulberry32: small, fast, fully deterministic. */
export function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const sha = (text: string) =>
	createHash("sha256").update(text, "utf8").digest("hex");

export function sourceRef(k: number) {
	return {
		namespace: "conversation",
		kind: "message",
		id: `src-${k}`,
		revision: "rev-1",
		digest: sha(`synthetic-content-${k}`),
	};
}
export function sourceStates(count: number) {
	return Array.from({ length: count }, (_, k) => ({
		...sourceRef(k),
		principal: PERF_SCOPE.principal,
		scopeKey: PERF_SCOPE.scopeKey,
		status: "available",
	}));
}

export function claimAt(index: number, options: GenOptions) {
	const subjects = options.subjects ?? Math.max(10, options.claims / 10);
	const hubFanout = options.hubFanout ?? 400;
	const sources = options.sources ?? 50;
	const random = prng(options.seed * 1_000_003 + index);
	const k = index % sources;
	const ref = sourceRef(k);
	const subjectIndex = Math.floor(random() * subjects);
	let subjectId = `s-${subjectIndex}`;
	let payload: unknown = {
		kind: "value",
		value: { kind: "number", value: Math.floor(random() * 1000), unit: "ms" },
	};
	if (index < hubFanout) {
		// High degree: the hub points at many subjects.
		subjectId = "hub";
		payload = {
			kind: "relation",
			relation: "causes",
			objectId: `s-${index % subjects}`,
		};
	} else if (index % 5 === 0) {
		// Chains with a cycle every 50th subject: s-i -> s-(i+1), wrapping in blocks.
		const block = Math.floor(subjectIndex / 50) * 50;
		subjectId = `s-${subjectIndex}`;
		payload = {
			kind: "relation",
			relation: random() < 0.8 ? "causes" : "correlates_with",
			objectId: `s-${block + ((subjectIndex - block + 1) % 50)}`,
		};
	}
	return {
		id: `c-${String(index).padStart(7, "0")}`,
		revision: 1,
		scope: PERF_SCOPE,
		subjectId,
		predicate: index % 3 === 0 ? "latency" : "available",
		payload,
		evidence: [
			{
				evidenceId: `ev-${index}`,
				kind: "user_statement",
				stance: "supports",
				source: ref,
				rootEvidenceId: `root-${k}`,
			},
		],
		inputManifest: [ref],
		origin: "user_report",
		recordedAt: PERF_NOW,
		freshnessPolicy: { maxAgeMs: 86_400_000 },
		condition: { kind: "unspecified" },
		supersedes: [],
		contradicts: [],
		interpretationVersion: "perf-1",
		lifecycle: "candidate",
		rootEvidenceIds: [`root-${k}`],
	};
}

export function* generateClaims(options: GenOptions) {
	for (let i = 0; i < options.claims; i++) yield claimAt(i, options);
}
