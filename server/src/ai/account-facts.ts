import type { Book } from "../db/schema.js";
import { PRODUCTION_STAGES } from "./knowledge-base.js";

/**
 * Deterministic facts about an author's account, computed in code and handed to
 * the model as plain statements. LLMs are unreliable at date arithmetic, so we
 * never ask the model to work out payout dates or thresholds itself.
 *
 * Assumption: royalty quarters are calendar quarters (Jan–Mar, Apr–Jun, ...).
 */

export const PAYOUT_THRESHOLD_INR = 1000;
const PAYOUT_WINDOW_DAYS = 45;
const DAY_MS = 86_400_000;

const toUtcDate = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const formatDate = (d: Date) =>
  d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Last day of the calendar quarter containing `d`. */
export function quarterEnd(d: Date): Date {
  const q = Math.floor(d.getUTCMonth() / 3);
  return new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0));
}

function previousQuarterEnd(d: Date): Date {
  const q = Math.floor(d.getUTCMonth() / 3);
  return new Date(Date.UTC(d.getUTCFullYear(), q * 3, 0));
}

export interface PayoutCalendar {
  /** Next date by which a royalty payout is due, and the quarter it covers. */
  nextPayoutBy: Date;
  nextPayoutCoversQuarterEnding: Date;
  /** End of the most recent quarter whose payout window has fully closed. */
  lastClosedQuarterEnd: Date;
}

export function payoutCalendar(today: Date): PayoutCalendar {
  const t = toUtcDate(today);
  const prevQEnd = previousQuarterEnd(t);
  const prevDeadline = addDays(prevQEnd, PAYOUT_WINDOW_DAYS);
  if (t <= prevDeadline) {
    // Still inside last quarter's payout window.
    return {
      nextPayoutBy: prevDeadline,
      nextPayoutCoversQuarterEnding: prevQEnd,
      lastClosedQuarterEnd: previousQuarterEnd(prevQEnd),
    };
  }
  const curQEnd = quarterEnd(t);
  return {
    nextPayoutBy: addDays(curQEnd, PAYOUT_WINDOW_DAYS),
    nextPayoutCoversQuarterEnding: curQEnd,
    lastClosedQuarterEnd: prevQEnd,
  };
}

export interface RoyaltyAssessment {
  pendingTotal: number;
  belowThreshold: boolean;
  /**
   * True when a balance at or above the threshold exists but no payout has been
   * made since before the last closed payout window, so a payout was likely missed.
   * It's a signal for the admin to verify, not a verdict.
   */
  possiblyOverdue: boolean;
}

export function assessRoyalties(books: Book[], today: Date): RoyaltyAssessment {
  const pendingTotal = books.reduce((sum, b) => sum + b.royaltyPending, 0);
  const belowThreshold = pendingTotal > 0 && pendingTotal < PAYOUT_THRESHOLD_INR;
  const { lastClosedQuarterEnd } = payoutCalendar(today);

  const possiblyOverdue = books.some((b) => {
    if (b.royaltyPending <= 0 || pendingTotal < PAYOUT_THRESHOLD_INR) return false;
    const reference = b.lastPayoutDate ?? b.publicationDate;
    return reference !== null && new Date(reference) < lastClosedQuarterEnd;
  });

  return { pendingTotal, belowThreshold, possiblyOverdue };
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function describeProductionStage(status: string): string | null {
  const match = status.match(/^In Production - (.+)$/);
  if (!match) return null;
  const stage = match[1]!.trim();
  const idx = PRODUCTION_STAGES.findIndex((s) => s.toLowerCase() === stage.toLowerCase());
  const remaining = idx >= 0 ? PRODUCTION_STAGES.slice(idx + 1).join(" → ") : "unknown";
  return `Currently in production at the "${stage}" stage. Remaining stages: ${remaining}.`;
}

/** One compact line per book. Only the selected book is included when the ticket names one. */
export function describeBook(b: Book): string {
  const lines = [`"${b.title}" (ISBN ${b.isbn}, ${b.genre}). Status: ${b.status}.`];
  const production = describeProductionStage(b.status);
  if (production) {
    lines.push(production + " Not yet on sale, so no sales or royalties yet.");
    return lines.join(" ");
  }
  if (b.publicationDate) lines.push(`Published ${formatDate(new Date(b.publicationDate))}.`);
  if (b.mrp !== null) lines.push(`MRP ${inr(b.mrp)}; author royalty ${inr(b.royaltyPerCopy ?? 0)} per copy.`);
  lines.push(
    `${b.copiesSold} copies sold. Royalty earned ${inr(b.royaltyEarned)}, paid ${inr(b.royaltyPaid)}, pending ${inr(b.royaltyPending)}.`,
  );
  lines.push(
    b.lastPayoutDate ? `Last payout: ${formatDate(new Date(b.lastPayoutDate))}.` : "No payout has been made for this book yet.",
  );
  if (b.printPartner) lines.push(`Printed by: ${b.printPartner}.`);
  lines.push(`Available on: ${b.availableOn.length ? b.availableOn.join(", ") : "not listed on any platform yet"}.`);
  return lines.join(" ");
}

/**
 * The fact sheet handed to the drafting model. `selectedBook` is null for
 * account-level queries, in which case every book gets a line.
 */
export function buildAccountFacts(opts: {
  authorName: string;
  allBooks: Book[];
  selectedBook: Book | null;
  today: Date;
}): string {
  const { allBooks, selectedBook, today } = opts;
  const cal = payoutCalendar(today);
  const royalty = assessRoyalties(allBooks, today);

  const lines = [
    `Today's date: ${formatDate(today)}.`,
    `Author: ${opts.authorName}.`,
    selectedBook ? `Book in question: ${describeBook(selectedBook)}` : "Query is account-level (no specific book selected).",
  ];
  if (!selectedBook) {
    for (const b of allBooks) lines.push(`- ${describeBook(b)}`);
  }
  lines.push(
    `Account-wide pending royalty: ${inr(royalty.pendingTotal)}.`,
    `Next scheduled payout: by ${formatDate(cal.nextPayoutBy)} (covers sales up to the quarter ending ${formatDate(cal.nextPayoutCoversQuarterEnding)}).`,
  );
  if (royalty.belowThreshold) {
    lines.push(
      `The pending balance is below the ${inr(PAYOUT_THRESHOLD_INR)} payout threshold, so it rolls over until it crosses the threshold.`,
    );
  }
  if (royalty.possiblyOverdue) {
    lines.push(
      "Flag: a balance above the threshold has been pending since before the last payout window closed. The payout may be overdue; this needs verification and escalation (48-hour timeline).",
    );
  }
  return lines.join("\n");
}
