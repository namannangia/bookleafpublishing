import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle as drizzleNodePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import * as schema from "./schema.js";

/**
 * Both drivers expose the same Drizzle query API, so the rest of the app only
 * sees this one type.
 */
export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export type DbTarget =
  | { kind: "postgres"; url: string; poolMax?: number }
  /** dataDir undefined = in-memory (tests). */
  | { kind: "pglite"; dataDir?: string };

/** Opens a connection and applies pending migrations. */
export async function openDatabase(target: DbTarget): Promise<DbHandle> {
  if (target.kind === "postgres") {
    const pool = new pg.Pool({
      connectionString: target.url,
      // Managed Postgres providers (Render, Neon) require TLS.
      ssl: /localhost|127\.0\.0\.1/.test(target.url) ? undefined : { rejectUnauthorized: false },
      max: target.poolMax ?? 10,
    });
    const db = drizzleNodePg(pool, { schema });
    await migrateNodePg(db, { migrationsFolder });
    return { db, close: () => pool.end() };
  }

  // PGlite doesn't create parent directories itself.
  if (target.dataDir) fs.mkdirSync(target.dataDir, { recursive: true });
  const client = new PGlite(target.dataDir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder });
  return { db: db as unknown as Db, close: () => client.close() };
}
