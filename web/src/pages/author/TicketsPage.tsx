import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, Spinner, StatusBadge } from "../../components/ui";
import { api } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import type { AuthorTicketSummary } from "../../lib/types";

export function TicketsPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["tickets", "mine"],
    queryFn: () => api.get<{ items: AuthorTicketSummary[] }>("/tickets"),
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>My Tickets</h1>
        <Link to="/tickets/new" className="btn primary">
          New ticket
        </Link>
      </div>
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data?.items.length ? (
        <EmptyState title="No tickets yet">
          Questions about royalties, ISBNs, printing or your book's progress? <Link to="/tickets/new">Raise a ticket</Link> and
          our team will get back to you.
        </EmptyState>
      ) : (
        <ul className="ticket-list">
          {data.items.map((t) => (
            <li key={t.id}>
              <Link to={`/tickets/${t.id}`} className="ticket-row">
                <div className="ticket-main">
                  <div className="ticket-subject">
                    {t.subject}
                    {t.hasNewReply && t.status !== "CLOSED" && <span className="pill">Reply from BookLeaf</span>}
                  </div>
                  <div className="muted small">
                    {t.reference} · {t.book?.title ?? "General / Account"} · updated {timeAgo(t.updatedAt)}
                  </div>
                </div>
                <StatusBadge status={t.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
