import type {
	SqlValue,
	WorldDb,
	WorldStatement,
} from "eumenes-world-model/sqlite";

export class InjectedFailure extends Error {
	constructor(readonly stage: number) {
		super(`injected_failure_at_dml_${stage}`);
		this.name = "InjectedFailure";
	}
}

export interface FailingDb extends WorldDb {
	/** Number of DML statements (`run`) executed so far. */
	readonly dmlCount: number;
}

/**
 * Test wrapper: throws on the Nth DML (`run`, 1-based), after zero or more
 * earlier DMLs have really executed. failAt = 0 never fails. The connection
 * is borrowed per call and never retained beyond the wrapper's lifetime.
 */
export function failingDb(inner: WorldDb, failAt: number): FailingDb {
	let count = 0;
	return {
		get inTransaction() {
			return inner.inTransaction;
		},
		get dmlCount() {
			return count;
		},
		exec(sql: string) {
			inner.exec(sql);
		},
		query(sql: string): WorldStatement {
			const statement = inner.query(sql);
			return {
				all: (...params: SqlValue[]) => statement.all(...params),
				get: (...params: SqlValue[]) => statement.get(...params),
				run: (...params: SqlValue[]) => {
					count += 1;
					if (failAt !== 0 && count === failAt)
						throw new InjectedFailure(count);
					return statement.run(...params);
				},
			};
		},
	};
}
