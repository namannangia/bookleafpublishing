import type { Category } from "../domain.js";

/**
 * BookLeaf's knowledge base, split by topic so each AI call only carries the
 * policy that's relevant to the ticket's category. The core (company overview
 * and tone) goes into every draft; one topic section goes in per ticket.
 * A draft system prompt is ~800–950 tokens instead of ~1,850 with every section.
 */

export const COMPANY_OVERVIEW = `\
- BookLeaf Publishing is a self-publishing company operating in India and the US.
- Packages: Standard Free (no upfront cost) and Bestseller Breakthrough (premium, paid package with marketing and distribution add-ons).
- BookLeaf handles cover design, typesetting, ISBN assignment, printing, distribution, and royalty management.
- In-house printing facility and warehouse in Delhi. Print partners: Repro India and Epitome Books.`;

export const TONE_GUIDELINES = `\
- Always empathetic and professional. Authors are partners, not customers to be managed.
- Acknowledge the author's concern before jumping to solutions.
- Be specific: use the actual numbers, dates, and statuses from the account facts instead of vague reassurances.
- If something is BookLeaf's fault (delayed royalties, ISBN error), own it directly. No corporate deflection.
- If the issue needs escalation or investigation, give a clear timeline ("Our team will look into this and get back to you within 48 hours"), never open-ended promises.
- Always end with a clear next step for the author and/or the BookLeaf team.`;

interface KnowledgeSection {
  policy: string;
  /** Calibration examples: a sample query and how BookLeaf expects it to be answered. */
  examples: { query: string; guidance: string }[];
}

const ROYALTY: KnowledgeSection = {
  policy: `\
- 80/20 royalty split: 80% of the net profit per book goes to the author, 20% to BookLeaf.
- Net profit = MRP minus printing cost, platform commission (Amazon/Flipkart), and shipping charges.
- Royalties are calculated quarterly and paid within 45 days of the quarter ending.
- Minimum payout threshold: ₹1,000. Accumulated royalties below this roll over to the next quarter.
- Payouts are made by bank transfer to the account linked in the author's dashboard.
- Authors can see a detailed royalty breakdown in their dashboard, with sales per platform.`,
  examples: [
    {
      query: "I published my book 4 months ago and still haven't received any royalty. What's going on?",
      guidance:
        "Acknowledge the frustration. Explain the quarterly cycle and 45-day payout window. Ask them to confirm their bank details are linked. Give the specific next payout date. If the payment is genuinely overdue, escalate with a 48-hour resolution timeline.",
    },
    {
      query: "My royalty amount seems too low. I sold 200 copies but only received ₹3,000.",
      guidance:
        "Explain the net profit calculation (MRP minus printing, platform commission, shipping). Offer a detailed line-by-line royalty breakdown. Don't be defensive; offer transparency.",
    },
  ],
};

const ISBN: KnowledgeSection = {
  policy: `\
- Every book published through BookLeaf gets a unique ISBN assigned by BookLeaf.
- ISBNs are registered under BookLeaf's publisher imprint. Authors who want an ISBN under their own imprint must obtain it independently.
- ISBN errors (duplicate, wrong book linked) are high priority and escalated to the production team.
- Metadata updates (description, author bio, etc.) can be submitted through the dashboard or by emailing the BookLeaf team; changes typically reflect on platforms within 3–5 business days.`,
  examples: [
    {
      query: "My book is showing a different ISBN on Amazon than what's on the physical copy.",
      guidance:
        "Treat as high priority. Acknowledge this is a serious data issue. Confirm it is being escalated to the production team immediately. Give a 48-hour resolution timeline.",
    },
  ],
};

