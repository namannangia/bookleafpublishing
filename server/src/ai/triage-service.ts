import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { books, ticketEvents, tickets } from "../db/schema.js";
import { logger } from "../lib/logger.js";
import type { RealtimeHub } from "../modules/realtime/hub.js";
import type { AiGateway } from "./ai-gateway.js";
import { LlmError } from "./llm.js";
import { CLASSIFY_SYSTEM, ClassificationSchema, buildClassifyUserMessage } from "./prompts/classify.js";
import { classifyByRules } from "./rules-classifier.js";

/**
 * Assigns category and priority to new tickets.
 *
 * Runs asynchronously after the ticket is saved, so an author never waits on
 * (or is blocked by) the AI. If the AI fails, keyword rules take over so the
 * queue is still ordered sensibly. Values an admin has already overridden are
 * never overwritten.
 */
export class TriageService {
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly ai: AiGateway,
    private readonly hub: RealtimeHub,
    private readonly model: string,
  ) {}

  /** Fire-and-forget entry point used right after a ticket is created. */
  enqueue(ticketId: string): void {
    setImmediate(() => {
      this.triage(ticketId).catch((err) => logger.error("triage.unhandled", { ticketId, error: String(err) }));
    });
  }

  /** Triage a ticket; concurrent calls for the same ticket share one run. */
  triage(ticketId: string, opts: { force?: boolean } = {}): Promise<void> {
    const existing = this.inFlight.get(ticketId);
    if (existing) return existing;
    const run = this.run(ticketId, opts.force ?? false).finally(() => this.inFlight.delete(ticketId));
    this.inFlight.set(ticketId, run);
    return run;
  }

  /** Recovers tickets left untriaged by a crash or restart. Called on boot. */
  async triagePending(): Promise<number> {
    const pending = await this.db.select({ id: tickets.id }).from(tickets).where(eq(tickets.triageState, "PENDING"));
    for (const { id } of pending) await this.triage(id);
    return pending.length;
  }

  private async run(ticketId: string, force: boolean): Promise<void> {
    const [row] = await this.db
      .select({ ticket: tickets, book: books })
      .from(tickets)
      .leftJoin(books, eq(books.id, tickets.bookId))
      .where(eq(tickets.id, ticketId));
    if (!row) return;
    const { ticket, book } = row;
    if (ticket.triageState === "DONE" && !force) return;

    const bookLine = book ? `"${book.title}" (status: ${book.status})` : "General / account level";
    let result: { category: typeof ticket.category; priority: typeof ticket.priority; rationale: string; confidence: number | null };
    let source: "AI" | "RULES";

    try {
      const { data } = await this.ai.run(ticketId, {
        purpose: "CLASSIFY",
        model: this.model,
        system: [{ text: CLASSIFY_SYSTEM }],
        user: buildClassifyUserMessage({ subject: ticket.subject, description: ticket.description, bookLine }),
        schema: ClassificationSchema,
        maxTokens: 1024,
        effort: "low",
      });
      result = { ...data, confidence: Math.min(1, Math.max(0, data.confidence)) };
      source = "AI";
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      result = { ...classifyByRules(`${ticket.subject}\n${ticket.description}`), confidence: null };
      source = "RULES";
    }

    // Respect admin overrides that happened while triage was running.
    const keepCategory = ticket.categorySource === "ADMIN";
    const keepPriority = ticket.prioritySource === "ADMIN";

    await this.db.transaction(async (tx) => {
      await tx
        .update(tickets)
        .set({
          ...(keepCategory ? {} : { category: result.category, categorySource: source }),
          ...(keepPriority ? {} : { priority: result.priority, prioritySource: source }),
          triageState: "DONE",
          aiConfidence: source === "AI" ? result.confidence : null,
          aiRationale: result.rationale,
          updatedAt: new Date(),
        })
        .where(eq(tickets.id, ticketId));
      await tx.insert(ticketEvents).values({
        ticketId,
        actorId: null,
        type: "triaged",
        data: { source, category: result.category, priority: result.priority, confidence: result.confidence },
      });
    });

    this.hub.publish({ type: "ticket.updated", ticketId, authorId: ticket.authorId, adminOnly: true });
  }
}
