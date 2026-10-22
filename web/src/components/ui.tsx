import type { ReactNode } from "react";
import { CATEGORY_LABELS, PRIORITY_LABELS, SOURCE_LABELS, STATUS_LABELS } from "../lib/format";
import type { Category, Priority, TicketStatus, TriageSource } from "../lib/types";

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge status-${status.toLowerCase()}`}>{STATUS_LABELS[status]}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority | null }) {
  if (!priority) return <span className="badge muted">Triaging…</span>;
  return <span className={`badge priority-${priority.toLowerCase()}`}>{PRIORITY_LABELS[priority]}</span>;
}

export function CategoryTag({ category }: { category: Category | null }) {
  return <span className="tag">{category ? CATEGORY_LABELS[category] : "Uncategorised"}</span>;
}

/** Shows who set a triage value, so the team knows when to double-check. */
export function SourceTag({ source }: { source: TriageSource | null }) {
  if (!source) return null;
  return (
    <span className={`source source-${source.toLowerCase()}`} title={source === "RULES" ? "AI was unavailable; set by keyword rules" : undefined}>
      {SOURCE_LABELS[source]}
    </span>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state" role="status">
      <span className="spinner" aria-hidden /> {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="state error" role="alert">
      {error instanceof Error ? error.message : "Something went wrong."}
      {onRetry && (
        <button className="btn small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className={`field${error ? " has-error" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
