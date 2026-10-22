import type { Category, Priority, TicketStatus, TriageSource } from "./types";

export const CATEGORY_LABELS: Record<Category, string> = {
  ROYALTY_PAYMENTS: "Royalty & Payments",
  ISBN_METADATA: "ISBN & Metadata",
  PRINTING_QUALITY: "Printing & Quality",
  DISTRIBUTION_AVAILABILITY: "Distribution & Availability",
  BOOK_STATUS_PRODUCTION: "Book Status & Production",
  GENERAL_INQUIRY: "General Inquiry",
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const SOURCE_LABELS: Record<TriageSource, string> = {
  AI: "AI",
  RULES: "Rules",
  ADMIN: "Set by team",
};

export const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];
export const PRIORITIES = Object.keys(PRIORITY_LABELS) as Priority[];
export const STATUSES = Object.keys(STATUS_LABELS) as TicketStatus[];

export const inr = (n: number | null | undefined) => (n == null ? "—" : `₹${n.toLocaleString("en-IN")}`);

export const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** "5m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** "due in 3h" / "overdue by 2h". */
export function dueLabel(iso: string, now = Date.now()): string {
  const diffH = Math.round((new Date(iso).getTime() - now) / 3_600_000);
  if (diffH >= 0) return diffH < 1 ? "due within the hour" : `due in ${diffH}h`;
  const late = -diffH;
  return late < 48 ? `overdue by ${late}h` : `overdue by ${Math.round(late / 24)}d`;
}

export const fileSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
