import { z } from "zod";

/**
 * All runtime configuration comes from environment variables and is validated
 * once at boot. Secrets (JWT secret, AI provider keys) never leave the server.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  // When unset, an embedded Postgres (PGlite) is used so the project runs with zero setup.
  DATABASE_URL: z.string().url().optional(),
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),
  PGLITE_DATA_DIR: z.string().default(".data/pglite"),

  JWT_SECRET: z.string().min(16).default("dev-only-secret-change-me-in-prod"),
  JWT_TTL_HOURS: z.coerce.number().int().positive().default(12),

  // AI. With no provider key the app still works: tickets get rule-based triage
  // and admins write responses manually.
  // AI_PROVIDER defaults to whichever key is present (DeepSeek first).
  AI_PROVIDER: z.enum(["deepseek", "anthropic", "none"]).optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  // Defaults depend on the provider (see ai/provider.ts).
  AI_CLASSIFY_MODEL: z.string().optional(),
  AI_DRAFT_MODEL: z.string().optional(),
  // "none" disables thinking. Triage is a simple classification, so it skips reasoning by default.
  AI_CLASSIFY_EFFORT: z.enum(["none", "low", "medium", "high"]).default("none"),
  AI_DRAFT_EFFORT: z.enum(["none", "low", "medium", "high"]).default("low"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

  // Seed demo data on boot when the database is empty.
  SEED_ON_BOOT: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:", z.treeifyError(parsed.error));
    process.exit(1);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production" && env.JWT_SECRET === "dev-only-secret-change-me-in-prod") {
    console.error("JWT_SECRET must be set in production.");
    process.exit(1);
  }
  return env;
}

export const env = loadEnv();
