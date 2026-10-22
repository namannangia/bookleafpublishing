import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, KAVITA, PRIYA, ROHIT, setupTestApp } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setupTestApp>>;

beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(async () => {
  await ctx.close();
});

async function createTicket(email: string, body: Record<string, unknown>) {
  const agent = await ctx.login(email);
  const res = await agent.post("/api/tickets").send(body);
  return { agent, res };
}

describe("authentication", () => {
  it("rejects wrong credentials with a clear 401", async () => {
    const res = await request(ctx.app).post("/api/auth/login").send({ email: PRIYA, password: "nope" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "UNAUTHORIZED", message: "Incorrect email or password." });
  });

  it("validates the login payload", async () => {
    const res = await request(ctx.app).post("/api/auth/login").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields).toHaveProperty("email");
    expect(res.body.error.details.fields).toHaveProperty("password");
  });

  it("protects every API route", async () => {
    for (const path of ["/api/books", "/api/tickets", "/api/admin/stats", "/api/events"]) {
      const res = await request(ctx.app).get(path);
      expect(res.status, path).toBe(401);
    }
  });

  it("sets an httpOnly session cookie", async () => {
    const res = await request(ctx.app).post("/api/auth/login").send({ email: PRIYA, password: "Author@123" });
    expect(res.headers["set-cookie"]?.[0]).toMatch(/bl_session=.*HttpOnly/);
  });
});

describe("books", () => {
  it("returns only the author's own books with royalty totals", async () => {
    const agent = await ctx.login(PRIYA);
    const res = await agent.get("/api/books");
    expect(res.status).toBe(200);
    expect(res.body.items.map((b: { id: string }) => b.id).sort()).toEqual(["BK001", "BK002"]);
    expect(res.body.summary).toMatchObject({ royaltyPending: 3570, nextPayoutBy: "2026-11-14", belowThreshold: false });
  });

  it("handles books in production and balances under the payout threshold", async () => {
    const agent = await ctx.login(KAVITA);
    const res = await agent.get("/api/books");
    const inProduction = res.body.items.find((b: { id: string }) => b.id === "BK015");
    expect(inProduction).toMatchObject({ status: "In Production - Typesetting", mrp: null, publicationDate: null });
    expect(res.body.summary).toMatchObject({ royaltyPending: 850, belowThreshold: true });
  });
});

