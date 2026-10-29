/**
 * Real SQLite-backed D1DatabaseLike test double using Node 24's built-in node:sqlite.
 * Runs the actual migrations/0001_contact.sql schema and enforces all SQLite constraints & transactions.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
} from "../../src/contact/storage.ts";

export interface TestD1Controller {
  db: D1DatabaseLike;
  rawDb: DatabaseSync;
  failNextBatch: boolean;
  failNextQuery: boolean;
  failOnSecondBatchStatement: boolean;
}

class SqlitePreparedStatement implements D1PreparedStatementLike {
  private readonly rawDb: DatabaseSync;
  private readonly sql: string;
  private readonly boundValues: unknown[];
  private readonly controller: TestD1Controller;

  constructor(
    rawDb: DatabaseSync,
    sql: string,
    boundValues: unknown[],
    controller: TestD1Controller
  ) {
    this.rawDb = rawDb;
    this.sql = sql;
    this.boundValues = boundValues;
    this.controller = controller;
  }

  bind(...values: unknown[]): D1PreparedStatementLike {
    return new SqlitePreparedStatement(
      this.rawDb,
      this.sql,
      values,
      this.controller
    );
  }

  private normalizeParams(): Record<number, string | number | bigint | Uint8Array | null> {
    const params: Record<number, string | number | bigint | Uint8Array | null> = {};
    // Map ?1, ?2, ... positional parameters
    for (let i = 0; i < this.boundValues.length; i++) {
      const val = this.boundValues[i];
      if (val === undefined || val === null) {
        params[i + 1] = null;
      } else if (typeof val === "boolean") {
        params[i + 1] = val ? 1 : 0;
      } else {
        params[i + 1] = val as string | number | bigint | Uint8Array;
      }
    }
    return params;
  }

  private executeInternal(): {
    rows?: Record<string, unknown>[];
    changes?: number;
  } {
    if (this.controller.failNextQuery) {
      this.controller.failNextQuery = false;
      throw new Error("Simulated D1 query failure");
    }

    // Replace ?1, ?2, ... with $p1, $p2, ... so node:sqlite named parameter binding works cleanly
    // even when the same parameter (?3) is referenced multiple times in one statement!
    const namedParams: Record<string, string | number | bigint | Uint8Array | null> = {};
    const convertedSql = this.sql.replace(/\?(\d+)/g, (_match, numStr) => {
      const idx = Number(numStr) - 1;
      const key = `$p${numStr}`;
      const rawVal = this.boundValues[idx];
      if (rawVal === undefined || rawVal === null) {
        namedParams[key] = null;
      } else if (typeof rawVal === "boolean") {
        namedParams[key] = rawVal ? 1 : 0;
      } else {
        namedParams[key] = rawVal as string | number | bigint | Uint8Array;
      }
      return key;
    });

    const stmt = this.rawDb.prepare(convertedSql);
    const trimmedUpper = convertedSql.trim().toUpperCase();
    if (trimmedUpper.startsWith("SELECT")) {
      const rows = stmt.all(namedParams) as Record<string, unknown>[];
      return { rows };
    }
    const res = stmt.run(namedParams);
    return { changes: Number(res.changes ?? 0) };
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
    const { rows } = this.executeInternal();
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    if (colName) {
      return ((row as Record<string, unknown>)[colName] as T) ?? null;
    }
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const { rows } = this.executeInternal();
    return { results: (rows ?? []) as T[] };
  }

  async run(): Promise<{ success: boolean; meta?: { changes?: number } }> {
    const { changes } = this.executeInternal();
    return {
      success: true,
      meta: { changes: changes ?? 0 },
    };
  }

  runSyncForBatch(): unknown {
    return this.executeInternal();
  }
}

export function createTestD1(): TestD1Controller {
  const rawDb = new DatabaseSync(":memory:");
  rawDb.exec("PRAGMA foreign_keys = ON;");

  const migrationPath = resolve(process.cwd(), "migrations/0001_contact.sql");
  const migrationSql = readFileSync(migrationPath, "utf8");
  rawDb.exec(migrationSql);

  const controller: TestD1Controller = {
    rawDb,
    failNextBatch: false,
    failNextQuery: false,
    failOnSecondBatchStatement: false,
    db: {
      prepare(query: string): D1PreparedStatementLike {
        return new SqlitePreparedStatement(rawDb, query, [], controller);
      },
      async batch<T = unknown>(
        statements: D1PreparedStatementLike[]
      ): Promise<T[]> {
        if (controller.failNextBatch) {
          controller.failNextBatch = false;
          throw new Error("Simulated D1 batch failure");
        }

        rawDb.exec("BEGIN IMMEDIATE TRANSACTION;");
        try {
          const results: T[] = [];
          for (let i = 0; i < statements.length; i++) {
            if (controller.failOnSecondBatchStatement && i === 1) {
              controller.failOnSecondBatchStatement = false;
              throw new Error("Simulated mid-batch SQL failure on 2nd statement");
            }
            const stmt = statements[i] as SqlitePreparedStatement;
            const res = stmt.runSyncForBatch();
            results.push(res as T);
          }
          rawDb.exec("COMMIT;");
          return results;
        } catch (err) {
          rawDb.exec("ROLLBACK;");
          throw err;
        }
      },
    },
  };

  return controller;
}
