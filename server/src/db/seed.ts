import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./client.js";
import { authors, books, internalNotes, ticketEvents, ticketMessages, tickets, users } from "./schema.js";

export const DEMO_AUTHOR_PASSWORD = "Author@123";
export const DEMO_ADMIN_PASSWORD = "Admin@123";

export const DEMO_ADMINS = [
  { name: "Aisha Khan", email: "admin@bookleafpub.com" },
  { name: "Rahul Verma", email: "support@bookleafpub.com" },
];

const SAMPLE_DATA_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data/bookleaf_sample_data.json");

/** Validates BookLeaf's sample file so a malformed record fails loudly at seed time. */
const SampleDataSchema = z.object({
  authors: z.array(
    z.object({
      author_id: z.string(),
      name: z.string(),
      email: z.email(),
      phone: z.string().nullable(),
      city: z.string().nullable(),
      joined_date: z.string().nullable(),
      books: z.array(
        z.object({
          book_id: z.string(),
          title: z.string(),
          isbn: z.string(),
          genre: z.string(),
          publication_date: z.string().nullable(),
          status: z.string(),
          mrp: z.number().nullable(),
          author_royalty_per_copy: z.number().nullable(),
          total_copies_sold: z.number(),
          total_royalty_earned: z.number(),
          royalty_paid: z.number(),
          royalty_pending: z.number(),
          last_royalty_payout_date: z.string().nullable(),
          print_partner: z.string().nullable(),
          available_on: z.array(z.string()),
        }),
      ),
    }),
  ),
});

/**
 * Example tickets so the admin queue isn't empty on first login. They start
 * untriaged; the boot-time triage sweep classifies them (AI or rules).
 */
const DEMO_TICKETS: {
  authorId: string;
  bookId: string | null;
  hoursAgo: number;
  subject: string;
  description: string;
  reply?: { hoursAgo: number; body: string; status: "IN_PROGRESS" | "RESOLVED" };
  note?: string;
}[] = [
  {
    authorId: "AUTH001",
    bookId: "BK001",
    hoursAgo: 70,
    subject: "Royalty of ₹3,570 still pending after a year",
    description:
      "Hi, my last royalty payout for Whispers of the Ganges was on 15 October 2025 and since then my dashboard has shown ₹3,570 pending. It has been a whole year and I have not received anything. Can someone please tell me what is happening?",
  },
  {
    authorId: "AUTH002",
    bookId: "BK003",
    hoursAgo: 5,
    subject: "Different ISBN on Amazon vs my printed copy",
    description:
      "The Amazon India listing for Code & Karma shows a different ISBN than the one printed on the back cover of my physical copies. Readers are asking me which one is correct and I'm worried sales are being attributed to the wrong book.",
  },
  {
    authorId: "AUTH003",
    bookId: "BK005",
    hoursAgo: 26,
    subject: "Never received any royalty since publishing",
    description:
      "Between Two Temples was published in July 2024. The dashboard says I have earned ₹2,546 but I have never received a single payment. Is there a problem with my account or bank details?",
  },
  {
    authorId: "AUTH007",
    bookId: "BK013",
    hoursAgo: 50,
    subject: "Cover design for Midnight in Mysore is taking very long",
    description:
      "My thriller Midnight in Mysore has been stuck in cover design for weeks. My earlier books moved much faster. When can I expect the cover and what's the overall timeline to publication?",
  },
  {
    authorId: "AUTH009",
    bookId: "BK015",
    hoursAgo: 6,
    subject: "Raising Roots still in typesetting after 3 weeks",
    description:
      "It's been 3 weeks and my book Raising Roots is still showing as typesetting. When will it be done? I had planned a launch event next month.",
  },
  {
    authorId: "AUTH006",
    bookId: "BK010",
    hoursAgo: 1,
    subject: 'Turban Tales showing "Currently Unavailable" on Amazon',
    description:
      'My book Turban Tales is published but it\'s showing as "Currently Unavailable" on Amazon India since yesterday. I shared the link on social media and people can\'t buy it.',
  },
  {
    authorId: "AUTH005",
    bookId: "BK008",
    hoursAgo: 96,
    subject: "Author copies have blurry images and misaligned pages",
    description:
      "I received my author copies of Cardamom & Chaos and the print quality is terrible. The images in chapter 4 are blurry and several pages are misaligned. I was planning to gift these at a book club.",
    reply: {
      hoursAgo: 90,
      status: "IN_PROGRESS",
      body: "Hi Meera,\n\nI'm really sorry your author copies of Cardamom & Chaos arrived like this. Blurry images and misaligned pages are not the standard we hold ourselves to.\n\nCould you reply with a few photos of the affected pages (chapter 4 and the misaligned ones)? Once our print team verifies them, we'll arrange a free reprint, which takes 5–7 business days.\n\nWarm regards,\nBookLeaf Author Support",
    },
    note: "Printed by Repro India. Asked print partner for batch details; waiting on author photos.",
  },
  {
    authorId: "AUTH004",
    bookId: null,
    hoursAgo: 48,
    subject: "Can I update my author bio?",
    description:
      "I'd like to update my author bio across both my books since I have a new job and a podcast now. How do I do that and how long does it take to show on Amazon?",
  },
  {
    authorId: "AUTH010",
    bookId: "BK017",
    hoursAgo: 170,
    subject: "Royalty seems low for 612 copies",
    description:
      "Durga's Daughters has sold 612 copies at ₹475 MRP but my total royalty is only ₹27,540. That's about ₹45 a copy. Can you explain how this is calculated?",
    reply: {
      hoursAgo: 160,
      status: "RESOLVED",
      body: "Hi Diya,\n\nThank you for asking. Wanting to understand your earnings is completely fair.\n\nYour royalty is 80% of the net profit per copy, where net profit is the MRP (₹475) minus printing cost, platform commission (Amazon/Flipkart) and shipping. For Durga's Daughters that works out to ₹45 per copy, so 612 copies = ₹27,540. Of this, ₹25,000 has been paid and ₹2,540 is pending for the next payout.\n\nIf you'd like, we can share a line-by-line breakdown per platform. Just reply here.\n\nWarm regards,\nBookLeaf Author Support",
    },
  },
  {
    authorId: "AUTH008",
    bookId: null,
    hoursAgo: 20,
    subject: "Publishing my second book with Bestseller Breakthrough",
    description:
      "I'm planning my second poetry collection and considering the Bestseller Breakthrough package this time. What does it include beyond the Standard Free package, and can my first book be added to the marketing?",
  },
];

