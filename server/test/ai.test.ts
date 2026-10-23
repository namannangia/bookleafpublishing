import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { AiGateway } from "../src/ai/ai-gateway.js";
import { LlmError } from "../src/ai/llm.js";
import { tickets } from "../src/db/schema.js";
import { ADMIN, FakeLlm, PRIYA, setupTestApp } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setupTestApp>> | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

async function newTicket(c: NonNullable<typeof ctx>, overrides: Record<string, unknown> = {}) {
  const author = await c.login(PRIYA);
  const res = await author.post("/api/tickets").send({
    bookId: "BK001",
    subject: "No royalty for months",
    description: "I haven't received any royalty for 6 months. What is going on?",
    ...overrides,
  });
  await c.services.triage.triage(res.body.id);
  return { author, id: res.body.id as string };
}

describe("AI triage", () => {
  it("stores the AI's category, priority and confidence", async () => {
    ctx = await setupTestApp();
    const { id } = await newTicket(ctx);
    const admin = await ctx.login(ADMIN);
    const res = await admin.get(`/api/tickets/${id}`);
    expect(res.body).toMatchObject({
      category: "ROYALTY_PAYMENTS",
      categorySource: "AI",
      priority: "CRITICAL",
      prioritySource: "AI",
      triageState: "DONE",
      aiConfidence: 0.92,
    });
  });

  it("classification prompt is small: no knowledge base, ticket wrapped as data", async () => {
    const llm = new FakeLlm();
    ctx = await setupTestApp({ llm });
    await newTicket(ctx);
    const req = llm.requests.filter((r) => r.purpose === "CLASSIFY").at(-1)!;
    expect(req.user).toContain("<ticket>");
    expect(req.system.map((s) => s.text).join()).not.toContain("80/20 royalty split");
    expect(req.effort).toBe("none");
  });

  it("still creates and triages the ticket by rules when the AI is down", async () => {
    const llm = new FakeLlm();
    llm.failWith("UNAVAILABLE");
    ctx = await setupTestApp({ llm });
    const { id } = await newTicket(ctx);
    const [row] = await ctx.db.select().from(tickets).where(eq(tickets.id, id));
    expect(row).toMatchObject({ categorySource: "RULES", prioritySource: "RULES", category: "ROYALTY_PAYMENTS", priority: "CRITICAL" });
  });

  it("works with no AI configured at all", async () => {
    ctx = await setupTestApp({ llm: null });
    const { id } = await newTicket(ctx);
    const [row] = await ctx.db.select().from(tickets).where(eq(tickets.id, id));
    expect(row?.triageState).toBe("DONE");
    expect(row?.categorySource).toBe("RULES");
  });

  it("never overwrites an admin override when triage re-runs", async () => {
    ctx = await setupTestApp();
    const { id } = await newTicket(ctx);
    const admin = await ctx.login(ADMIN);
    await admin.patch(`/api/tickets/${id}`).send({ priority: "LOW" });
    const res = await admin.post(`/api/tickets/${id}/triage`);
    expect(res.body).toMatchObject({ priority: "LOW", prioritySource: "ADMIN", categorySource: "AI" });
  });
});

describe("AI drafts", () => {
  it("builds a scoped prompt: one KB section, real account facts, no internal notes", async () => {
    const llm = new FakeLlm();
    ctx = await setupTestApp({ llm });
    const { id } = await newTicket(ctx);
    const admin = await ctx.login(ADMIN);
    await admin.post(`/api/tickets/${id}/notes`).send({ body: "SECRET internal note" });

    const res = await admin.post(`/api/tickets/${id}/draft`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ agentActions: ["Escalate to finance"], suggestedStatus: "IN_PROGRESS" });

    const req = llm.requests.find((r) => r.purpose === "DRAFT")!;
    const system = req.system.map((s) => s.text).join("\n");
    expect(system).toContain("80/20 royalty split");
    expect(system).not.toContain("Repro India or Epitome Books. \n- Standard print turnaround"); // other sections excluded
    expect(system).not.toContain("stock sync issue");
    expect(req.system.at(-1)?.cacheBreakpoint).toBe(true);
    expect(req.user).toContain("Whispers of the Ganges");
    expect(req.user).toContain("pending ₹3,570");
    expect(req.user).toContain("14 November 2026"); // next payout date computed in code
    expect(req.user).toContain("may be overdue");
    expect(req.user).not.toContain("SECRET");
  });

  it("caches the draft until the conversation changes", async () => {
    const llm = new FakeLlm();
    ctx = await setupTestApp({ llm });
    const { id, author } = await newTicket(ctx);
    const admin = await ctx.login(ADMIN);
    const draftCalls = () => llm.requests.filter((r) => r.purpose === "DRAFT").length;

    const first = await admin.post(`/api/tickets/${id}/draft`).send({});
    await admin.post(`/api/tickets/${id}/draft`).send({});
    expect(draftCalls()).toBe(1);
    expect((await admin.get(`/api/tickets/${id}`)).body.draft.id).toBe(first.body.id);

    await author.post(`/api/tickets/${id}/messages`).send({ body: "Any update?" });
    expect((await admin.get(`/api/tickets/${id}`)).body.draft).toBeNull();
    await admin.post(`/api/tickets/${id}/draft`).send({});
    expect(draftCalls()).toBe(2);

    await admin.post(`/api/tickets/${id}/draft`).send({ regenerate: true });
    expect(draftCalls()).toBe(3);
  });

  it("returns 503 AI_UNAVAILABLE when drafting fails, and manual replies still work", async () => {
    const llm = new FakeLlm();
    ctx = await setupTestApp({ llm });
    const { id } = await newTicket(ctx);
    llm.failWith("RATE_LIMITED");
    const admin = await ctx.login(ADMIN);
    const res = await admin.post(`/api/tickets/${id}/draft`).send({});
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("AI_UNAVAILABLE");
    expect((await admin.post(`/api/tickets/${id}/messages`).send({ body: "Manual reply" })).status).toBe(201);
  });

  it("records whether a sent reply edited the AI draft", async () => {
    ctx = await setupTestApp();
    const { id } = await newTicket(ctx);
    const admin = await ctx.login(ADMIN);
    const draft = await admin.post(`/api/tickets/${id}/draft`).send({});
    await admin.post(`/api/tickets/${id}/messages`).send({ body: `${draft.body.body} PS: extra`, draftId: draft.body.id });
    const detail = await admin.get(`/api/tickets/${id}`);
    expect(detail.body.messages.at(-1)).toMatchObject({ aiAssisted: true, aiDraftEdited: true });

    const stats = await admin.get("/api/admin/stats");
    expect(stats.body.quality.draftsSent).toBe(1);
    expect(stats.body.ai.calls).toBeGreaterThan(0);
  });
});

describe("circuit breaker", () => {
  it("stops calling a failing provider after repeated transient errors", async () => {
    ctx = await setupTestApp({ llm: null });
    const llm = new FakeLlm();
    llm.failWith("TIMEOUT");
    const gateway = new AiGateway(ctx.db, llm, { failureThreshold: 2, cooldownMs: 60_000 });
    const req = { purpose: "CLASSIFY" as const, model: "m", system: [], user: "x", schema: {} as never, maxTokens: 10, effort: "low" as const };

    await expect(gateway.run(null, req)).rejects.toMatchObject({ code: "TIMEOUT" });
    await expect(gateway.run(null, req)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(gateway.status()).toBe("degraded");
    await expect(gateway.run(null, req)).rejects.toBeInstanceOf(LlmError);
    expect(llm.requests).toHaveLength(2); // third call short-circuited
  });
});
