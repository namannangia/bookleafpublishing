import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DeepSeekLlmClient } from "../src/ai/deepseek-client.js";
import { ClassificationSchema } from "../src/ai/prompts/classify.js";

/** Local stand-in for DeepSeek's chat completions endpoint: scripted responses, captured requests. */
let server: http.Server;
let baseURL = "";
let requests: Record<string, unknown>[] = [];
let responses: { status: number; body: unknown }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push(JSON.parse(raw));
      const next = responses.shift() ?? { status: 500, body: { error: { message: "no scripted response" } } };
      res.writeHead(next.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(next.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  requests = [];
  responses = [];
});

const completion = (content: string, finish = "stop") => ({
  status: 200,
  body: {
    id: "x",
    object: "chat.completion",
    created: 0,
    model: "deepseek-v4.1-flash-1017",
    choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content } }],
    usage: { prompt_tokens: 600, completion_tokens: 80, total_tokens: 680, prompt_cache_hit_tokens: 512, prompt_cache_miss_tokens: 88 },
  },
});

const VALID = JSON.stringify({ category: "ROYALTY_PAYMENTS", priority: "HIGH", confidence: 0.9, rationale: "Late payout." });

const client = () => new DeepSeekLlmClient({ apiKey: "test", timeoutMs: 5000, maxRetries: 0, baseURL });
const request = (effort: "none" | "low" | "high" = "none") => ({
  purpose: "CLASSIFY" as const,
  model: "deepseek-flash",
  system: [{ text: "Classify the ticket." }],
  user: "<ticket>…</ticket>",
  schema: ClassificationSchema,
  maxTokens: 512,
  effort,
});

describe("DeepSeekLlmClient", () => {
  it("requests JSON mode, embeds the schema in the prompt, and maps cache usage", async () => {
    responses.push(completion(VALID));
    const result = await client().generateStructured(request("none"));

    expect(result.data).toMatchObject({ category: "ROYALTY_PAYMENTS", priority: "HIGH" });
    expect(result.model).toBe("deepseek-flash");
    expect(result.usage).toEqual({ inputTokens: 88, cacheReadTokens: 512, outputTokens: 80, cacheWriteTokens: 0 });

    const body = requests[0]!;
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body).not.toHaveProperty("reasoning_effort");
    const system = (body.messages as { content: string }[])[0]!.content;
    expect(system).toContain("JSON Schema");
    expect(system).toContain("ROYALTY_PAYMENTS");
  });

  it("enables thinking with the mapped reasoning effort", async () => {
    responses.push(completion(VALID));
    await client().generateStructured(request("low"));
    expect(requests[0]).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "low" });
  });

  it("retries once on empty content, then succeeds", async () => {
    responses.push(completion(""), completion(VALID));
    const result = await client().generateStructured(request());
    expect(requests).toHaveLength(2);
    expect(result.usage.outputTokens).toBe(160); // both attempts are billed
  });

  it("fails with INVALID_OUTPUT when the JSON never matches the schema", async () => {
    const bad = JSON.stringify({ category: "SOMETHING_ELSE", priority: "HIGH" });
    responses.push(completion(bad), completion(bad));
    await expect(client().generateStructured(request())).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });

  it("treats a truncated response as INVALID_OUTPUT", async () => {
    responses.push(completion('{"category": "ROY', "length"));
    await expect(client().generateStructured(request())).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });

  it.each([
    [402, "QUOTA"],
    [401, "AUTH"],
    [429, "RATE_LIMITED"],
    [503, "UNAVAILABLE"],
  ])("maps HTTP %i to %s", async (status, code) => {
    responses.push({ status, body: { error: { message: "nope" } } });
    await expect(client().generateStructured(request())).rejects.toMatchObject({ code });
  });
});
