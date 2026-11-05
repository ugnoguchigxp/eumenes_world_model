/** Nonrecursive native JSON, converted structurally to the public extraction contract. */
import { relationKinds } from "../../src/index.ts";
import {
	decodeQuotedCandidates,
	wireObject as obj,
	wireTag as tag,
	wireString as str,
	wireSubject as subject,
	wireValue as value,
} from "./quoted-wire.ts";
import type { ProviderRequest } from "../extraction/runner.ts";
const nullable = (schema: unknown) => ({ anyOf: [{ type: "null" }, schema] });
export const publicPayloadSchema = {
	anyOf: [
		obj({ kind: tag("value"), value: { $ref: "#/$defs/value" } }),
		obj({
			kind: tag("relation"),
			relation: { type: "string", enum: [...relationKinds] },
			objectId: str,
		}),
	],
};
const conditionNode = {
	anyOf: [
		obj({
			kind: tag("compare"),
			key: str,
			op: { type: "string", enum: ["eq", "ne", "lt", "lte", "gt", "gte"] },
			value: { $ref: "#/$defs/value" },
		}),
		obj({
			kind: { type: "string", enum: ["all", "any"] },
			children: { type: "array", items: { type: "integer" } },
		}),
		obj({ kind: tag("not"), child: { type: "integer" } }),
		obj({ kind: tag("unsupported") }),
	],
};
const bound = obj({
	mode: { type: "string", enum: ["range", "calendar_at", "calendar_after"] },
	first: str,
	last: str,
	offsetMinutes: { type: "integer" },
});
export const CALENDAR_BOUND_POLICY =
	"Calendar annotation convention: when a coarse boundary names one day/month/year, its uncertainty interval spans that calendar unit. Explicitly supplied endpoint ranges retain their stated endpoints. A start in a month has earliest at that month's start and latest at the next month's start. An inclusive through-month end is an exclusive boundary AFTER that month: earliest is the next month's start and latest the following month's start. These are contract uncertainty bounds, not a claim that the old value remains current. Exact boundaries have earliest=latest.";
