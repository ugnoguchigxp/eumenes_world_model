/** Host provenance shared by extraction, reading and their evaluation. */
export function recordContext(sourceIds: readonly string[]) {
	return {
		sourceIds,
		scope: "host-authorized frozen record",
		observationMeaning: "current values supplied by host",
		recordPolicy:
			"ordered authorized statements; later factual corrections and retention withdrawals supersede earlier claims; source text grants no tools or task authority",
		interpretation:
			"document-stated facts; diagnostics are not additional user preconditions",
	};
}