/** Seeds BookLeaf's sample dataset plus demo admins and tickets. No-op if users already exist. */
export async function seedIfEmpty(db: Db, opts: { now?: Date } = {}): Promise<boolean> {
  const existing = await db.$count(users);
  if (existing > 0) return false;

  const data = SampleDataSchema.parse(JSON.parse(fs.readFileSync(SAMPLE_DATA_PATH, "utf8")));
  const now = opts.now ?? new Date();
  // Cost 10 keeps seeding fast; the hash format is the same as production's.
  const [authorHash, adminHash] = await Promise.all([
    bcrypt.hash(DEMO_AUTHOR_PASSWORD, 10),
    bcrypt.hash(DEMO_ADMIN_PASSWORD, 10),
  ]);

  await db.transaction(async (tx) => {
    const adminRows = await tx
      .insert(users)
      .values(DEMO_ADMINS.map((a) => ({ ...a, passwordHash: adminHash, role: "ADMIN" as const })))
      .returning();

    const userIdByAuthor = new Map<string, string>();
    for (const a of data.authors) {
      const [user] = await tx
        .insert(users)
        .values({ email: a.email.toLowerCase(), name: a.name, passwordHash: authorHash, role: "AUTHOR" })
        .returning();
      userIdByAuthor.set(a.author_id, user!.id);
      await tx.insert(authors).values({ id: a.author_id, userId: user!.id, phone: a.phone, city: a.city, joinedDate: a.joined_date });
      if (a.books.length) {
        await tx.insert(books).values(
          a.books.map((b) => ({
            id: b.book_id,
            authorId: a.author_id,
            title: b.title,
            isbn: b.isbn,
            genre: b.genre,
            publicationDate: b.publication_date,
            status: b.status,
            mrp: b.mrp,
            royaltyPerCopy: b.author_royalty_per_copy,
            copiesSold: b.total_copies_sold,
            royaltyEarned: b.total_royalty_earned,
            royaltyPaid: b.royalty_paid,
            royaltyPending: b.royalty_pending,
            lastPayoutDate: b.last_royalty_payout_date,
            printPartner: b.print_partner,
            availableOn: b.available_on,
          })),
        );
      }
    }

    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
    // Oldest first so ticket numbers follow creation order.
    for (const t of [...DEMO_TICKETS].sort((a, b) => b.hoursAgo - a.hoursAgo)) {
      const authorUserId = userIdByAuthor.get(t.authorId)!;
      const admin = adminRows[0]!;
      const created = hoursAgo(t.hoursAgo);
      const replied = t.reply ? hoursAgo(t.reply.hoursAgo) : null;
      const [ticket] = await tx
        .insert(tickets)
        .values({
          authorId: t.authorId,
          bookId: t.bookId,
          subject: t.subject,
          description: t.description,
          status: t.reply?.status ?? "OPEN",
          assigneeId: t.reply ? admin.id : null,
          createdAt: created,
          updatedAt: replied ?? created,
          firstResponseAt: replied,
          resolvedAt: t.reply?.status === "RESOLVED" ? replied : null,
        })
        .returning();
      await tx.insert(ticketEvents).values({ ticketId: ticket!.id, actorId: authorUserId, type: "created", createdAt: created });
      if (t.reply && replied) {
        await tx.insert(ticketMessages).values({
          ticketId: ticket!.id,
          senderId: admin.id,
          senderRole: "ADMIN",
          body: t.reply.body,
          createdAt: replied,
        });
        await tx.insert(ticketEvents).values({
          ticketId: ticket!.id,
          actorId: admin.id,
          type: "status_changed",
          data: { from: "OPEN", to: t.reply.status },
          createdAt: replied,
        });
      }
      if (t.note) {
        await tx.insert(internalNotes).values({ ticketId: ticket!.id, authorId: admin.id, body: t.note, createdAt: replied ?? created });
      }
    }
  });
  return true;
}

/** Wipes all data (used by `npm run db:seed -- --reset`). */
export async function resetDatabase(db: Db): Promise<void> {
  await db.execute(
    sql`truncate table ai_calls, ai_drafts, ticket_events, internal_notes, attachments, ticket_messages, tickets, books, authors, users restart identity cascade`,
  );
}
