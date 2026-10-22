import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DraftService } from "../../ai/draft-service.js";
import type { TriageService } from "../../ai/triage-service.js";
import type { Db } from "../../db/client.js";
import {
  aiDrafts,
  attachments,
  authors,
  books,
  internalNotes,
  ticketEvents,
  ticketMessages,
  tickets,
  users,
  type Ticket,
} from "../../db/schema.js";
import { UNRESOLVED_STATUSES, type TicketStatus } from "../../domain.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import type { SessionUser } from "../auth/session.js";
import type { RealtimeHub } from "../realtime/hub.js";
import { slaFor, ticketRef } from "./ticket-presenter.js";
import type { ListTicketsQuery } from "./ticket-schemas.js";

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const assignee = alias(users, "assignee");
const authorUser = alias(users, "author_user");

const lastMessageRole = sql<"AUTHOR" | "ADMIN" | null>`(
  select m.sender_role from ticket_messages m where m.ticket_id = ${tickets.id} order by m.created_at desc limit 1
)`;
const messageCount = sql<number>`(select count(*)::int from ticket_messages m where m.ticket_id = ${tickets.id})`;

/**
 * Queue order: unresolved first, then most urgent, then tickets waiting on us
 * (vs. waiting on the author), then oldest. Untriaged tickets rank as HIGH so
 * they're never buried.
 */
const URGENCY_ORDER = [
  sql`case when ${tickets.status} in ('OPEN', 'IN_PROGRESS') then 0 else 1 end`,
  sql`case ${tickets.priority} when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 when 'LOW' then 3 else 1 end`,
  sql`case when ${lastMessageRole} = 'ADMIN' then 1 else 0 end`,
  asc(tickets.createdAt),
];

export class TicketService {
  constructor(
    private readonly db: Db,
    private readonly hub: RealtimeHub,
    private readonly triage: TriageService,
    private readonly drafts: DraftService,
    private readonly aiStatus: () => "ok" | "degraded" | "disabled",
  ) {}

  // ---------------------------------------------------------------- queries

  async listForAuthor(authorId: string) {
    const rows = await this.db
      .select({
        ticket: tickets,
        bookTitle: books.title,
        lastMessageRole,
        messageCount,
      })
      .from(tickets)
      .leftJoin(books, eq(books.id, tickets.bookId))
      .where(eq(tickets.authorId, authorId))
      .orderBy(desc(tickets.updatedAt));

    return rows.map(({ ticket, bookTitle, lastMessageRole, messageCount }) => ({
      id: ticket.id,
      reference: ticketRef(ticket.number),
      subject: ticket.subject,
      status: ticket.status,
      book: ticket.bookId ? { id: ticket.bookId, title: bookTitle } : null,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      messageCount,
      hasNewReply: lastMessageRole === "ADMIN",
    }));
  }

