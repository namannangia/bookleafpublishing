import { describe, expect, it } from "vitest";
import { assessRoyalties, buildAccountFacts, isoDate, payoutCalendar } from "../src/ai/account-facts.js";
import { buildDraftUserMessage, MAX_THREAD_MESSAGES } from "../src/ai/prompts/draft.js";
import { classifyByRules } from "../src/ai/rules-classifier.js";
import type { Book } from "../src/db/schema.js";

const book = (overrides: Partial<Book>): Book => ({
  id: "BK1",
  authorId: "A1",
  title: "Test Book",
  isbn: "978-0",
  genre: "Fiction",
  publicationDate: "2024-01-01",
  status: "Published & Live",
  mrp: 300,
  royaltyPerCopy: 25,
  copiesSold: 10,
  royaltyEarned: 250,
  royaltyPaid: 0,
  royaltyPending: 250,
  lastPayoutDate: null,
  printPartner: "In-House",
  availableOn: ["Amazon India"],
  ...overrides,
});

describe("payout calendar", () => {
  it.each([
    ["2026-10-22", "2026-11-14", "2026-09-30"], // inside Q3's 45-day window
    ["2026-11-20", "2027-02-14", "2026-12-31"], // window closed, next is Q4's
    ["2026-01-05", "2026-02-14", "2025-12-31"],
    ["2026-05-15", "2026-05-15", "2026-03-31"], // deadline day itself
  ])("on %s the next payout is due by %s", (today, due, covers) => {
    const cal = payoutCalendar(new Date(`${today}T12:00:00Z`));
    expect(isoDate(cal.nextPayoutBy)).toBe(due);
    expect(isoDate(cal.nextPayoutCoversQuarterEnding)).toBe(covers);
  });
});

describe("royalty assessment", () => {
  const today = new Date("2026-10-22T00:00:00Z");

  it("flags balances under ₹1,000 as rolling over, not overdue", () => {
    const r = assessRoyalties([book({ royaltyPending: 850 })], today);
    expect(r).toEqual({ pendingTotal: 850, belowThreshold: true, possiblyOverdue: false });
  });

  it("flags an old unpaid balance above the threshold as possibly overdue", () => {
    const r = assessRoyalties([book({ royaltyPending: 3570, lastPayoutDate: "2025-10-15" })], today);
    expect(r.possiblyOverdue).toBe(true);
  });

  it("does not flag a recent payout", () => {
    const r = assessRoyalties([book({ royaltyPending: 3570, lastPayoutDate: "2026-08-10" })], today);
    expect(r.possiblyOverdue).toBe(false);
  });

  it("describes books in production without sales figures", () => {
    const facts = buildAccountFacts({
      authorName: "Kavita",
      allBooks: [],
      selectedBook: book({ status: "In Production - Typesetting", mrp: null, publicationDate: null, royaltyPending: 0 }),
      category: "BOOK_STATUS_PRODUCTION",
      today,
    });
    expect(facts).toContain('"Typesetting" stage');
    expect(facts).toContain("Remaining stages: Proofreading → ISBN Assignment");
    expect(facts).not.toContain("MRP");
  });

  it("keeps royalty figures out of non-royalty tickets", () => {
    const args = { authorName: "Rohit", allBooks: [book({ royaltyPending: 5280, lastPayoutDate: "2025-09-01" })], today };
    const isbn = buildAccountFacts({ ...args, selectedBook: args.allBooks[0]!, category: "ISBN_METADATA" });
    expect(isbn).toContain("ISBN 978-0");
    expect(isbn).not.toMatch(/royalty|payout|pending/i);
    const royalty = buildAccountFacts({ ...args, selectedBook: args.allBooks[0]!, category: "ROYALTY_PAYMENTS" });
    expect(royalty).toContain("pending ₹5,280");
    expect(royalty).toContain("may be overdue");
  });
});

describe("draft prompt thread trimming", () => {
  it("keeps only the most recent messages", () => {
    const thread = Array.from({ length: 10 }, (_, i) => ({ from: "Author" as const, body: `message-${i}` }));
    const prompt = buildDraftUserMessage({ accountFacts: "", subject: "s", description: "d", thread });
    expect(prompt).toContain(`[${10 - MAX_THREAD_MESSAGES} earlier message(s) omitted]`);
    expect(prompt).not.toContain("message-0");
    expect(prompt).toContain("message-9");
  });
});

describe("rules classifier (AI fallback)", () => {
  it.each([
    ["I haven't received any royalty for 6 months", "ROYALTY_PAYMENTS", "CRITICAL"],
    ["My book shows a different ISBN on Amazon", "ISBN_METADATA", "HIGH"],
    ["The print quality is terrible, images are blurry", "PRINTING_QUALITY", "HIGH"],
    ['Book is showing as "Currently Unavailable" on Flipkart', "DISTRIBUTION_AVAILABILITY", "HIGH"],
    ["It's been 3 weeks and my book is still in typesetting", "BOOK_STATUS_PRODUCTION", "MEDIUM"],
    ["Can I update my author bio?", "GENERAL_INQUIRY", "LOW"],
  ])("%s → %s / %s", (text, category, priority) => {
    expect(classifyByRules(text)).toMatchObject({ category, priority });
  });
});
