import { asRecord, firstUnknownKey } from "../../src/contracts/index.ts";

/** Index string leaves using standard JSON Pointer; preserve the original bytes. */
function stringLocations(content: string) {
	const leaves = new Map<string, { text: string; start: number }>();
	let serialized = "";
	function visit(value: unknown, pointer: string): void {
		if (typeof value === "string") {
			leaves.set(pointer, { text: value, start: serialized.length + 1 });
			serialized += JSON.stringify(value);
		} else if (Array.isArray(value)) {
			serialized += "[";
			value.forEach((item, index) => {
				if (index !== 0) serialized += ",";
				visit(item, `${pointer}/${index}`);
			});
			serialized += "]";
		} else if (value !== null && typeof value === "object") {
			serialized += "{";
			Object.entries(value).forEach(([key, item], index) => {
				if (index !== 0) serialized += ",";
				serialized += `${JSON.stringify(key)}:`;
				const token = key.replaceAll("~", "~0").replaceAll("/", "~1");
				visit(item, `${pointer}/${token}`);
			});
			serialized += "}";
		} else serialized += JSON.stringify(value);
	}
	visit(JSON.parse(content), "");
	if (serialized !== content)
		throw new Error("luna_source_representation_mismatch");
	return leaves;
}

/** The model selects a field; the host cites that entire exact string value. */
export function bindQuotes(raw: unknown, utteranceId: string, content: string) {
	const output = asRecord(raw);
	if (!output || !Array.isArray(output["candidates"]))
		throw new Error("luna_malformed_output");
	if (output["candidates"].length > 8)
		throw new Error("luna_candidate_overflow");
	const locations = stringLocations(content);
	const bindings: { index: number; status: string }[] = [];
	const candidates = output["candidates"].map((value, index) => {
		const candidate = asRecord(value);
		const quote = asRecord(candidate?.["quote"]);
		const pointer = quote?.["pointer"];
		if (
			!candidate ||
			!quote ||
			typeof pointer !== "string" ||
			firstUnknownKey(quote, ["utteranceId", "pointer"]) !== undefined
		)
			throw new Error("luna_malformed_quote");
		const location = locations.get(pointer);
		const bound =
			location !== undefined &&
			location.text.length > 0 &&
			quote["utteranceId"] === utteranceId;
		const charStart = location?.start ?? -1;
		const charEnd =
			location === undefined
				? -1
				: location.start + JSON.stringify(location.text).slice(1, -1).length;
		bindings.push({ index, status: bound ? "bound" : "unverifiable" });
		return {
			...candidate,
			quote: {
				utteranceId: quote["utteranceId"],
				startByte: bound ? Buffer.byteLength(content.slice(0, charStart)) : -1,
				endByte: bound ? Buffer.byteLength(content.slice(0, charEnd)) : -1,
			},
		};
	});
	return { output: { ...output, candidates }, bindings };
}
