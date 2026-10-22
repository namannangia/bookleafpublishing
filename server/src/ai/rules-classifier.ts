import type { Category, Priority } from "../domain.js";

/**
 * Keyword-based triage used when the AI is unavailable (no key, outage, rate
 * limit). It's deliberately simple: the goal is a sensible queue order during
 * an outage, not accuracy parity. Tickets triaged this way are labelled
 * "Rules" in the admin UI so the team knows to double-check them.
 */

const CATEGORY_KEYWORDS: Record<Exclude<Category, "GENERAL_INQUIRY">, RegExp[]> = {
  ROYALTY_PAYMENTS: [/royalt/i, /payout/i, /payment/i, /\bpaid\b/i, /bank/i, /₹|\brs\.?\s?\d|\binr\b/i, /earning/i],
  ISBN_METADATA: [/isbn/i, /metadata/i, /wrong (title|author|book|price)/i, /description/i, /barcode/i],
  PRINTING_QUALITY: [/print/i, /blurr?y/i, /misalign/i, /binding/i, /defect/i, /quality/i, /pages? (are|is) (missing|torn)/i, /reprint/i],
  DISTRIBUTION_AVAILABILITY: [/unavailable/i, /not (available|showing|listed|live)/i, /amazon/i, /flipkart/i, /listing/i, /out of stock/i],
  BOOK_STATUS_PRODUCTION: [/typesett/i, /cover design/i, /proofread/i, /editing/i, /production/i, /when will .* (be )?(done|ready|published)/i, /status/i],
};

const CRITICAL_SIGNALS = [/\b([6-9]|1[0-2]|six|seven|eight|nine|ten|twelve)\s+months?\b/i, /legal|lawyer|court|consumer forum/i, /wrong account/i, /fraud|scam/i];
const HIGH_SIGNALS = [/isbn/i, /defect|misprint|blurr?y|misalign|binding/i, /unavailable|not available/i, /haven'?t received|not received|never received|still waiting/i, /overdue|late payment/i];
const LOW_SIGNALS = [/\bbio\b/i, /how (do|can) i/i, /can i (update|change)/i, /just (wanted|curious)/i, /\bquestion\b/i];

export function classifyByRules(text: string): { category: Category; priority: Priority; rationale: string } {
  let best: Category = "GENERAL_INQUIRY";
  let bestScore = 0;
  for (const [category, patterns] of Object.entries(CATEGORY_KEYWORDS) as [Category, RegExp[]][]) {
    const score = patterns.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }

  let priority: Priority = "MEDIUM";
  if (CRITICAL_SIGNALS.some((p) => p.test(text))) priority = "CRITICAL";
  else if (HIGH_SIGNALS.some((p) => p.test(text))) priority = "HIGH";
  else if (LOW_SIGNALS.some((p) => p.test(text))) priority = "LOW";

  return { category: best, priority, rationale: "Keyword rules (AI unavailable). Please verify." };
}
