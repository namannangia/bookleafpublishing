import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Thread } from "../../components/Thread";
import { ErrorState, Spinner, StatusBadge } from "../../components/ui";
import { api } from "../../lib/api";
import { formatDate } from "../../lib/format";
import type { TicketDetail } from "../../lib/types";

const STATUS_HELP: Record<TicketDetail["status"], string> = {
  OPEN: "We've received your ticket and will respond soon.",
  IN_PROGRESS: "Our team is working on this.",
  RESOLVED: "We believe this is resolved. Reply below if you still need help and we'll reopen it.",
  CLOSED: "This ticket is closed. Raise a new ticket if you need more help.",
};

export function TicketDetailPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const justCreated = (location.state as { justCreated?: string } | null)?.justCreated;
  const qc = useQueryClient();
  const { data: ticket, isLoading, error, refetch } = useQuery({
    queryKey: ["ticket", id],
    queryFn: () => api.get<TicketDetail>(`/tickets/${id}`),
  });
  const [reply, setReply] = useState("");

  const send = useMutation({
    mutationFn: () => api.post(`/tickets/${id}/messages`, { body: reply }),
    onSuccess: () => {
      setReply("");
      void qc.invalidateQueries({ queryKey: ["ticket", id] });
      void qc.invalidateQueries({ queryKey: ["tickets"] });
    },
  });

  if (isLoading) return <Spinner />;
  if (error || !ticket) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (reply.trim()) send.mutate();
  };

  return (
    <div className="page narrow">
      <Link to="/tickets" className="back">
        ← My tickets
      </Link>
      {justCreated && (
        <div className="alert success">
          Ticket {justCreated} submitted. You'll see our reply here as soon as it's sent; no need to refresh.
        </div>
      )}
      <div className="page-head">
        <div>
          <h1>{ticket.subject}</h1>
          <div className="muted small">
            {ticket.reference} · {ticket.book?.title ?? "General / Account"} · opened {formatDate(ticket.createdAt)}
          </div>
        </div>
        <StatusBadge status={ticket.status} />
      </div>
      <p className="status-help">{STATUS_HELP[ticket.status]}</p>

      <Thread ticket={ticket} viewer="AUTHOR" />

      {ticket.status !== "CLOSED" ? (
        <form className="reply-box" onSubmit={onSubmit}>
          <textarea rows={3} placeholder="Add a reply…" value={reply} maxLength={5000} onChange={(e) => setReply(e.target.value)} />
          {send.error && <div className="alert error">{send.error.message}</div>}
          <div className="form-actions">
            <button className="btn primary" disabled={send.isPending || !reply.trim()}>
              {send.isPending ? "Sending…" : "Send reply"}
            </button>
          </div>
        </form>
      ) : (
        <Link to="/tickets/new" className="btn">
          Raise a new ticket
        </Link>
      )}
    </div>
  );
}
