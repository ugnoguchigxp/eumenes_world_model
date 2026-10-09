import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAsyncFunction } from "node:util/types";
import { migrations, type WorldDb } from "eumenes-world-model/sqlite";

type SyncResult<T> = T extends PromiseLike<unknown> ? never : T;

export interface TestStore {
	readonly path: string;
	read<T>(operation: (db: WorldDb) => SyncResult<T>): T;
	write<T>(operation: (db: WorldDb) => SyncResult<T>): T;
	close(): void;
}

function synchronous<T>(operation: (db: WorldDb) => T, db: WorldDb): T {
	if (isAsyncFunction(operation)) throw new Error("async_transaction_callback");
	const value = operation(db);
	if (
		value !== null &&
		(typeof value === "object" || typeof value === "function") &&
		"then" in value &&
		typeof value.then === "function"
	) {
		throw new Error("async_transaction_callback");
	}
	return value;
}

/** Test host only. File/WAL is the default; :memory: cannot test reader isolation. */
export function openTestStore(
	options: { mode?: "file" | "memory"; migrations?: readonly string[] } = {},
): TestStore {
	const memory = options.mode === "memory";
	const directory = memory
		? undefined
		: mkdtempSync(join(tmpdir(), "eumenes-world-test-"));
	const path =
		directory === undefined ? ":memory:" : join(directory, "world.sqlite");
	let writer: Database | undefined;
	let reader: Database | undefined;

	function dispose() {
		try {
			if (reader !== writer) reader?.close();
		} finally {
			try {
				writer?.close();
			} finally {
				if (directory !== undefined)
					rmSync(directory, { recursive: true, force: true });
			}
		}
	}

	try {
		writer = new Database(path, { create: true });
		writer.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1000;");
		if (!memory) writer.exec("PRAGMA journal_mode = WAL;");
		// Materialize the fresh empty database before opening a readonly connection.
		// This is test-host initialization, before any product migration is applied.
		writer.exec("PRAGMA user_version = 0;");
		const db = writer;
		for (const sql of options.migrations ?? migrations) {
			db.transaction(() => db.exec(sql))();
		}
		reader = memory ? writer : new Database(path, { readonly: true });
		reader.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 1000;");
	} catch (error) {
		dispose();
		throw error;
	}

	// No cast: this assignment is also the driver/port compatibility check.
	const writeDb: Database & WorldDb = writer;
	const readDb: Database & WorldDb = reader;
	let closed = false;
	function assertOpen() {
		if (closed) throw new Error("test_store_closed");
	}
	return {
		path,
		read(operation) {
			assertOpen();
			return readDb.transaction(() => synchronous(operation, readDb))();
		},
		write(operation) {
			assertOpen();
			return writeDb.transaction(() => synchronous(operation, writeDb))();
		},
		close() {
			if (closed) return;
			closed = true;
			dispose();
		},
	};
}