const PRINTING: KnowledgeSection = {
  policy: `\
- In-house printing handles most orders; overflow or specific formats go to Repro India or Epitome Books.
- Standard print turnaround: 5–7 business days from order confirmation.
- For quality issues (misprints, binding defects, colour inconsistency), BookLeaf arranges a free reprint after verification. The author may need to share photos of the defective copy.`,
  examples: [
    {
      query: "I received my author copies and the print quality is terrible. The images are blurry and pages are misaligned.",
      guidance:
        "Apologise sincerely. Ask for photos of the defective copies. Confirm BookLeaf will arrange a free reprint once verified. Give the 5–7 business day reprint timeline.",
    },
  ],
};

const DISTRIBUTION: KnowledgeSection = {
  policy: `\
- Books are listed on Amazon India, Flipkart, Amazon US, Amazon UK, and the BookLeaf Store.
- New listings typically go live within 7–10 business days after publication is complete.
- A book showing as unavailable on a platform usually means a stock sync issue; BookLeaf's team can trigger a re-sync, live again within 24–48 hours.`,
  examples: [
    {
      query: 'My book is published but it\'s showing as "Currently Unavailable" on Amazon.',
      guidance:
        "Explain this is typically a stock sync issue. Confirm a re-sync is being triggered with the distribution team. Set the expectation: 24–48 hours to go live again.",
    },
  ],
};

const PRODUCTION: KnowledgeSection = {
  policy: `\
- Production stages, in order: Manuscript Received → Editing (if opted) → Cover Design → Typesetting → Proofreading → ISBN Assignment → Printing → Distribution Setup → Published & Live.
- Authors are updated at each stage by email.
- Delays typically happen at Cover Design (waiting for author approval) and Proofreading (revision rounds).`,
  examples: [
    {
      query: "It's been 3 weeks and my book is still in typesetting. When will it be done?",
      guidance:
        "Use the actual production status. If delayed, be honest about why (e.g. waiting on author approval of proofs). Give a specific updated timeline. Never blame the author even if the delay is on their side; frame it collaboratively.",
    },
  ],
};

const GENERAL: KnowledgeSection = {
  policy: `\
- Metadata updates (book description, author bio, etc.) can be submitted through the dashboard or by emailing the BookLeaf team; changes typically reflect on platforms within 3–5 business days.
- Books are listed on Amazon India, Flipkart, Amazon US, Amazon UK, and the BookLeaf Store.`,
  examples: [
    {
      query: "Can I update the description of my book on Amazon after it's already live?",
      guidance:
        "Yes: metadata updates can be submitted through the dashboard or by emailing the BookLeaf team. Changes typically reflect on platforms within 3–5 business days.",
    },
  ],
};

const SECTIONS: Record<Category, { title: string; section: KnowledgeSection }> = {
  ROYALTY_PAYMENTS: { title: "Royalty Policy", section: ROYALTY },
  ISBN_METADATA: { title: "ISBN & Metadata Policy", section: ISBN },
  PRINTING_QUALITY: { title: "Printing & Quality Policy", section: PRINTING },
  DISTRIBUTION_AVAILABILITY: { title: "Distribution & Availability Policy", section: DISTRIBUTION },
  BOOK_STATUS_PRODUCTION: { title: "Production Stages", section: PRODUCTION },
  GENERAL_INQUIRY: { title: "General Policies", section: GENERAL },
};

/** Renders the single knowledge-base section relevant to a category. */
export function renderKnowledgeFor(category: Category): string {
  const { title, section } = SECTIONS[category];
  const examples = section.examples
    .map((e) => `Author: "${e.query}"\nHow BookLeaf answers: ${e.guidance}`)
    .join("\n\n");
  return `## ${title}\n${section.policy}\n\n## Calibration examples\n${examples}`;
}

/** Ordered production stages, used to compute "where is my book" facts. */
export const PRODUCTION_STAGES = [
  "Manuscript Received",
  "Editing",
  "Cover Design",
  "Typesetting",
  "Proofreading",
  "ISBN Assignment",
  "Printing",
  "Distribution Setup",
  "Published & Live",
] as const;
