import type { Assertion, AssertionRef } from "../contracts/assertion.ts";

/** Lifecycle revisions preserve content. A self-supersedes link ends it. */
export function referencesCurrentContent(
	ref: AssertionRef,
	head: Assertion,
): boolean {
	return (
		ref.id === head.id &&
		ref.revision <= head.revision &&
		!head.supersedes.some(
			(previous) =>
				previous.id === head.id && previous.revision >= ref.revision,
		)
	);
}
