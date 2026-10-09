import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DependentRef } from "../../src/contracts/index.ts";

/**
 * TEST FIXTURE ONLY. This journal adapter keeps the "latest external journal"
 * in memory (optionally mirrored to a temp file). It is NOT the product
 * journal: durability of the real forget/restore journal is not accepted
 * before P3-05. The old database is simply a store that never saw the forgets
 * recorded here, so the two are always separate objects.
 */
export interface JournalEntry {
	readonly ref: DependentRef;
	readonly forgetId: string;
	readonly reasonCode:
		| "FORGET_REQUESTED"
		| "SOURCE_FORGOTTEN"
		| "CORRECTION_APPLIED"
		| "AUTHORIZATION_REVOKED";
}
export interface JournalHead {
	readonly seq: number;
	readonly tombstones: readonly JournalEntry[];
}

export interface JournalFixture {
	append(entries: readonly JournalEntry[]): void;
	/** Head as the host would read it: the sequence number and every tombstone. */
	head(): JournalHead;
	/** Simulates a journal restored from an older copy: the sequence goes back. */
	rollbackTo(seq: number): void;
	dispose(): void;
}

export function createJournal(
	options: { file?: boolean } = {},
): JournalFixture {
	let seq = 0;
	let entries: JournalEntry[] = [];
	const history: { seq: number; count: number }[] = [];
	const directory = options.file
		? mkdtempSync(join(tmpdir(), "eumenes-world-journal-"))
		: undefined;
	const path =
		directory === undefined ? undefined : join(directory, "journal.json");
	const persist = () => {
		if (path !== undefined)
			writeFileSync(path, JSON.stringify({ seq, entries }));
	};
	const load = (): { seq: number; entries: JournalEntry[] } =>
		path === undefined
			? { seq, entries }
			: (JSON.parse(readFileSync(path, "utf8")) as {
					seq: number;
					entries: JournalEntry[];
				});
	return {
		append(next) {
			entries = [...entries, ...next];
			seq += 1;
			history.push({ seq, count: entries.length });
			persist();
		},
		head() {
			const current = load();
			return { seq: current.seq, tombstones: current.entries };
		},
		rollbackTo(target) {
			const point = [...history].reverse().find((item) => item.seq <= target);
			entries = entries.slice(0, point?.count ?? 0);
			seq = target;
			persist();
		},
		dispose() {
			if (directory !== undefined)
				rmSync(directory, { recursive: true, force: true });
		},
	};
}
