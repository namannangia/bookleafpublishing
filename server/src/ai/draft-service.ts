import { asc, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { aiDrafts, authors, books, ticketMessages, tickets, users, type AiDraft } from "../db/schema.js";
import { notFound, serviceUnavailable } from "../lib/errors.js";
import { buildAccountFacts } from "./account-facts.js";
import type { AiGateway } from "./ai-gateway.js";
import { LlmError, type Effort } from "./llm.js";
import { DraftSchema, buildDraftSystem, buildDraftUserMessage, type ThreadMessage } from "./prompts/draft.js";
import type { TriageService } from "./triage-service.js";

/**
 * Generates reply drafts for admins.
 *
 * Cost controls:
 * - Lazy: a draft is only generated when an admin opens the ticket, never for
 *   every incoming ticket.
 * - Cached: the draft is stored and reused until the conversation changes
 *   (tracked by public message count), so reopening a ticket costs nothing.
 * - De-duplicated: concurrent requests for the same ticket share one call.
 * - Scoped context: one knowledge-base section, the relevant book's facts and
 *   only the last few messages (see prompts/draft.ts).
 */
export class DraftService {
  private readonly inFlight = new Map<string, Promise<AiDraft>>();

  constructor(
    private readonly db: Db,
    private readonly ai: AiGateway,
    private readonly triage: TriageService,
    private readonly settings: { model: string; effort: Effort },
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Latest draft if it still matches the conversation, else null. Never calls the AI. */
  async getFreshDraft(ticketId: string): Promise<AiDraft | null> {
    const [latest] = await this.db
      .select()
      .from(aiDrafts)
      .where(eq(aiDrafts.ticketId, ticketId))
      .orderBy(desc(aiDrafts.createdAt))
      .limit(1);
    if (!latest) return null;
    const count = await this.publicMessageCount(ticketId);
    return latest.contextMessageCount === count ? latest : null;
  }

  async getOrGenerate(ticketId: string, opts: { regenerate?: boolean } = {}): Promise<AiDraft> {
    if (!opts.regenerate) {
      const fresh = await this.getFreshDraft(ticketId);
      if (fresh) return fresh;
    }
    const existing = this.inFlight.get(ticketId);
    if (existing) return existing;
    const run = this.generate(ticketId).finally(() => this.inFlight.delete(ticketId));
    this.inFlight.set(ticketId, run);
    return run;
  }

  private async generate(ticketId: string): Promise<AiDraft> {
    let ticket = await this.loadTicket(ticketId);
    // The draft prompt is category-scoped, so triage must have happened first.
    if (!ticket.category) {
      await this.triage.triage(ticketId);
      ticket = await this.loadTicket(ticketId);
    }
    const category = ticket.category ?? "GENERAL_INQUIRY";

    const [authorRow] = await this.db
      .select({ name: users.name })
      .from(authors)
      .innerJoin(users, eq(users.id, authors.userId))
      .where(eq(authors.id, ticket.authorId));
    const authorBooks = await this.db.select().from(books).where(eq(books.authorId, ticket.authorId));
    const selectedBook = authorBooks.find((b) => b.id === ticket.bookId) ?? null;

    const messages = await this.db
      .select({ body: ticketMessages.body, senderRole: ticketMessages.senderRole })
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, ticketId))
      .orderBy(asc(ticketMessages.createdAt));
    const thread: ThreadMessage[] = messages.map((m) => ({
      from: m.senderRole === "AUTHOR" ? "Author" : "BookLeaf",
      body: m.body,
    }));

    const accountFacts = buildAccountFacts({
      authorName: authorRow?.name ?? "Author",
      allBooks: authorBooks,
      selectedBook,
      category,
      today: this.now(),
    });

    try {
      const { data, model } = await this.ai.run(ticketId, {
        purpose: "DRAFT",
        model: this.settings.model,
        system: buildDraftSystem(category),
        user: buildDraftUserMessage({ accountFacts, subject: ticket.subject, description: ticket.description, thread }),
        schema: DraftSchema,
        maxTokens: 8192,
        effort: this.settings.effort,
      });
      const [draft] = await this.db
        .insert(aiDrafts)
        .values({
          ticketId,
          body: data.reply.trim(),
          agentActions: data.agent_actions,
          suggestedStatus: data.suggested_status,
          model,
          contextMessageCount: messages.length,
        })
        .returning();
      return draft!;
    } catch (err) {
      if (err instanceof LlmError) {
        throw serviceUnavailable(
          "AI_UNAVAILABLE",
          err.code === "NOT_CONFIGURED"
            ? "AI drafting is not configured. Please write the response manually."
            : "The AI draft couldn't be generated right now. Please write the response manually or try again shortly.",
        );
      }
      throw err;
    }
  }

  private async loadTicket(ticketId: string) {
    const [ticket] = await this.db.select().from(tickets).where(eq(tickets.id, ticketId));
    if (!ticket) throw notFound("Ticket");
    return ticket;
  }

  private publicMessageCount(ticketId: string): Promise<number> {
    return this.db.$count(ticketMessages, eq(ticketMessages.ticketId, ticketId));
  }
}
