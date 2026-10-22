import type { z } from "zod";

/**
 * Provider-agnostic LLM interface. The rest of the app depends on this, not on
 * a vendor SDK, so switching providers (or faking one in tests) is one file.
 */

export type AiPurpose = "CLASSIFY" | "DRAFT";

export interface SystemBlock {
  text: string;
  /** Mark the end of a stable prefix that the provider may cache. */
  cacheBreakpoint?: boolean;
}

export interface StructuredRequest<T> {
  purpose: AiPurpose;
  model: string;
  system: SystemBlock[];
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  effort: "low" | "medium" | "high";
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  usage: LlmUsage;
}

export interface LlmClient {
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

export type LlmErrorCode =
  | "NOT_CONFIGURED"
  | "CIRCUIT_OPEN"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "AUTH"
  | "BAD_REQUEST"
  | "REFUSED"
  | "INVALID_OUTPUT";

/** Errors the gateway treats as "the provider is unhealthy" (they trip the circuit breaker). */
export const TRANSIENT_CODES: ReadonlySet<LlmErrorCode> = new Set(["RATE_LIMITED", "TIMEOUT", "UNAVAILABLE"]);

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    public readonly usage?: LlmUsage,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
