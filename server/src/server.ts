import path from "node:path";
import { fileURLToPath } from "node:url";
import { setupAi } from "./ai/provider.js";
import { buildServices, createApp, type AppConfig } from "./app.js";
import { env } from "./config/env.js";
import { openDatabase } from "./db/client.js";
import { seedIfEmpty } from "./db/seed.js";
import { logger } from "./lib/logger.js";

async function main() {
  const { db, close } = await openDatabase(
    env.DATABASE_URL ? { kind: "postgres", url: env.DATABASE_URL, poolMax: env.PG_POOL_MAX } : { kind: "pglite", dataDir: env.PGLITE_DATA_DIR },
  );
  logger.info("db.ready", { driver: env.DATABASE_URL ? "postgres" : "pglite" });

  if (env.SEED_ON_BOOT && (await seedIfEmpty(db))) logger.info("db.seeded");

  const ai = setupAi(env);
  if (ai.client) logger.info("ai.enabled", { provider: ai.provider, classifyModel: ai.classifyModel, draftModel: ai.draftModel });
  else logger.warn("ai.disabled", { reason: "No AI provider key set; using rule-based triage and manual replies" });

  const config: AppConfig = {
    jwtSecret: env.JWT_SECRET,
    jwtTtlHours: env.JWT_TTL_HOURS,
    secureCookies: env.NODE_ENV === "production",
    classifyModel: ai.classifyModel,
    draftModel: ai.draftModel,
    classifyEffort: env.AI_CLASSIFY_EFFORT,
    draftEffort: env.AI_DRAFT_EFFORT,
    maxUploadBytes: env.MAX_UPLOAD_BYTES,
    staticDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist"),
  };
  const services = buildServices(db, ai.client, config);
  const app = createApp(db, services, config);

  const server = app.listen(env.PORT, () => logger.info("http.listening", { port: env.PORT }));
  // Keep idle sockets open longer than the hosting proxy does. With Node's 5 s default the
  // proxy reuses connections we've already closed and those requests are never answered.
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 121_000;

  // Classify anything left untriaged (fresh seed, or a crash mid-triage).
  services.triage
    .triagePending()
    .then((n) => n && logger.info("triage.backfilled", { count: n }))
    .catch((err) => logger.error("triage.backfill_failed", { error: String(err) }));

  const shutdown = async (signal: string) => {
    logger.info("shutdown", { signal });
    services.hub.close();
    server.close();
    await close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("boot.failed", { error: String(err), stack: err?.stack });
  process.exit(1);
});
