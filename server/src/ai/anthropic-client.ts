import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { LlmError, type LlmClient, type LlmUsage, type StructuredRequest, type StructuredResult } from "./llm.js";

/**
 * Claude implementation of LlmClient.
 *
 * - Structured outputs (`output_config.format` + Zod) guarantee schema-valid JSON,
 *   so there's no brittle "please reply in JSON" parsing.
 * - The SDK retries 408/409/429/5xx and connection errors with exponential
 *   backoff (`maxRetries`); a short timeout keeps a slow provider from blocking a request.
 * - SDK errors are mapped to LlmError codes so callers never depend on vendor types.
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(opts: { apiKey: string; timeoutMs: number; maxRetries: number }) {
    this.client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs, maxRetries: opts.maxRetries });
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const system: Anthropic.TextBlockParam[] = req.system.map((block) => ({
      type: "text",
      text: block.text,
      ...(block.cacheBreakpoint ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));

    let response;
    try {
      response = await this.client.messages.parse({
        model: req.model,
        max_tokens: req.maxTokens,
        system,
        messages: [{ role: "user", content: req.user }],
        // Claude has no "off" level here; low effort is the closest equivalent.
        output_config: { effort: req.effort === "none" ? "low" : req.effort, format: zodOutputFormat(req.schema) },
      });
    } catch (err) {
      throw toLlmError(err);
    }

    const usage = toUsage(response.usage);
    if (response.stop_reason === "refusal") {
      throw new LlmError("REFUSED", "The model declined to answer this request.", usage);
    }
    if (response.stop_reason === "max_tokens" || response.parsed_output == null) {
      throw new LlmError("INVALID_OUTPUT", `No valid structured output (stop_reason=${response.stop_reason}).`, usage);
    }
    return { data: response.parsed_output as T, model: response.model, usage };
  }
}

function toUsage(u: Anthropic.Usage): LlmUsage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/** Most specific first: subclasses must be checked before their parents. */
function toLlmError(err: unknown): LlmError {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new LlmError("TIMEOUT", "The AI provider timed out.");
  if (err instanceof Anthropic.APIConnectionError) return new LlmError("UNAVAILABLE", "Could not reach the AI provider.");
  if (err instanceof Anthropic.RateLimitError) return new LlmError("RATE_LIMITED", "The AI provider is rate limiting requests.");
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new LlmError("AUTH", "The AI provider rejected the API key.");
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.UnprocessableEntityError) {
    return new LlmError("BAD_REQUEST", `The AI provider rejected the request: ${err.message}`);
  }
  if (err instanceof Anthropic.APIError) return new LlmError("UNAVAILABLE", `AI provider error (${err.status ?? "unknown"}).`);
  if (err instanceof Error && err.name === "ZodError") return new LlmError("INVALID_OUTPUT", "The AI response failed validation.");
  return new LlmError("UNAVAILABLE", err instanceof Error ? err.message : "Unknown AI error.");
}