describe("tickets: role-based access", () => {
  it("lets an author create a ticket, which is triaged asynchronously", async () => {
    const { agent, res } = await createTicket(PRIYA, {
      bookId: "BK001",
      subject: "Missing royalty payment",
      description: "I have not received my royalty for over six months, please help.",
    });
    expect(res.status).toBe(201);
    expect(res.body.reference).toMatch(/^BL-\d+$/);

    await ctx.services.triage.triage(res.body.id);
    const detail = await agent.get(`/api/tickets/${res.body.id}`);
    expect(detail.status).toBe(200);
    // Authors never see internal triage data.
    expect(detail.body).not.toHaveProperty("priority");
    expect(detail.body).not.toHaveProperty("notes");
  });

  it("rejects a book that belongs to another author", async () => {
    const { res } = await createTicket(PRIYA, {
      bookId: "BK003",
      subject: "Question about this book",
      description: "This is somebody else's book and should be rejected.",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.bookId).toBeDefined();
  });

  it("returns field-level validation errors", async () => {
    const { res } = await createTicket(PRIYA, { subject: "Hi", description: "short" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details.fields).sort()).toEqual(["description", "subject"]);
  });

  it("hides other authors' tickets behind a 404", async () => {
    const { res } = await createTicket(PRIYA, {
      subject: "Account level question",
      description: "A general question about my BookLeaf account settings.",
    });
    const rohit = await ctx.login(ROHIT);
    expect((await rohit.get(`/api/tickets/${res.body.id}`)).status).toBe(404);
    expect((await rohit.post(`/api/tickets/${res.body.id}/messages`).send({ body: "hi" })).status).toBe(404);
    const list = await rohit.get("/api/tickets");
    expect(list.body.items.some((t: { id: string }) => t.id === res.body.id)).toBe(false);
  });

  it("blocks authors from admin-only actions", async () => {
    const { agent, res } = await createTicket(PRIYA, {
      subject: "Account level question",
      description: "A general question about my BookLeaf account settings.",
    });
    expect((await agent.patch(`/api/tickets/${res.body.id}`).send({ status: "CLOSED" })).status).toBe(403);
    expect((await agent.post(`/api/tickets/${res.body.id}/notes`).send({ body: "x" })).status).toBe(403);
    expect((await agent.post(`/api/tickets/${res.body.id}/draft`).send({})).status).toBe(403);
    expect((await agent.get("/api/admin/stats")).status).toBe(403);
  });

  it("blocks admins from creating tickets as an author", async () => {
    const admin = await ctx.login(ADMIN);
    const res = await admin.post("/api/tickets").send({ subject: "Hello there", description: "An admin should not create author tickets." });
    expect(res.status).toBe(403);
  });

  it("treats malformed ids as not found", async () => {
    const admin = await ctx.login(ADMIN);
    expect((await admin.get("/api/tickets/not-a-uuid")).status).toBe(404);
  });
});

describe("tickets: admin workflow", () => {
  it("runs the full lifecycle: reply, internal note, status, overrides, author reply reopens", async () => {
    const { agent: author, res } = await createTicket(PRIYA, {
      bookId: "BK002",
      subject: "Can I update my author bio?",
      description: "I would like to update the author bio on my book listing pages.",
    });
    const id = res.body.id;
    await ctx.services.triage.triage(id);
    const admin = await ctx.login(ADMIN);

    // Internal note: visible to admins, never to the author.
    expect((await admin.post(`/api/tickets/${id}/notes`).send({ body: "Check old bio first" })).status).toBe(201);

    // Override AI triage.
    const patched = await admin.patch(`/api/tickets/${id}`).send({ category: "GENERAL_INQUIRY", priority: "LOW" });
    expect(patched.body).toMatchObject({ category: "GENERAL_INQUIRY", categorySource: "ADMIN", priority: "LOW", prioritySource: "ADMIN" });

    // Reply: first reply moves OPEN -> IN_PROGRESS and assigns the replier.
    expect((await admin.post(`/api/tickets/${id}/messages`).send({ body: "Yes, you can!" })).status).toBe(201);
    let detail = await admin.get(`/api/tickets/${id}`);
    expect(detail.body).toMatchObject({ status: "IN_PROGRESS", assignee: { name: "Aisha Khan" } });
    expect(detail.body.firstResponseAt).not.toBeNull();
    expect(detail.body.notes).toHaveLength(1);

    const authorView = await author.get(`/api/tickets/${id}`);
    expect(authorView.body.messages.at(-1)).toMatchObject({ from: "ADMIN", senderName: "BookLeaf Author Support" });
    expect(JSON.stringify(authorView.body)).not.toContain("Check old bio first");

    // Resolve, then the author replies, which reopens it.
    await admin.patch(`/api/tickets/${id}`).send({ status: "RESOLVED" });
    await author.post(`/api/tickets/${id}/messages`).send({ body: "One more question" });
    detail = await admin.get(`/api/tickets/${id}`);
    expect(detail.body.status).toBe("OPEN");

    // Closed tickets don't accept author replies.
    await admin.patch(`/api/tickets/${id}`).send({ status: "CLOSED" });
    const closedReply = await author.post(`/api/tickets/${id}/messages`).send({ body: "Hello?" });
    expect(closedReply.status).toBe(409);
  });

  it("only assigns tickets to team members", async () => {
    const { res } = await createTicket(PRIYA, { subject: "Assign test ticket", description: "Testing assignment rules for tickets." });
    const admin = await ctx.login(ADMIN);
    const authorUserId = (await (await ctx.login(PRIYA)).get("/api/auth/me")).body.user.id;
    const bad = await admin.patch(`/api/tickets/${res.body.id}`).send({ assigneeId: authorUserId });
    expect(bad.status).toBe(400);
  });

  it("filters and orders the queue by urgency", async () => {
    const admin = await ctx.login(ADMIN);
    const res = await admin.get("/api/tickets?status=OPEN,IN_PROGRESS&pageSize=100");
    expect(res.status).toBe(200);
    const ranks = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
    const order = res.body.items.map((t: { priority: keyof typeof ranks }) => ranks[t.priority]);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    const byCategory = await admin.get("/api/tickets?category=ISBN_METADATA,PRINTING_QUALITY");
    for (const t of byCategory.body.items) expect(["ISBN_METADATA", "PRINTING_QUALITY"]).toContain(t.category);

    const invalid = await admin.get("/api/tickets?priority=URGENT");
    expect(invalid.status).toBe(400);
  });

  it("finds tickets by reference number", async () => {
    const admin = await ctx.login(ADMIN);
    const res = await admin.get("/api/tickets?q=BL-1");
    expect(res.body.items.map((t: { reference: string }) => t.reference)).toContain("BL-1");
  });
});

describe("attachments", () => {
  it("stores an uploaded file and serves it only to the owner and admins", async () => {
    const author = await ctx.login(PRIYA);
    const res = await author
      .post("/api/tickets")
      .field("subject", "Photo of misprinted page")
      .field("description", "Attaching a photo of the misprinted page in my copy.")
      .field("bookId", "BK001")
      .attach("attachment", Buffer.from("fake-png-bytes"), { filename: "page.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    const detail = await author.get(`/api/tickets/${res.body.id}`);
    const [file] = detail.body.attachments;
    expect(file).toMatchObject({ filename: "page.png", mimeType: "image/png" });

    const download = await author.get(`/api/tickets/${res.body.id}/attachments/${file.id}`);
    expect(download.status).toBe(200);
    const rohit = await ctx.login(ROHIT);
    expect((await rohit.get(`/api/tickets/${res.body.id}/attachments/${file.id}`)).status).toBe(404);
  });

  it("rejects disallowed file types", async () => {
    const author = await ctx.login(PRIYA);
    const res = await author
      .post("/api/tickets")
      .field("subject", "Script attachment")
      .field("description", "This attachment type should not be accepted.")
      .attach("attachment", Buffer.from("echo hi"), { filename: "x.sh", contentType: "application/x-sh" });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.attachment).toBeDefined();
  });
});