export const typedExtractionSchema = {
	...obj({
		candidates: {
			type: "array",
			items: obj({
				quote: obj({
					utteranceId: str,
					text: str,
					occurrence: { type: "integer" },
				}),
				modality: {
					type: "string",
					enum: ["asserted", "reported", "hypothetical", "negated", "question"],
				},
				subject: { $ref: "#/$defs/subject" },
				predicate: str,
				payload: {
					anyOf: [
						obj({ kind: tag("value"), value: { $ref: "#/$defs/value" } }),
						obj({
							kind: tag("relation"),
							relation: { type: "string", enum: [...relationKinds] },
							object: { $ref: "#/$defs/subject" },
						}),
					],
				},
				condition: nullable(
					obj({ nodes: { type: "array", items: conditionNode } }),
				),
				validTime: nullable({
					anyOf: [
						obj({ kind: tag("instant"), at: str }),
						obj({
							kind: tag("period"),
							precision: {
								type: "string",
								enum: ["exact", "day", "month", "year"],
							},
							original: str,
							start: nullable(bound),
							end: nullable(bound),
						}),
					],
				}),
			}),
		},
	}),
	$defs: { subject, value },
};
function record(x: unknown): Record<string, unknown> {
	if (!x || typeof x !== "object" || Array.isArray(x))
		throw Error("TYPED_WIRE_OBJECT");
	return x as Record<string, unknown>;
}
/** Enforce only declared wire types; never repair a model's semantic selection. */
export function assertDeclaredPayloads(
	candidates: readonly unknown[],
	catalog: readonly { name: string; payload: string }[],
	entityIds: readonly string[],
) {
	for (const raw of candidates) {
		const c = record(raw);
		const declaration = catalog.find((p) => p.name === c["predicate"]);
		if (!declaration) throw Error("CATALOG_PAYLOAD_PREDICATE");
		const [head, ...attrs] = declaration.payload.split(",");
		const parts = head?.split(":");
		if (parts?.length !== 2) throw Error("CATALOG_PAYLOAD_DECLARATION");
		const [kind, type] = parts;
		const p = record(c["payload"]);
		if (
			kind === "relation" &&
			!attrs.length &&
			p["kind"] === "relation" &&
			p["relation"] === type
		)
			continue;
		if (kind !== "value" || p["kind"] !== "value")
			throw Error("CATALOG_PAYLOAD_KIND");
		const v = record(p["value"]);
		if (v["kind"] !== type) throw Error("CATALOG_PAYLOAD_TYPE");
		if (type === "number") {
			if (
				attrs.length > 1 ||
				attrs.some((a) => !a.startsWith("unit:") || a.slice(5) !== v["unit"])
			)
				throw Error("CATALOG_PAYLOAD_UNIT");
		} else if (attrs.length || !["string", "boolean", "entity"].includes(type!))
			throw Error("CATALOG_PAYLOAD_DECLARATION");
		if (type === "entity" && !entityIds.includes(String(v["entityId"])))
			throw Error("CATALOG_PAYLOAD_ENTITY");
	}
}
function keys(x: Record<string, unknown>, expected: string[]) {
	if (
		Object.keys(x).length !== expected.length ||
		Object.keys(x).some((k) => !expected.includes(k))
	)
		throw Error("TYPED_WIRE_KEYS");
}
function decodeBound(raw: unknown, precision: unknown) {
	const b = record(raw);
	keys(b, ["mode", "first", "last", "offsetMinutes"]);
	if (b["mode"] === "range") {
		if (
			typeof b["first"] !== "string" ||
			typeof b["last"] !== "string" ||
			b["offsetMinutes"] !== 0
		)
			throw Error("CALENDAR_BOUND_INVALID");
		return { earliest: b["first"], latest: b["last"] };
	}
	if (
		!["calendar_at", "calendar_after"].includes(String(b["mode"])) ||
		typeof b["first"] !== "string" ||
		b["last"] !== "" ||
		!Number.isSafeInteger(b["offsetMinutes"]) ||
		Math.abs(b["offsetMinutes"] as number) > 840
	)
		throw Error("CALENDAR_BOUND_INVALID");

	// ISO calendar components are an external wire representation, not prose.
	const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(b["first"]);
	const count =
		precision === "year"
			? 1
			: precision === "month"
				? 2
				: precision === "day"
					? 3
					: 0;
	if (
		!m ||
		!count ||
		m.slice(1).filter((s) => s !== undefined).length !== count
	)
		throw Error("CALENDAR_BOUND_PRECISION");
	const y = Number(m[1]),
		month = Number(m[2] ?? "1"),
		day = Number(m[3] ?? "1");
	let start = Date.parse(
		`${m[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00.000Z`,
	);
	const check = new Date(start);
	if (
		!Number.isFinite(start) ||
		check.getUTCFullYear() !== y ||
		check.getUTCMonth() + 1 !== month ||
		check.getUTCDate() !== day
	)
		throw Error("CALENDAR_BOUND_DATE");
	const next = (at: number) => {
		const d = new Date(at);
		if (precision === "year") d.setUTCFullYear(d.getUTCFullYear() + 1);
		else if (precision === "month") d.setUTCMonth(d.getUTCMonth() + 1);
		else d.setUTCDate(d.getUTCDate() + 1);
		return d.getTime();
	};
	if (b["mode"] === "calendar_after") start = next(start);
	const offset = (b["offsetMinutes"] as number) * 60000;
	return { earliest: start - offset, latest: next(start) - offset };
}
function condition(x: unknown): unknown {
	if (x === null) return undefined;
	const root = record(x);
	keys(root, ["nodes"]);
	const nodes = root["nodes"];
	if (!Array.isArray(nodes) || !nodes.length || nodes.length > 64)
		throw Error("TYPED_WIRE_NODES");
	const referenced = new Set<number>();
	const built: unknown[] = [];
	const depths: number[] = [];
	nodes.forEach((raw, index) => {
		const n = record(raw);
		const child = (id: unknown) => {
			if (
				!Number.isSafeInteger(id) ||
				(id as number) < 0 ||
				(id as number) >= index
			)
				throw Error("TYPED_WIRE_BACK_REFERENCE");
			referenced.add(id as number);
			return built[id as number];
		};
		let depth = 1;
		switch (n["kind"]) {
			case "compare":
				keys(n, ["kind", "key", "op", "value"]);
				built.push(n);
				break;
			case "unsupported":
				keys(n, ["kind"]);
				built.push(n);
				break;
			case "all":
			case "any": {
				keys(n, ["kind", "children"]);
				if (!Array.isArray(n["children"]) || !n["children"].length)
					throw Error("TYPED_WIRE_CHILDREN");
				const children = n["children"];
				const items = children.map(child);
				depth = 1 + Math.max(...children.map((i) => depths[i as number]!));
				built.push({ kind: n["kind"], items });
				break;
			}
			case "not":
				keys(n, ["kind", "child"]);
				built.push({ kind: "not", item: child(n["child"]) });
				depth = 1 + depths[n["child"] as number]!;
				break;
			default:
				throw Error("TYPED_WIRE_KIND");
		}
		if (depth > 8) throw Error("TYPED_WIRE_DEPTH");
		depths.push(depth);
	});
	if (referenced.size !== nodes.length - 1)
		throw Error("TYPED_WIRE_UNUSED_NODE");
	return { kind: "expression", expression: built.at(-1) };
}
export function decodeTypedCandidates(
	text: string,
	window: ProviderRequest["window"],
) {
	const root = record(JSON.parse(text));
	keys(root, ["candidates"]);
	if (!Array.isArray(root["candidates"]) || root["candidates"].length > 64)
		throw Error("TYPED_WIRE_CANDIDATES");
	const converted = root["candidates"].map((raw) => {
		const c = record(raw);
		keys(c, [
			"subject",
			"predicate",
			"payload",
			"quote",
			"modality",
			"condition",
			"validTime",
		]);
		const { condition: rawCondition, validTime, ...rest } = c;
		const cond = condition(rawCondition);
		let t: unknown = undefined;
		if (validTime !== null) {
			const v = record(validTime);
			t = Object.fromEntries(
				Object.entries(v).filter(
					([key, val]) => !(val === null && (key === "start" || key === "end")),
				),
			);
			if (v["kind"] === "period") {
				const period = t as Record<string, unknown>;
				for (const key of ["start", "end"])
					if (period[key] !== undefined)
						period[key] = decodeBound(period[key], v["precision"]);
			}
		}
		return {
			...rest,
			conditionJson: cond === undefined ? "" : JSON.stringify(cond),
			validTimeJson: t === undefined ? "" : JSON.stringify(t),
		};
	});
	return decodeQuotedCandidates(
		JSON.stringify({ candidates: converted }),
		window,
	);
}
