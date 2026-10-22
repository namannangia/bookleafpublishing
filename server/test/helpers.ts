import request from "supertest";
import { buildServices, createApp, type AppConfig } from "../src/app.js";
import { LlmError, type LlmClient, type StructuredRequest, type StructuredResult } from "../src/ai/llm.js";
import { openDatabase } from "../src/db/client.js";
import { DEMO_ADMIN_PASSWORD, DEMO_AUTHOR_PASSWORD, seedIfEmpty } from "../src/db/seed.js";

/** Scriptable LLM double. Records every request so tests can inspect prompts. */
export class FakeLlm implements LlmClient {
  requests: StructuredRequest<unknown>[] = [];
  handler: (req: StructuredRequest<unknown>) => unknown = (req) => {
    if (req.purpose === "CLASSIFY") {
      return { category: "ROYALTY_PAYMENTS", priority: "CRITICAL", confidence: 0.92, rationale: "No royalty for a year." };
    }
    return {
      reply: "Hi there,\n\nDraft reply.\n\nWarm regards,\nBookLeaf Author Support",
      agent_actions: ["Escalate to finance"],
      suggested_status: "IN_PROGRESS",
    };
  };

  failWith(code: ConstructorParameters<typeof LlmError>[0]) {
    this.handler = () => {
      throw new LlmError(code, `fake ${code}`);
    };
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.requests.push(req as StructuredRequest<unknown>);
    const data = this.handler(req as StructuredRequest<unknown>) as T;
    return { data, model: req.model, usage: { inputTokens: 500, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  }
}

export const FIXED_NOW = new Date("2026-10-22T10:00:00Z");

export async function setupTestApp(opts: { llm?: LlmClient | null } = {}) {
  const handle = await openDatabase({ kind: "pglite" });
  await seedIfEmpty(handle.db, { now: FIXED_NOW });
  const config: AppConfig = {
    jwtSecret: "test-secret-at-least-16-chars",
    jwtTtlHours: 1,
    secureCookies: false,
    classifyModel: "claude-haiku-5-5",
    draftModel: "claude-haiku-5-5",
    maxUploadBytes: 1024 * 1024,
    now: () => FIXED_NOW,
  };
  const llm = opts.llm === undefined ? new FakeLlm() : opts.llm;
  const services = buildServices(handle.db, llm, config);
  // Seeded tickets start untriaged; settle them so tests start from a stable state.
  await services.triage.triagePending();
  const app = createApp(handle.db, services, config);

  async function login(email: string) {
    const agent = request.agent(app);
    const password = email.endsWith("@bookleafpub.com") ? DEMO_ADMIN_PASSWORD : DEMO_AUTHOR_PASSWORD;
    const res = await agent.post("/api/auth/login").send({ email, password });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
    return agent;
  }

  return { app, db: handle.db, services, llm, login, close: handle.close };
}

export const ADMIN = "admin@bookleafpub.com";
export const PRIYA = "priya.sharma@email.com"; // AUTH001, BK001/BK002
export const ROHIT = "rohit.kapoor@email.com"; // AUTH002, BK003/BK004
export const KAVITA = "kavita.deshmukh@email.com"; // AUTH009, BK015 (in production) / BK016 (₹850 pending)
