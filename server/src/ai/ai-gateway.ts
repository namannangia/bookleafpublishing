import type { Db } from "../db/client.js";
import { aiCalls } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import { LlmError, TRANSIENT_CODES, type LlmClient, type StructuredRequest, type StructuredResult } from "./llm.js";

/**
 * Single choke point for every LLM call. It adds three things the raw client
 * doesn't have:
 *
 * 1. Circuit breaker: after repeated transient failures (timeouts, 429s, 5xx) we
 *    stop calling the provider for a cool-down period. Callers then fall back
 *    immediately instead of every request waiting out timeouts and retries.
 * 2. Usage ledger: every call (success or failure) is written to `ai_calls` with
 *    token counts and latency, which powers the cost panel in the admin UI.
 * 3. "Not configured" handling: with no API key the app runs in manual mode.
 */
export class AiGateway {
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(
    private readonly db: Db,
    private readonly client: LlmClient | null,
    private readonly opts: { failureThreshold: number; cooldownMs: number } = { failureThreshold: 3, cooldownMs: 60_000 },
  ) {}

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Coarse health for the UI: is AI usable right now? */
  status(): "ok" | "degraded" | "disabled" {
    if (!this.client) return "disabled";
    return Date.now() < this.openUntil ? "degraded" : "ok";
  }

  async run<T>(ticketId: string | null, req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    if (!this.client) throw new LlmError("NOT_CONFIGURED", "AI is not configured (no API key).");
    if (Date.now() < this.openUntil) {
      await this.record(ticketId, req, "SKIPPED", "CIRCUIT_OPEN", 0);
      throw new LlmError("CIRCUIT_OPEN", "AI temporarily paused after repeated provider errors.");
    }

    const started = Date.now();
    try {
      const result = await this.client.generateStructured(req);
      this.consecutiveFailures = 0;
      await this.record(ticketId, req, "SUCCESS", null, Date.now() - started, result.usage, result.model);
      return result;
    } catch (err) {
      const llmErr = err instanceof LlmError ? err : new LlmError("UNAVAILABLE", String(err));
      if (TRANSIENT_CODES.has(llmErr.code)) {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= this.opts.failureThreshold) {
          this.openUntil = Date.now() + this.opts.cooldownMs;
          this.consecutiveFailures = 0;
          logger.warn("ai.circuit_open", { cooldownMs: this.opts.cooldownMs });
        }
      }
      logger.warn("ai.call_failed", { purpose: req.purpose, code: llmErr.code, message: llmErr.message });
      await this.record(ticketId, req, "ERROR", llmErr.code, Date.now() - started, llmErr.usage);
      throw llmErr;
    }
  }

  private async record(
    ticketId: string | null,
    req: StructuredRequest<unknown>,
    outcome: "SUCCESS" | "ERROR" | "SKIPPED",
    errorCode: string | null,
    latencyMs: number,
    usage?: StructuredResult<unknown>["usage"],
    model?: string,
  ) {
    try {
      await this.db.insert(aiCalls).values({
        ticketId,
        purpose: req.purpose,
        model: model ?? req.model,
        outcome,
        errorCode,
        latencyMs,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cacheReadTokens: usage?.cacheReadTokens ?? 0,
        cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
      });
    } catch (err) {
      // Telemetry must never break the main flow.
      logger.error("ai.ledger_write_failed", { error: String(err) });
    }
  }
}
