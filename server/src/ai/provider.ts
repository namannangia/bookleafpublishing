import type { Env } from "../config/env.js";
import { AnthropicLlmClient } from "./anthropic-client.js";
import { DeepSeekLlmClient } from "./deepseek-client.js";
import type { LlmClient } from "./llm.js";

const DEFAULT_MODELS = {
  deepseek: { classify: "deepseek-flash", draft: "deepseek-flash" },
  anthropic: { classify: "claude-haiku-5-5", draft: "claude-haiku-5-5" },
} as const;

export interface AiSetup {
  provider: "deepseek" | "anthropic" | "none";
  client: LlmClient | null;
  classifyModel: string;
  draftModel: string;
}

/** Picks the LLM provider from the environment. Keys are only ever read here, server-side. */
export function setupAi(env: Env): AiSetup {
  const provider = env.AI_PROVIDER ?? (env.DEEPSEEK_API_KEY ? "deepseek" : env.ANTHROPIC_API_KEY ? "anthropic" : "none");
  const common = { timeoutMs: env.AI_TIMEOUT_MS, maxRetries: env.AI_MAX_RETRIES };

  let client: LlmClient | null = null;
  if (provider === "deepseek" && env.DEEPSEEK_API_KEY) client = new DeepSeekLlmClient({ apiKey: env.DEEPSEEK_API_KEY, ...common });
  if (provider === "anthropic" && env.ANTHROPIC_API_KEY) client = new AnthropicLlmClient({ apiKey: env.ANTHROPIC_API_KEY, ...common });

  const defaults = provider === "none" ? DEFAULT_MODELS.deepseek : DEFAULT_MODELS[provider];
  return {
    provider: client ? provider : "none",
    client,
    classifyModel: env.AI_CLASSIFY_MODEL ?? defaults.classify,
    draftModel: env.AI_DRAFT_MODEL ?? defaults.draft,
  };
}