  async listForAdmin(query: ListTicketsQuery, me: SessionUser) {
    const where = this.adminFilters(query, me);
    const orderBy =
      query.sort === "newest" ? [desc(tickets.createdAt)] : query.sort === "oldest" ? [asc(tickets.createdAt)] : URGENCY_ORDER;

    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({
          ticket: tickets,
          bookTitle: books.title,
          authorName: authorUser.name,
          assigneeName: assignee.name,
          lastMessageRole,
          messageCount,
        })
        .from(tickets)
        .innerJoin(authors, eq(authors.id, tickets.authorId))
        .innerJoin(authorUser, eq(authorUser.id, authors.userId))
        .leftJoin(books, eq(books.id, tickets.bookId))
        .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
        .where(where)
        .orderBy(...orderBy)
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db
        .select({ total: count() })
        .from(tickets)
        .innerJoin(authors, eq(authors.id, tickets.authorId))
        .innerJoin(authorUser, eq(authorUser.id, authors.userId))
        .where(where),
    ]);

    const now = new Date();
    return {
      items: rows.map(({ ticket, bookTitle, authorName, assigneeName, lastMessageRole, messageCount }) => ({
        id: ticket.id,
        reference: ticketRef(ticket.number),
        subject: ticket.subject,
        status: ticket.status,
        category: ticket.category,
        categorySource: ticket.categorySource,
        priority: ticket.priority,
        prioritySource: ticket.prioritySource,
        triageState: ticket.triageState,
        author: { id: ticket.authorId, name: authorName },
        book: ticket.bookId ? { id: ticket.bookId, title: bookTitle } : null,
        assignee: ticket.assigneeId ? { id: ticket.assigneeId, name: assigneeName } : null,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        messageCount,
        awaitingReply: UNRESOLVED_STATUSES.includes(ticket.status) && lastMessageRole !== "ADMIN",
        sla: slaFor(ticket, now),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total: totalRow?.total ?? 0,
    };
  }

  private adminFilters(q: ListTicketsQuery, me: SessionUser): SQL | undefined {
    const conditions: (SQL | undefined)[] = [];
    if (q.status.length) conditions.push(inArray(tickets.status, q.status));
    if (q.category.length) conditions.push(inArray(tickets.category, q.category));
    if (q.priority.length) conditions.push(inArray(tickets.priority, q.priority));
    if (q.assignee === "me") conditions.push(eq(tickets.assigneeId, me.id));
    else if (q.assignee === "unassigned") conditions.push(isNull(tickets.assigneeId));
    else if (q.assignee) conditions.push(eq(tickets.assigneeId, q.assignee));
    if (q.from) conditions.push(gte(tickets.createdAt, new Date(`${q.from}T00:00:00Z`)));
    if (q.to) conditions.push(lt(tickets.createdAt, new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000)));
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
      const refMatch = q.q.match(/^(?:bl-)?(\d+)$/i);
      conditions.push(
        or(
          ilike(tickets.subject, like),
          ilike(tickets.description, like),
          ilike(authorUser.name, like),
          refMatch ? eq(tickets.number, Number(refMatch[1])) : undefined,
        ),
      );
    }
    return and(...conditions);
  }

  async getDetail(ticketId: string, user: SessionUser) {
    const ticket = await this.loadAccessible(ticketId, user);
    const isAdmin = user.role === "ADMIN";

    const [messages, files, book] = await Promise.all([
      this.db
        .select({ message: ticketMessages, senderName: users.name })
        .from(ticketMessages)
        .innerJoin(users, eq(users.id, ticketMessages.senderId))
        .where(eq(ticketMessages.ticketId, ticketId))
        .orderBy(asc(ticketMessages.createdAt)),
      this.db
        .select({ id: attachments.id, filename: attachments.filename, mimeType: attachments.mimeType, sizeBytes: attachments.sizeBytes })
        .from(attachments)
        .where(eq(attachments.ticketId, ticketId)),
      ticket.bookId ? this.db.select().from(books).where(eq(books.id, ticket.bookId)).then((r) => r[0] ?? null) : null,
    ]);

    const base = {
      id: ticket.id,
      reference: ticketRef(ticket.number),
      subject: ticket.subject,
      description: ticket.description,
      status: ticket.status,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      book: book ? { id: book.id, title: book.title, status: book.status } : null,
      attachments: files,
      messages: messages.map(({ message, senderName }) => ({
        id: message.id,
        from: message.senderRole,
        // Authors see the team, not individual staff names.
        senderName: isAdmin || message.senderRole === "AUTHOR" ? senderName : "BookLeaf Author Support",
        body: message.body,
        createdAt: message.createdAt,
        ...(isAdmin ? { aiAssisted: message.aiDraftId !== null, aiDraftEdited: message.aiDraftEdited } : {}),
      })),
    };
    if (!isAdmin) return base;

    const [authorInfo, authorBooks, notes, events, draft, assigneeRow] = await Promise.all([
      this.db
        .select({ id: authors.id, name: users.name, email: users.email, city: authors.city, joinedDate: authors.joinedDate })
        .from(authors)
        .innerJoin(users, eq(users.id, authors.userId))
        .where(eq(authors.id, ticket.authorId))
        .then((r) => r[0]),
      this.db.select().from(books).where(eq(books.authorId, ticket.authorId)).orderBy(asc(books.id)),
      this.db
        .select({ id: internalNotes.id, body: internalNotes.body, createdAt: internalNotes.createdAt, authorName: users.name })
        .from(internalNotes)
        .innerJoin(users, eq(users.id, internalNotes.authorId))
        .where(eq(internalNotes.ticketId, ticketId))
        .orderBy(asc(internalNotes.createdAt)),
      this.db
        .select({ id: ticketEvents.id, type: ticketEvents.type, data: ticketEvents.data, createdAt: ticketEvents.createdAt, actorName: users.name })
        .from(ticketEvents)
        .leftJoin(users, eq(users.id, ticketEvents.actorId))
        .where(eq(ticketEvents.ticketId, ticketId))
        .orderBy(asc(ticketEvents.createdAt)),
      this.drafts.getFreshDraft(ticketId),
      ticket.assigneeId
        ? this.db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, ticket.assigneeId)).then((r) => r[0] ?? null)
        : null,
    ]);

    return {
      ...base,
      category: ticket.category,
      categorySource: ticket.categorySource,
      priority: ticket.priority,
      prioritySource: ticket.prioritySource,
      triageState: ticket.triageState,
      aiConfidence: ticket.aiConfidence,
      aiRationale: ticket.aiRationale,
      assignee: assigneeRow,
      firstResponseAt: ticket.firstResponseAt,
      resolvedAt: ticket.resolvedAt,
      sla: slaFor(ticket, new Date()),
      author: authorInfo,
      authorBooks,
      bookDetails: book,
      notes,
      events,
      draft,
      aiStatus: this.aiStatus(),
    };
  }

  async getAttachment(ticketId: string, attachmentId: string, user: SessionUser) {
    await this.loadAccessible(ticketId, user);
    const [file] = await this.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, attachmentId), eq(attachments.ticketId, ticketId)));
    if (!file) throw notFound("Attachment");
    return file;
  }

  // -------------------------------------------------------------- commands

  async create(user: SessionUser, input: { bookId: string | null; subject: string; description: string }, file?: UploadedFile) {
    const authorId = user.authorId!;
    if (input.bookId) {
      const [book] = await this.db
        .select({ id: books.id })
        .from(books)
        .where(and(eq(books.id, input.bookId), eq(books.authorId, authorId)));
      if (!book) throw badRequest("Some fields are invalid.", { fields: { bookId: "Select one of your books." } });
    }

    const ticket = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(tickets)
        .values({ authorId, bookId: input.bookId, subject: input.subject, description: input.description })
        .returning();
      if (file) {
        await tx.insert(attachments).values({
          ticketId: created!.id,
          filename: file.originalname.slice(0, 200),
          mimeType: file.mimetype,
          sizeBytes: file.size,
          data: file.buffer,
        });
      }
      await tx.insert(ticketEvents).values({ ticketId: created!.id, actorId: user.id, type: "created", data: {} });
      return created!;
    });

    this.hub.publish({ type: "ticket.created", ticketId: ticket.id, authorId });
    // Triage happens after the response; the ticket exists even if the AI is down.
    this.triage.enqueue(ticket.id);
    return { id: ticket.id, reference: ticketRef(ticket.number), status: ticket.status, createdAt: ticket.createdAt };
  }

  async addAuthorMessage(ticketId: string, user: SessionUser, body: string) {
    const ticket = await this.loadAccessible(ticketId, user);
    if (ticket.status === "CLOSED") {
      throw conflict("This ticket is closed. Please raise a new ticket if you need more help.");
    }
    const reopen = ticket.status === "RESOLVED";

    const message = await this.db.transaction(async (tx) => {
      const [msg] = await tx
        .insert(ticketMessages)
        .values({ ticketId, senderId: user.id, senderRole: "AUTHOR", body })
        .returning();
      await tx
        .update(tickets)
        .set({ updatedAt: new Date(), ...(reopen ? { status: "OPEN" as const, resolvedAt: null } : {}) })
        .where(eq(tickets.id, ticketId));
      if (reopen) {
        await tx.insert(ticketEvents).values({
          ticketId,
          actorId: user.id,
          type: "status_changed",
          data: { from: "RESOLVED", to: "OPEN", reason: "Author replied" },
        });
      }
      return msg!;
    });

    this.hub.publish({ type: "ticket.message", ticketId, authorId: ticket.authorId });
    return message;
  }

  async addAdminReply(ticketId: string, admin: SessionUser, input: { body: string; draftId?: string; status?: TicketStatus }) {
    const ticket = await this.loadAccessible(ticketId, admin);
    if (ticket.status === "CLOSED" && input.status !== "OPEN" && input.status !== "IN_PROGRESS") {
      throw conflict("This ticket is closed. Reopen it before replying.");
    }

    let aiDraftEdited: boolean | null = null;
    if (input.draftId) {
      const [draft] = await this.db
        .select({ body: aiDrafts.body })
        .from(aiDrafts)
        .where(and(eq(aiDrafts.id, input.draftId), eq(aiDrafts.ticketId, ticketId)));
      if (!draft) throw badRequest("Some fields are invalid.", { fields: { draftId: "Draft not found for this ticket." } });
      aiDraftEdited = draft.body.trim() !== input.body.trim();
    }

    const nextStatus: TicketStatus = input.status ?? (ticket.status === "OPEN" ? "IN_PROGRESS" : ticket.status);
    const now = new Date();

    const message = await this.db.transaction(async (tx) => {
      const [msg] = await tx
        .insert(ticketMessages)
        .values({
          ticketId,
          senderId: admin.id,
          senderRole: "ADMIN",
          body: input.body,
          aiDraftId: input.draftId ?? null,
          aiDraftEdited,
        })
        .returning();
      await tx
        .update(tickets)
        .set({
          status: nextStatus,
          updatedAt: now,
          firstResponseAt: ticket.firstResponseAt ?? now,
          resolvedAt: resolvedAtFor(nextStatus, ticket, now),
          // Replying makes you the owner if nobody is.
          assigneeId: ticket.assigneeId ?? admin.id,
        })
        .where(eq(tickets.id, ticketId));
      await tx.insert(ticketEvents).values({
        ticketId,
        actorId: admin.id,
        type: "replied",
        data: { aiAssisted: Boolean(input.draftId), aiDraftEdited },
      });
      if (nextStatus !== ticket.status) {
        await tx.insert(ticketEvents).values({
          ticketId,
          actorId: admin.id,
          type: "status_changed",
          data: { from: ticket.status, to: nextStatus },
        });
      }
      return msg!;
    });

    this.hub.publish({ type: "ticket.message", ticketId, authorId: ticket.authorId });
    return message;
  }

  async update(
    ticketId: string,
    admin: SessionUser,
    patch: { status?: TicketStatus; category?: Ticket["category"]; priority?: Ticket["priority"]; assigneeId?: string | null },
  ) {
    const ticket = await this.loadAccessible(ticketId, admin);

    if (patch.assigneeId) {
      const [target] = await this.db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, patch.assigneeId));
      if (target?.role !== "ADMIN") {
        throw badRequest("Some fields are invalid.", { fields: { assigneeId: "Tickets can only be assigned to team members." } });
      }
    }

    const now = new Date();
    const changes: Partial<typeof tickets.$inferInsert> = {};
    const events: { type: string; data: Record<string, unknown> }[] = [];

    if (patch.status !== undefined && patch.status !== ticket.status) {
      changes.status = patch.status;
      changes.resolvedAt = resolvedAtFor(patch.status, ticket, now);
      events.push({ type: "status_changed", data: { from: ticket.status, to: patch.status } });
    }
    if (patch.category !== undefined && (patch.category !== ticket.category || ticket.categorySource !== "ADMIN")) {
      changes.category = patch.category;
      changes.categorySource = "ADMIN";
      events.push({ type: "category_overridden", data: { from: ticket.category, to: patch.category, previousSource: ticket.categorySource } });
    }
    if (patch.priority !== undefined && (patch.priority !== ticket.priority || ticket.prioritySource !== "ADMIN")) {
      changes.priority = patch.priority;
      changes.prioritySource = "ADMIN";
      events.push({ type: "priority_overridden", data: { from: ticket.priority, to: patch.priority, previousSource: ticket.prioritySource } });
    }
    if (patch.assigneeId !== undefined && patch.assigneeId !== ticket.assigneeId) {
      changes.assigneeId = patch.assigneeId;
      events.push({ type: "assigned", data: { assigneeId: patch.assigneeId } });
    }
    if (events.length === 0) return;

    await this.db.transaction(async (tx) => {
      await tx.update(tickets).set({ ...changes, updatedAt: now }).where(eq(tickets.id, ticketId));
      await tx.insert(ticketEvents).values(events.map((e) => ({ ticketId, actorId: admin.id, ...e })));
    });

    // Authors only care about status; triage and assignment are internal.
    this.hub.publish({ type: "ticket.updated", ticketId, authorId: ticket.authorId, adminOnly: changes.status === undefined });
  }

  async addNote(ticketId: string, admin: SessionUser, body: string) {
    const ticket = await this.loadAccessible(ticketId, admin);
    const [note] = await this.db.insert(internalNotes).values({ ticketId, authorId: admin.id, body }).returning();
    this.hub.publish({ type: "ticket.updated", ticketId, authorId: ticket.authorId, adminOnly: true });
    return note!;
  }

  /** Admins can access any ticket; authors only their own. Others get 404, not 403, so IDs can't be probed. */
  async loadAccessible(ticketId: string, user: SessionUser): Promise<Ticket> {
    const [ticket] = await this.db.select().from(tickets).where(eq(tickets.id, ticketId));
    if (!ticket || (user.role === "AUTHOR" && ticket.authorId !== user.authorId)) throw notFound("Ticket");
    return ticket;
  }
}

function resolvedAtFor(status: TicketStatus, ticket: Ticket, now: Date): Date | null {
  if (status === "RESOLVED" || status === "CLOSED") return ticket.resolvedAt ?? now;
  return null;
}
