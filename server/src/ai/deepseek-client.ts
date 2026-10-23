import OpenAI from "openai";
import { z } from "zod";
import { LlmError, type Effort, type LlmClient, type LlmUsage, type StructuredRequest, type StructuredResult } from "./llm.js";

/**
 * DeepSeek implementation of LlmClient, via DeepSeek's OpenAI-compatible API.
 *
 * - JSON: DeepSeek supports `response_format: json_object` but not schema
 *   enforcement, so the Zod schema is rendered into the prompt as JSON Schema
 *   and every response is validated here. An empty or invalid response (a known
 *   DeepSeek JSON-mode quirk) gets one retry before failing as INVALID_OUTPUT.
 * - Thinking: effort "none" disables thinking (fast and cheap, used for triage);
 *   other levels map to DeepSeek's `reasoning_effort` (low | high).
 * - Caching: DeepSeek caches repeated prompt prefixes automatically, so the
 *   stable-first prompt ordering is what earns cache hits; cache_control markers aren't needed.
 * - The SDK retries 408/409/429/5xx and connection errors with backoff.
 */
export class DeepSeekLlmClient implements LlmClient {
  private readonly client: OpenAI;
  private static readonly MAX_ATTEMPTS = 2;

  constructor(opts: { apiKey: string; timeoutMs: number; maxRetries: number; baseURL?: string }) {
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL ?? "https://api.deepseek.com",
      timeout: opts.timeoutMs,
      maxRetries: opts.maxRetries,
    });
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const system = `${req.system.map((b) => b.text).join("\n\n")}

# Output format
Respond with only a JSON object (no prose, no code fences) that matches this JSON Schema:
${JSON.stringify(z.toJSONSchema(req.schema))}`;

    const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let lastProblem = "";

    for (let attempt = 1; attempt <= DeepSeekLlmClient.MAX_ATTEMPTS; attempt++) {
      let completion: OpenAI.Chat.Completions.ChatCompletion;
      try {
        completion = await this.client.chat.completions.create({
          model: req.model,
          max_tokens: req.maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: req.user },
          ],
          response_format: { type: "json_object" },
          ...thinkingParams(req.effort),
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
      } catch (err) {
        throw toLlmError(err, usage);
      }

      addUsage(usage, completion.usage);
      const choice = completion.choices[0];
      if (choice?.finish_reason === "length") {
        throw new LlmError("INVALID_OUTPUT", "The AI response was cut off (max_tokens reached).", usage);
      }
      if (choice?.finish_reason === "content_filter") {
        throw new LlmError("REFUSED", "The AI provider filtered this response.", usage);
      }

      const parsed = parseJson(choice?.message.content);
      const result = parsed === undefined ? null : req.schema.safeParse(parsed);
      // Report the alias we requested (e.g. deepseek-flash) so cost lookups stay stable across snapshots.
      if (result?.success) return { data: result.data, model: req.model, usage };
      lastProblem = parsed === undefined ? "empty or non-JSON content" : "JSON did not match the schema";
    }
    throw new LlmError("INVALID_OUTPUT", `The AI response was unusable (${lastProblem}).`, usage);
  }
}

/** DeepSeek extension params: `thinking` toggle and `reasoning_effort` (low | high | max). */
function thinkingParams(effort: Effort): Record<string, unknown> {
  if (effort === "none") return { thinking: { type: "disabled" } };
  return { thinking: { type: "enabled" }, reasoning_effort: effort === "low" ? "low" : "high" };
}

function parseJson(content: string | null | undefined): unknown {
  if (!content?.trim()) return undefined;
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/** DeepSeek reports cache hits/misses separately; misses are billed at the full input rate. */
interface DeepSeekUsage extends OpenAI.CompletionUsage {
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}

function addUsage(total: LlmUsage, u: DeepSeekUsage | undefined) {
  if (!u) return;
  const hit = u.prompt_cache_hit_tokens ?? 0;
  total.cacheReadTokens += hit;
  total.inputTokens += u.prompt_cache_miss_tokens ?? u.prompt_tokens - hit;
  total.outputTokens += u.completion_tokens; // includes reasoning tokens
}

/** Most specific first: subclasses must be checked before their parents. */
function toLlmError(err: unknown, usage: LlmUsage): LlmError {
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new LlmError("TIMEOUT", "The AI provider timed out.", usage);
  if (err instanceof OpenAI.APIConnectionError) return new LlmError("UNAVAILABLE", "Could not reach the AI provider.", usage);
  if (err instanceof OpenAI.RateLimitError) return new LlmError("RATE_LIMITED", "The AI provider is rate limiting requests.", usage);
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) {
    return new LlmError("AUTH", "The AI provider rejected the API key.", usage);
  }
  if (err instanceof OpenAI.BadRequestError || err instanceof OpenAI.UnprocessableEntityError) {
    return new LlmError("BAD_REQUEST", `The AI provider rejected the request: ${err.message}`, usage);
  }
  if (err instanceof OpenAI.APIError) {
    // DeepSeek returns 402 when the account balance runs out.
    if (err.status === 402) return new LlmError("QUOTA", "The AI account has insufficient balance.", usage);
    return new LlmError("UNAVAILABLE", `AI provider error (${err.status ?? "unknown"}).`, usage);
  }
  return new LlmError("UNAVAILABLE", err instanceof Error ? err.message : "Unknown AI error.", usage);
}
