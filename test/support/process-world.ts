/** Isolated test-host process. Its DB path is always supplied by the test parent. */
import { Database } from "bun:sqlite";
import { migrations, type WorldDb, type SqlValue } from "../../src/sqlite.ts";
import { apply, registerClaim } from "../scenario/world-fixture.ts";
import { forgetChunk, sourceRoot } from "../scenario/forget-fixture.ts";
const [path, mode, kind, stageRaw] = process.argv.slice(2);
if (import.meta.main) {
	if (!path || !mode || !["register", "forget"].includes(kind ?? ""))
		throw new Error("invalid process fixture arguments");
	const db = new Database(path, { create: true });
	db.exec(
		"PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;",
	);
	if (
		!db
			.query("SELECT name FROM sqlite_master WHERE name='world_schema_info'")
			.get()
	)
		for (const sql of migrations) db.transaction(() => db.exec(sql))();
	const op =
		kind === "forget"
			? forgetChunk("process-forget", "fg-process", [sourceRoot(1)])
			: registerClaim("process-operation", { id: "process-new" });
	const dump = () =>
		Object.fromEntries(
			(
				db
					.query(
						"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'world_%' ORDER BY name",
					)
					.all() as { name: string }[]
			).map(({ name }) => [
				name,
				db.query(`SELECT * FROM ${name} ORDER BY rowid`).all(),
			]),
		);
	if (mode === "init") {
		db.transaction(() => apply(db, registerClaim("seed")))();
		console.log(JSON.stringify(dump()));
	} else if (mode === "dump") console.log(JSON.stringify(dump()));
	else if (mode === "replay")
		console.log(JSON.stringify(db.transaction(() => apply(db, op))()));
	else {
		let dml = 0;
		const killAt = Number(stageRaw);
		const wrapped: WorldDb = {
			get inTransaction() {
				return db.inTransaction;
			},
			exec(sql) {
				db.exec(sql);
			},
			query(sql) {
				const s = db.query(sql);
				return {
					all: (...p: SqlValue[]) => s.all(...p),
					get: (...p: SqlValue[]) => s.get(...p),
					run: (...p: SqlValue[]) => {
						dml++;
						const value = s.run(...p);
						if (mode === "kill" && dml === killAt) process.exit(97);
						return value;
					},
				};
			},
		};
		const rollback = new Error("count-only");
		try {
			db.transaction(() => {
				apply(wrapped, op);
				if (mode === "count") throw rollback;
				if (mode === "before-commit") process.exit(97);
			})();
		} catch (error) {
			if (error !== rollback) throw error;
		}
		if (mode === "after-commit") process.exit(98);
		console.log(JSON.stringify({ dml }));
	}
	db.close();
}
