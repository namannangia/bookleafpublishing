import { z } from "zod";
import { CATEGORIES, PRIORITIES, TICKET_STATUSES } from "../../domain.js";

const trimmed = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .min(min, `${label} must be at least ${min} characters.`)
    .max(max, `${label} must be at most ${max} characters.`);

export const CreateTicketSchema = z.object({
  // Multipart forms send "" for "General / Account level".
  bookId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
  subject: trimmed(5, 150, "Subject"),
  description: trimmed(20, 5000, "Description"),
});

export const AuthorMessageSchema = z.object({
  body: trimmed(1, 5000, "Message"),
});

export const AdminMessageSchema = z.object({
  body: trimmed(1, 5000, "Message"),
  /** The AI draft this reply started from, if any. */
  draftId: z.uuid().optional(),
  /** Status to move the ticket to with this reply. Defaults to IN_PROGRESS for open tickets. */
  status: z.enum(TICKET_STATUSES).optional(),
});

export const UpdateTicketSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    category: z.enum(CATEGORIES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assigneeId: z.uuid().nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Provide at least one field to update." });

export const NoteSchema = z.object({
  body: trimmed(1, 5000, "Note"),
});

export const DraftRequestSchema = z.object({
  regenerate: z.boolean().optional(),
});

const csvOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []))
    .pipe(z.array(z.enum(values)));

export const ListTicketsQuerySchema = z.object({
  status: csvOf(TICKET_STATUSES),
  category: csvOf(CATEGORIES),
  priority: csvOf(PRIORITIES),
  assignee: z.union([z.literal("me"), z.literal("unassigned"), z.uuid()]).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(["urgency", "newest", "oldest"]).default("urgency"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListTicketsQuery = z.infer<typeof ListTicketsQuerySchema>;

export const ALLOWED_ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
