import { z } from "zod";

/**
 * All runtime configuration comes from environment variables and is validated
 * once at boot. Secrets (JWT secret, Anthropic key) never leave the server.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  // When unset, an embedded Postgres (PGlite) is used so the project runs with zero setup.
  DATABASE_URL: z.string().url().optional(),
  PGLITE_DATA_DIR: z.string().default(".data/pglite"),

  JWT_SECRET: z.string().min(16).default("dev-only-secret-change-me-in-prod"),
  JWT_TTL_HOURS: z.coerce.number().int().positive().default(12),

  // AI. If ANTHROPIC_API_KEY is missing the app still works: tickets get rule-based
  // triage and admins write responses manually.
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_CLASSIFY_MODEL: z.string().default("claude-haiku-5-5"),
  AI_DRAFT_MODEL: z.string().default("claude-haiku-5-5"),
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
