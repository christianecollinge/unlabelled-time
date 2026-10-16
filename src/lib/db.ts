// The database: Postgres at Neon in production, reached through DATABASE_URL.
// Without that setting, development and tests use an in-process Postgres
// (PGlite), so the same SQL runs everywhere. Production never falls back.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { migrate } from "./migrations.ts";

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(text: string, values?: unknown[]): Promise<T[]>;
  /** Runs several statements at once. For schema changes only: it takes no values. */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Everything inside either happens completely or not at all. */
  transaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function fromPool(pool: pg.Pool): Db {
  const wrap = (client: pg.Pool | pg.PoolClient): Queryable => ({
    query: async <T>(text: string, values: unknown[] = []) => (await client.query(text, values)).rows as T[],
    exec: async (sql) => void (await client.query(sql)),
  });
  return {
    ...wrap(pool),
    async transaction(run) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await run(wrap(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** An in-process Postgres: kept in memory, or in `dataDir` when one is given. */
export async function openLocal(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const lite = new PGlite(dataDir);
  type Target = Pick<typeof lite, "query" | "exec">;
  const wrap = (target: Target): Queryable => ({
    query: async <T>(text: string, values: unknown[] = []) => (await target.query(text, values)).rows as T[],
    exec: async (sql) => void (await target.exec(sql)),
  });
  return {
    ...wrap(lite),
    transaction: <T>(run: (tx: Queryable) => Promise<T>) => lite.transaction((tx) => run(wrap(tx))) as Promise<T>,
    close: () => lite.close(),
  };
}

async function open(): Promise<Db> {
  // A secret stored with a trailing line break must still connect.
  const url = process.env.DATABASE_URL?.trim();
  let db: Db;
  if (url) {
    // Neon's pooled address already multiplexes connections, so a few are enough.
    const pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
    // Neon closes idle connections; without a listener that would crash the process.
    pool.on("error", (error) => console.error("An idle database connection failed:", error.message));
    db = fromPool(pool);
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is not set.");
  } else {
    console.warn("DATABASE_URL is not set: using a local development database in .data/");
    db = await openLocal(path.join(process.cwd(), ".data", "time-db"));
  }
  await migrate(db);
  return db;
}

declare global {
  var __timeDb: Promise<Db> | undefined;
}

/** The app's one database handle, with the schema brought up to date on first use. */
export function getDb(): Promise<Db> {
  globalThis.__timeDb ??= open().catch((error) => {
    // Let the next request try again instead of remembering the failure.
    globalThis.__timeDb = undefined;
    throw error;
  });
  return globalThis.__timeDb;
}
