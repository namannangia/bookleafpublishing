import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { CATEGORIES, PRIORITIES, ROLES, TICKET_STATUSES, TRIAGE_SOURCES, TRIAGE_STATES } from "../domain.js";

export const roleEnum = pgEnum("role", ROLES);
export const ticketStatusEnum = pgEnum("ticket_status", TICKET_STATUSES);
export const categoryEnum = pgEnum("ticket_category", CATEGORIES);
export const priorityEnum = pgEnum("ticket_priority", PRIORITIES);
export const triageSourceEnum = pgEnum("triage_source", TRIAGE_SOURCES);
export const triageStateEnum = pgEnum("triage_state", TRIAGE_STATES);

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (value) => Buffer.from(value),
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Login identity. Authors and admins share this table and are told apart by `role`. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull(),
  createdAt: createdAt(),
});

/** Author profile. Keeps the IDs from BookLeaf's dataset (AUTH001...) so records match theirs. */
export const authors = pgTable("authors", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  phone: text("phone"),
  city: text("city"),
  joinedDate: date("joined_date"),
});

/** Money is stored in whole rupees, matching the source dataset. */
export const books = pgTable(
  "books",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id")
      .notNull()
      .references(() => authors.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    isbn: text("isbn").notNull().unique(),
    genre: text("genre").notNull(),
    publicationDate: date("publication_date"),
    status: text("status").notNull(),
    mrp: integer("mrp"),
    royaltyPerCopy: integer("royalty_per_copy"),
    copiesSold: integer("copies_sold").notNull().default(0),
    royaltyEarned: integer("royalty_earned").notNull().default(0),
    royaltyPaid: integer("royalty_paid").notNull().default(0),
    royaltyPending: integer("royalty_pending").notNull().default(0),
    lastPayoutDate: date("last_payout_date"),
    printPartner: text("print_partner"),
    availableOn: text("available_on").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [index("books_author_idx").on(t.authorId)],
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human-friendly reference shown as BL-1001 etc. */
    number: serial("number").notNull().unique(),
    authorId: text("author_id")
      .notNull()
      .references(() => authors.id, { onDelete: "cascade" }),
    /** Null means "General / Account level". */
    bookId: text("book_id").references(() => books.id, { onDelete: "set null" }),
    subject: text("subject").notNull(),
    description: text("description").notNull(),
    status: ticketStatusEnum("status").notNull().default("OPEN"),

    // Triage. Null until classified; `*_source` records who set the current value.
    category: categoryEnum("category"),
    categorySource: triageSourceEnum("category_source"),
    priority: priorityEnum("priority"),
    prioritySource: triageSourceEnum("priority_source"),
    triageState: triageStateEnum("triage_state").notNull().default("PENDING"),
    aiConfidence: real("ai_confidence"),
    aiRationale: text("ai_rationale"),

    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    index("tickets_queue_idx").on(t.status, t.priority, t.createdAt),
    index("tickets_author_idx").on(t.authorId, t.createdAt),
    index("tickets_assignee_idx").on(t.assigneeId),
    index("tickets_triage_idx").on(t.triageState),
  ],
);

/** The author-visible conversation. Internal notes live in their own table so they can't leak by accident. */
export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id),
    senderRole: roleEnum("sender_role").notNull(),
    body: text("body").notNull(),
    /** Set when an admin sent a reply that started from an AI draft. */
    aiDraftId: uuid("ai_draft_id"),
    /** Whether the admin changed the AI draft before sending. Tracks draft quality over time. */
    aiDraftEdited: boolean("ai_draft_edited"),
    createdAt: createdAt(),
  },
  (t) => [index("ticket_messages_ticket_idx").on(t.ticketId, t.createdAt)],
);

export const internalNotes = pgTable(
  "internal_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("internal_notes_ticket_idx").on(t.ticketId)],
);

/**
 * Attachments are stored in Postgres (bytea) so the demo survives redeploys on
 * hosts with ephemeral disks. In production these would go to object storage.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("attachments_ticket_idx").on(t.ticketId)],
);

/** Cached AI drafts. A draft is reused until the conversation changes. */
export const aiDrafts = pgTable(
  "ai_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    /** Follow-up actions the admin must actually perform for the reply to be true. */
    agentActions: jsonb("agent_actions").$type<string[]>().notNull().default([]),
    suggestedStatus: ticketStatusEnum("suggested_status"),
    model: text("model").notNull(),
    /** Number of public messages when the draft was generated; used to detect staleness. */
    contextMessageCount: integer("context_message_count").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_drafts_ticket_idx").on(t.ticketId, t.createdAt)],
);

/** Audit trail: status changes, triage overrides, assignment, AI triage. */
export const ticketEvents = pgTable(
  "ticket_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    /** Null when the system or AI performed the action. */
    actorId: uuid("actor_id").references(() => users.id),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("ticket_events_ticket_idx").on(t.ticketId, t.createdAt)],
);

/** One row per LLM call, for cost and reliability monitoring. */
export const aiCalls = pgTable(
  "ai_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("ai_calls_created_idx").on(t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Author = typeof authors.$inferSelect;
export type Book = typeof books.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type TicketMessage = typeof ticketMessages.$inferSelect;
export type InternalNote = typeof internalNotes.$inferSelect;
export type AiDraft = typeof aiDrafts.$inferSelect;
export type TicketEvent = typeof ticketEvents.$inferSelect;
