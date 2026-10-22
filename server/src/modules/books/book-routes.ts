import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { PAYOUT_THRESHOLD_INR, assessRoyalties, isoDate, payoutCalendar } from "../../ai/account-facts.js";
import type { Db } from "../../db/client.js";
import { authors, books, users } from "../../db/schema.js";
import { handler } from "../../lib/http.js";
import { currentUser } from "../../middleware/auth.js";

export function bookRoutes(deps: { db: Db; now?: () => Date }) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());
  const router = Router();

  /**
   * Authors: their own books plus royalty totals and the next payout date.
   * Admins: the full catalogue with author names.
   */
  router.get(
    "/",
    handler(async (req, res) => {
      const user = currentUser(req);
      if (user.role === "ADMIN") {
        const rows = await db
          .select({ book: books, authorName: users.name })
          .from(books)
          .innerJoin(authors, eq(authors.id, books.authorId))
          .innerJoin(users, eq(users.id, authors.userId))
          .orderBy(asc(books.id));
        res.json({ items: rows.map((r) => ({ ...r.book, authorName: r.authorName })) });
        return;
      }

      const items = await db.select().from(books).where(eq(books.authorId, user.authorId!)).orderBy(asc(books.publicationDate));
      const today = now();
      const royalty = assessRoyalties(items, today);
      const calendar = payoutCalendar(today);
      res.json({
        items,
        summary: {
          copiesSold: items.reduce((s, b) => s + b.copiesSold, 0),
          royaltyEarned: items.reduce((s, b) => s + b.royaltyEarned, 0),
          royaltyPaid: items.reduce((s, b) => s + b.royaltyPaid, 0),
          royaltyPending: royalty.pendingTotal,
          payoutThreshold: PAYOUT_THRESHOLD_INR,
          belowThreshold: royalty.belowThreshold,
          nextPayoutBy: isoDate(calendar.nextPayoutBy),
        },
      });
    }),
  );

  return router;
}
