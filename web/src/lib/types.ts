/** Shapes returned by the API. Mirrors the server's presenters. */

export type Role = "AUTHOR" | "ADMIN";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type Category =
  | "ROYALTY_PAYMENTS"
  | "ISBN_METADATA"
  | "PRINTING_QUALITY"
  | "DISTRIBUTION_AVAILABILITY"
  | "BOOK_STATUS_PRODUCTION"
  | "GENERAL_INQUIRY";
export type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type TriageSource = "AI" | "RULES" | "ADMIN";
export type AiStatus = "ok" | "degraded" | "disabled";

export interface SessionUser {
  id: string;
  role: Role;
  name: string;
  email: string;
  authorId: string | null;
}

export interface Book {
  id: string;
  title: string;
  isbn: string;
  genre: string;
  publicationDate: string | null;
  status: string;
  mrp: number | null;
  royaltyPerCopy: number | null;
  copiesSold: number;
  royaltyEarned: number;
  royaltyPaid: number;
  royaltyPending: number;
  lastPayoutDate: string | null;
  printPartner: string | null;
  availableOn: string[];
}

export interface BooksResponse {
  items: Book[];
  summary: {
    copiesSold: number;
    royaltyEarned: number;
    royaltyPaid: number;
    royaltyPending: number;
    payoutThreshold: number;
    belowThreshold: boolean;
    nextPayoutBy: string;
  };
}

export interface AuthorTicketSummary {
  id: string;
  reference: string;
  subject: string;
  status: TicketStatus;
  book: { id: string; title: string | null } | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  hasNewReply: boolean;
}

export interface Sla {
  dueAt: string;
  met: boolean | null;
  breached: boolean;
}

export interface AdminTicketSummary {
  id: string;
  reference: string;
  subject: string;
  status: TicketStatus;
  category: Category | null;
  categorySource: TriageSource | null;
  priority: Priority | null;
  prioritySource: TriageSource | null;
  triageState: "PENDING" | "DONE";
  author: { id: string; name: string };
  book: { id: string; title: string | null } | null;
  assignee: { id: string; name: string | null } | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  awaitingReply: boolean;
  sla: Sla;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface Message {
  id: string;
  from: Role;
  senderName: string;
  body: string;
  createdAt: string;
  aiAssisted?: boolean;
  aiDraftEdited?: boolean | null;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface TicketDetail {
  id: string;
  reference: string;
  subject: string;
  description: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  book: { id: string; title: string; status: string } | null;
  attachments: Attachment[];
  messages: Message[];
}

export interface AiDraft {
  id: string;
  body: string;
  agentActions: string[];
  suggestedStatus: TicketStatus | null;
  model: string;
  createdAt: string;
}

export interface TicketEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
  actorName: string | null;
}

export interface AdminTicketDetail extends TicketDetail {
  category: Category | null;
  categorySource: TriageSource | null;
  priority: Priority | null;
  prioritySource: TriageSource | null;
  triageState: "PENDING" | "DONE";
  aiConfidence: number | null;
  aiRationale: string | null;
  assignee: { id: string; name: string } | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  sla: Sla;
  author: { id: string; name: string; email: string; city: string | null; joinedDate: string | null };
  authorBooks: Book[];
  bookDetails: Book | null;
  notes: { id: string; body: string; createdAt: string; authorName: string }[];
  events: TicketEvent[];
  draft: AiDraft | null;
  aiStatus: AiStatus;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
}

export interface Stats {
  queue: { open: number; inProgress: number; unassigned: number; critical: number; slaBreached: number; awaitingTriage: number };
  ai: {
    status: AiStatus;
    windowDays: number;
    calls: number;
    failures: number;
    byPurpose: { classify: number; draft: number };
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    estimatedCostUsd: number;
    avgLatencyMs: number;
  };
  quality: {
    aiTriaged: number;
    categoryOverrides: number;
    priorityOverrides: number;
    draftsSent: number;
    draftsSentUnedited: number;
    manualReplies: number;
  };
}
