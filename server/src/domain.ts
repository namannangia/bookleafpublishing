/**
 * Core domain vocabulary shared by the DB schema, validators, AI layer and API.
 */

export const ROLES = ["AUTHOR", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const UNRESOLVED_STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS"];

export const CATEGORIES = [
  "ROYALTY_PAYMENTS",
  "ISBN_METADATA",
  "PRINTING_QUALITY",
  "DISTRIBUTION_AVAILABILITY",
  "BOOK_STATUS_PRODUCTION",
  "GENERAL_INQUIRY",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  ROYALTY_PAYMENTS: "Royalty & Payments",
  ISBN_METADATA: "ISBN & Metadata Issues",
  PRINTING_QUALITY: "Printing & Quality",
  DISTRIBUTION_AVAILABILITY: "Distribution & Availability",
  BOOK_STATUS_PRODUCTION: "Book Status & Production Updates",
  GENERAL_INQUIRY: "General Inquiry",
};

export const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Lower number = more urgent. Used for queue ordering. */
export const PRIORITY_RANK: Record<Priority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** First-response SLA targets (hours) the queue uses to flag overdue tickets. */
export const SLA_HOURS: Record<Priority, number> = { CRITICAL: 4, HIGH: 24, MEDIUM: 48, LOW: 72 };

/**
 * Where the current category/priority came from. Persisted so the team can
 * measure how often admins override the AI (a direct proxy for its accuracy).
 */
export const TRIAGE_SOURCES = ["AI", "RULES", "ADMIN"] as const;
export type TriageSource = (typeof TRIAGE_SOURCES)[number];

export const TRIAGE_STATES = ["PENDING", "DONE"] as const;
export type TriageState = (typeof TRIAGE_STATES)[number];
