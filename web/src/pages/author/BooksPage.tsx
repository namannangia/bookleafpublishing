import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { formatDate, inr } from "../../lib/format";
import type { Book, BooksResponse } from "../../lib/types";

const STAGES = ["Manuscript Received", "Editing", "Cover Design", "Typesetting", "Proofreading", "ISBN Assignment", "Printing", "Distribution Setup", "Published & Live"];

export function BooksPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["books"], queryFn: () => api.get<BooksResponse>("/books") });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!data || data.items.length === 0) {
    return <EmptyState title="No books yet">Once your manuscript is received, it will show up here.</EmptyState>;
  }
  const { summary } = data;

  return (
    <div className="page">
      <div className="page-head">
        <h1>My Books</h1>
        <Link to="/tickets/new" className="btn primary">
          Get help with a book
        </Link>
      </div>

      <section className="stat-row">
        <Stat label="Copies sold" value={summary.copiesSold.toLocaleString("en-IN")} />
        <Stat label="Royalty earned" value={inr(summary.royaltyEarned)} />
        <Stat label="Royalty paid" value={inr(summary.royaltyPaid)} />
        <Stat
          label="Royalty pending"
          value={inr(summary.royaltyPending)}
          note={
            summary.royaltyPending === 0
              ? "You're all paid up"
              : summary.belowThreshold
                ? `Below the ${inr(summary.payoutThreshold)} payout minimum; rolls over to next quarter`
                : `Next payout by ${formatDate(summary.nextPayoutBy)}`
          }
        />
      </section>

      <div className="book-list">
        {data.items.map((b) => (
          <BookCard key={b.id} book={b} />
        ))}
      </div>
      <p className="muted small">
        Royalties are calculated quarterly and paid within 45 days of the quarter ending, by bank transfer to your linked account.
      </p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

function BookCard({ book }: { book: Book }) {
  const inProduction = book.status.startsWith("In Production");
  const stage = inProduction ? book.status.replace("In Production - ", "") : null;
  const stageIdx = stage ? STAGES.findIndex((s) => s.toLowerCase() === stage.toLowerCase()) : -1;

  return (
    <article className="card book">
      <div className="book-head">
        <div>
          <h2>{book.title}</h2>
          <div className="muted small">
            {book.genre} · ISBN {book.isbn}
          </div>
        </div>
        <span className={`badge ${inProduction ? "status-in_progress" : "status-resolved"}`}>{book.status}</span>
      </div>

      {inProduction ? (
        <div className="production">
          <div className="stages" aria-label={`Production stage: ${stage}`}>
            {STAGES.map((s, i) => (
              <span key={s} className={`stage ${i < stageIdx ? "done" : i === stageIdx ? "current" : ""}`} title={s} />
            ))}
          </div>
          <div className="small">
            Currently in <strong>{stage}</strong>
            {stageIdx >= 0 && stageIdx < STAGES.length - 1 && <> · next: {STAGES[stageIdx + 1]}</>}. Sales and royalties appear
            once your book is live.
          </div>
        </div>
      ) : (
        <dl className="book-grid">
          <Item label="Published" value={formatDate(book.publicationDate)} />
          <Item label="MRP" value={inr(book.mrp)} />
          <Item label="Copies sold" value={book.copiesSold.toLocaleString("en-IN")} />
          <Item label="Royalty earned" value={inr(book.royaltyEarned)} />
          <Item label="Royalty paid" value={inr(book.royaltyPaid)} />
          <Item label="Royalty pending" value={inr(book.royaltyPending)} highlight={book.royaltyPending > 0} />
          <Item label="Last payout" value={book.lastPayoutDate ? formatDate(book.lastPayoutDate) : "No payout yet"} />
          <Item label="Available on" value={book.availableOn.join(", ") || "—"} wide />
        </dl>
      )}
    </article>
  );
}

function Item({ label, value, highlight, wide }: { label: string; value: string; highlight?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? "wide" : undefined}>
      <dt>{label}</dt>
      <dd className={highlight ? "highlight" : undefined}>{value}</dd>
    </div>
  );
}
