import { env } from "../config/env.js";
import { openDatabase } from "./client.js";
import { resetDatabase, seedIfEmpty } from "./seed.js";

/** `npm run db:seed` seeds an empty database; add `-- --reset` to wipe and reseed. */
const { db, close } = await openDatabase(
  env.DATABASE_URL ? { kind: "postgres", url: env.DATABASE_URL } : { kind: "pglite", dataDir: env.PGLITE_DATA_DIR },
);
if (process.argv.includes("--reset")) {
  await resetDatabase(db);
  console.log("Database wiped.");
}
console.log((await seedIfEmpty(db)) ? "Seeded demo data." : "Database already has data; nothing to do.");
await close();
