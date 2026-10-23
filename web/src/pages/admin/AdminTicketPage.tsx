import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Thread } from "../../components/Thread";
import { ErrorState, PriorityBadge, SourceTag, Spinner, StatusBadge } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUSES,
  STATUS_LABELS,
  dueLabel,
  formatDate,
  formatDateTime,
  inr,
} from "../../lib/format";
import type { AdminTicketDetail, AiDraft, TeamMember, TicketStatus } from "../../lib/types";

export function AdminTicketPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const { data: ticket, isLoading, error, refetch } = useQuery({
    queryKey: ["ticket", id],
    queryFn: () => api.get<AdminTicketDetail>(`/tickets/${id}`),
  });

  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch<AdminTicketDetail>(`/tickets/${id}`, patch),
    onSuccess: (data) => {
      qc.setQueryData(["ticket", id], data);
      void qc.invalidateQueries({ queryKey: ["tickets"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  if (isLoading) return <Spinner />;
  if (error || !ticket) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div className="page wide">
      <Link to="/admin/tickets" className="back">
        ← Queue
      </Link>
      <div className="page-head">
        <div>
          <h1>{ticket.subject}</h1>
          <div className="muted small">
            {ticket.reference} · {ticket.author.name} · {ticket.book?.title ?? "General / Account"} · opened{" "}
            {formatDateTime(ticket.createdAt)}
          </div>
        </div>
        <div className="head-badges">
          <PriorityBadge priority={ticket.priority} />
          <StatusBadge status={ticket.status} />
        </div>
      </div>
      {update.error && <div className="alert error">{update.error.message}</div>}

      <div className="ticket-layout">
        <div className="ticket-main-col">
          <Thread ticket={ticket} viewer="ADMIN" />
          <Composer ticket={ticket} />
        </div>
        <aside className="ticket-side">
          <TriageCard ticket={ticket} onChange={(patch) => update.mutate(patch)} saving={update.isPending} />
          <ManageCard ticket={ticket} onChange={(patch) => update.mutate(patch)} saving={update.isPending} />
          <AuthorCard ticket={ticket} />
          <NotesCard ticket={ticket} />
          <ActivityCard ticket={ticket} />
        </aside>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ composer

function Composer({ ticket }: { ticket: AdminTicketDetail }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [usedDraft, setUsedDraft] = useState<AiDraft | null>(null);
  const [status, setStatus] = useState<TicketStatus | "">("");
  const attempted = useRef<string | null>(null);
  const unresolved = ticket.status === "OPEN" || ticket.status === "IN_PROGRESS";

  const applyDraft = (draft: AiDraft) => {
    setUsedDraft(draft);
    setBody(draft.body);
    if (draft.suggestedStatus) setStatus(draft.suggestedStatus);
  };

  const generate = useMutation({
    mutationFn: (regenerate: boolean) => api.post<AiDraft>(`/tickets/${ticket.id}/draft`, { regenerate }),
    onSuccess: (draft) => {
      applyDraft(draft);
      void qc.invalidateQueries({ queryKey: ["ticket", ticket.id] });
      void qc.invalidateQueries({ queryKey: ["stats"] }); // usage/cost changed
    },
  });

  // Present a draft as soon as the ticket opens: reuse the cached one, or ask for one.
  const contextKey = `${ticket.id}:${ticket.messages.length}`;
  useEffect(() => {
    if (attempted.current === contextKey || !unresolved) return;
    if (ticket.draft) {
      if (!body.trim()) applyDraft(ticket.draft);
      attempted.current = contextKey;
      return;
    }
    if (ticket.aiStatus === "disabled" || body.trim()) return;
    attempted.current = contextKey;
    generate.mutate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey, ticket.draft?.id]);

  const send = useMutation({
    mutationFn: () =>
      api.post(`/tickets/${ticket.id}/messages`, {
        body,
        draftId: usedDraft?.id,
        status: status || undefined,
      }),
    onSuccess: () => {
      setBody("");
      setUsedDraft(null);
      setStatus("");
      void qc.invalidateQueries({ queryKey: ["ticket", ticket.id] });
      void qc.invalidateQueries({ queryKey: ["tickets"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  if (ticket.status === "CLOSED") {
    return <div className="composer muted">This ticket is closed. Change its status to reply.</div>;
  }

  const draftStale = usedDraft && ticket.draft?.id !== usedDraft.id && body === usedDraft.body;
  const draftError = generate.error instanceof ApiError ? generate.error : null;
  const defaultStatus = ticket.status === "OPEN" ? "IN_PROGRESS" : ticket.status;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (body.trim()) send.mutate();
  };

  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="composer-head">
        <strong>Reply to {ticket.author.name.split(" ")[0]}</strong>
        <div className="composer-ai">
          {generate.isPending ? (
            <span className="muted small">
              <span className="spinner" aria-hidden /> Drafting a reply with AI…
            </span>
          ) : ticket.aiStatus !== "disabled" ? (
            <button type="button" className="btn ghost small" onClick={() => generate.mutate(Boolean(usedDraft))}>
              {usedDraft ? "Regenerate draft" : "Generate AI draft"}
            </button>
          ) : null}
        </div>
      </div>

      {ticket.aiStatus === "disabled" && <div className="alert info">AI drafting isn't configured, so please write the reply manually.</div>}
      {draftError && (
        <div className="alert warn">
          {draftError.message}{" "}
          <button type="button" className="link" onClick={() => generate.mutate(false)}>
            Retry
          </button>
        </div>
      )}
      {draftStale && (
        <div className="alert info">
          The conversation changed since this draft was written.{" "}
          <button type="button" className="link" onClick={() => generate.mutate(true)}>
            Regenerate
          </button>
        </div>
      )}

      <textarea
        rows={12}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={generate.isPending ? "" : "Write a reply…"}
        disabled={generate.isPending}
        maxLength={5000}
      />

      {usedDraft && (
        <div className="draft-meta">
          <span className="source source-ai">AI draft</span>
          <span className="muted small">Review and edit before sending. The author sees exactly what you send.</span>
          {usedDraft.agentActions.length > 0 && (
            <div className="agent-actions">
              <strong className="small">This reply commits the team to:</strong>
              <ul>
                {usedDraft.agentActions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {send.error && <div className="alert error">{send.error.message}</div>}
      <div className="form-actions">
        {usedDraft && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setUsedDraft(null);
              setBody("");
            }}
          >
            Discard draft
          </button>
        )}
        <label className="inline-select">
          Then set status
          <select value={status} onChange={(e) => setStatus(e.target.value as TicketStatus)}>
            <option value="">{STATUS_LABELS[defaultStatus]} (default)</option>
            {STATUSES.filter((s) => s !== "CLOSED").map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" disabled={send.isPending || !body.trim()}>
          {send.isPending ? "Sending…" : "Send to author"}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ sidebar

type Patch = Record<string, unknown>;

function TriageCard({ ticket, onChange, saving }: { ticket: AdminTicketDetail; onChange: (p: Patch) => void; saving: boolean }) {
  const qc = useQueryClient();
  const retriage = useMutation({
    mutationFn: () => api.post<AdminTicketDetail>(`/tickets/${ticket.id}/triage`),
    onSuccess: (data) => qc.setQueryData(["ticket", ticket.id], data),
  });

  return (
    <section className="card side-card">
      <h3>Triage</h3>
      {ticket.triageState === "PENDING" ? (
        <div className="muted small">
          <span className="spinner" aria-hidden /> Classifying…
        </div>
      ) : (
        <>
          <label className="side-field">
            <span>
              Category <SourceTag source={ticket.categorySource} />
            </span>
            <select value={ticket.category ?? ""} disabled={saving} onChange={(e) => onChange({ category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="side-field">
            <span>
              Priority <SourceTag source={ticket.prioritySource} />
            </span>
            <select value={ticket.priority ?? ""} disabled={saving} onChange={(e) => onChange({ priority: e.target.value })}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          {ticket.aiRationale && (
            <p className="small muted">
              {ticket.aiRationale}
              {ticket.aiConfidence != null && <> · {Math.round(ticket.aiConfidence * 100)}% confident</>}
            </p>
          )}
          {(ticket.categorySource === "RULES" || ticket.prioritySource === "RULES") && ticket.aiStatus !== "disabled" && (
            <button className="btn small" disabled={retriage.isPending} onClick={() => retriage.mutate()}>
              {retriage.isPending ? "Re-running…" : "Re-run AI triage"}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function ManageCard({ ticket, onChange, saving }: { ticket: AdminTicketDetail; onChange: (p: Patch) => void; saving: boolean }) {
  const { user } = useAuth();
  const team = useQuery({ queryKey: ["team"], queryFn: () => api.get<{ items: TeamMember[] }>("/admin/team"), staleTime: 300_000 });

  return (
    <section className="card side-card">
      <h3>Ticket</h3>
      <label className="side-field">
        <span>Status</span>
        <select value={ticket.status} disabled={saving} onChange={(e) => onChange({ status: e.target.value })}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="side-field">
        <span>Assignee</span>
        <select value={ticket.assignee?.id ?? ""} disabled={saving} onChange={(e) => onChange({ assigneeId: e.target.value || null })}>
          <option value="">Unassigned</option>
          {team.data?.items.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {ticket.assignee?.id !== user?.id && (
        <button className="btn small" disabled={saving} onClick={() => onChange({ assigneeId: user?.id })}>
          Assign to me
        </button>
      )}
      <dl className="kv small">
        <dt>First response</dt>
        <dd>
          {ticket.firstResponseAt ? (
            <>
              {formatDateTime(ticket.firstResponseAt)} {ticket.sla.met ? "· within SLA" : "· after SLA"}
            </>
          ) : (
            <span className={ticket.sla.breached ? "danger" : undefined}>{dueLabel(ticket.sla.dueAt)}</span>
          )}
        </dd>
        {ticket.resolvedAt && (
          <>
            <dt>Resolved</dt>
            <dd>{formatDateTime(ticket.resolvedAt)}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

function AuthorCard({ ticket }: { ticket: AdminTicketDetail }) {
  const b = ticket.bookDetails;
  const pendingTotal = ticket.authorBooks.reduce((s, x) => s + x.royaltyPending, 0);
  return (
    <section className="card side-card">
      <h3>Author</h3>
      <div>
        <strong>{ticket.author.name}</strong>
      </div>
      <div className="small muted">
        {ticket.author.email} · {ticket.author.city ?? "—"} · since {formatDate(ticket.author.joinedDate)}
      </div>
      {b && (
        <div className="book-mini">
          <div>
            <strong>{b.title}</strong> <span className="muted small">({b.status})</span>
          </div>
          <dl className="kv small">
            <dt>ISBN</dt>
            <dd>{b.isbn}</dd>
            {b.mrp != null && (
              <>
                <dt>MRP / per copy</dt>
                <dd>
                  {inr(b.mrp)} / {inr(b.royaltyPerCopy)}
                </dd>
                <dt>Sold</dt>
                <dd>{b.copiesSold.toLocaleString("en-IN")}</dd>
                <dt>Earned / paid</dt>
                <dd>
                  {inr(b.royaltyEarned)} / {inr(b.royaltyPaid)}
                </dd>
                <dt>Pending</dt>
                <dd>{inr(b.royaltyPending)}</dd>
                <dt>Last payout</dt>
                <dd>{b.lastPayoutDate ? formatDate(b.lastPayoutDate) : "Never"}</dd>
                <dt>Printer</dt>
                <dd>{b.printPartner ?? "—"}</dd>
                <dt>Listed on</dt>
                <dd>{b.availableOn.join(", ") || "—"}</dd>
              </>
            )}
          </dl>
        </div>
      )}
      <div className="small">
        {ticket.authorBooks.length} book{ticket.authorBooks.length === 1 ? "" : "s"} · {inr(pendingTotal)} pending across account
      </div>
    </section>
  );
}

function NotesCard({ ticket }: { ticket: AdminTicketDetail }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const add = useMutation({
    mutationFn: () => api.post(`/tickets/${ticket.id}/notes`, { body }),
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: ["ticket", ticket.id] });
    },
  });
  return (
    <section className="card side-card notes">
      <h3>Internal notes</h3>
      <p className="small muted">Only visible to the BookLeaf team.</p>
      {ticket.notes.map((n) => (
        <div key={n.id} className="note">
          <div className="small muted">
            {n.authorName} · {formatDateTime(n.createdAt)}
          </div>
          <div>{n.body}</div>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.mutate();
        }}
      >
        <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note for the team…" maxLength={5000} />
        {add.error && <div className="alert error">{add.error.message}</div>}
        <button className="btn small" disabled={add.isPending || !body.trim()}>
          Add note
        </button>
      </form>
    </section>
  );
}

const EVENT_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  created: () => "Ticket created",
  triaged: (d) =>
    `Triaged by ${d.source === "AI" ? "AI" : "keyword rules"}: ${CATEGORY_LABELS[d.category as keyof typeof CATEGORY_LABELS] ?? d.category}, ${String(d.priority).toLowerCase()}`,
  status_changed: (d) =>
    `Status ${STATUS_LABELS[d.from as TicketStatus] ?? d.from} → ${STATUS_LABELS[d.to as TicketStatus] ?? d.to}${d.reason ? ` (${d.reason})` : ""}`,
  category_overridden: (d) => `Category set to ${CATEGORY_LABELS[d.to as keyof typeof CATEGORY_LABELS] ?? d.to}`,
  priority_overridden: (d) => `Priority set to ${String(d.to).toLowerCase()}`,
  assigned: (d) => (d.assigneeId ? "Assigned" : "Unassigned"),
  replied: (d) => (d.aiAssisted ? `Replied using AI draft${d.aiDraftEdited ? " (edited)" : ""}` : "Replied"),
};

function ActivityCard({ ticket }: { ticket: AdminTicketDetail }) {
  return (
    <section className="card side-card">
      <h3>Activity</h3>
      <ol className="timeline small">
        {ticket.events.map((e) => (
          <li key={e.id}>
            <span>{EVENT_TEXT[e.type]?.(e.data) ?? e.type}</span>
            <span className="muted">
              {" "}
              · {e.actorName ?? "System"} · {formatDateTime(e.createdAt)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
