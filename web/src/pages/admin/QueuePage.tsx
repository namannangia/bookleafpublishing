import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CategoryTag, EmptyState, ErrorState, PriorityBadge, SourceTag, Spinner, StatusBadge } from "../../components/ui";
import { api } from "../../lib/api";
import { CATEGORIES, CATEGORY_LABELS, PRIORITIES, PRIORITY_LABELS, STATUSES, STATUS_LABELS, dueLabel, timeAgo } from "../../lib/format";
import type { AdminTicketSummary, Paginated, Stats } from "../../lib/types";

const DEFAULT_STATUS = "OPEN,IN_PROGRESS";

/** Filters live in the URL so views are shareable and survive refresh. */
export function QueuePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const filters = {
    status: params.get("status") ?? DEFAULT_STATUS,
    category: params.get("category") ?? "",
    priority: params.get("priority") ?? "",
    assignee: params.get("assignee") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    q: params.get("q") ?? "",
    sort: params.get("sort") ?? "urgency",
    page: Number(params.get("page") ?? 1),
  };
  const [search, setSearch] = useState(filters.q);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };

  // Debounce free-text search.
  useEffect(() => {
    const t = setTimeout(() => search !== filters.q && setFilter("q", search.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const query = new URLSearchParams({ sort: filters.sort, page: String(filters.page), pageSize: "25" });
  for (const k of ["status", "category", "priority", "assignee", "from", "to", "q"] as const) {
    if (filters[k] && !(k === "status" && filters[k] === "all")) query.set(k, filters[k]);
  }

  const tickets = useQuery({
    queryKey: ["tickets", "queue", query.toString()],
    queryFn: () => api.get<Paginated<AdminTicketSummary>>(`/tickets?${query}`),
    placeholderData: keepPreviousData,
  });
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => api.get<Stats>("/admin/stats") });

  const totalPages = tickets.data ? Math.max(1, Math.ceil(tickets.data.total / tickets.data.pageSize)) : 1;

  return (
    <div className="page wide">
      <div className="page-head">
        <h1>Ticket Queue</h1>
        {stats.data && stats.data.ai.status !== "ok" && (
          <span className="alert warn inline">
            {stats.data.ai.status === "disabled"
              ? "AI is not configured: tickets are triaged by keyword rules and replies are written manually."
              : "AI is temporarily unavailable: falling back to rules and manual replies."}
          </span>
        )}
      </div>

      {stats.data && (
        <section className="stat-row compact">
          <QuickStat label="Open" value={stats.data.queue.open} onClick={() => setFilter("status", "OPEN")} />
          <QuickStat label="In progress" value={stats.data.queue.inProgress} onClick={() => setFilter("status", "IN_PROGRESS")} />
          <QuickStat label="Critical" value={stats.data.queue.critical} tone="critical" onClick={() => setFilter("priority", "CRITICAL")} />
          <QuickStat label="SLA breached" value={stats.data.queue.slaBreached} tone={stats.data.queue.slaBreached ? "critical" : undefined} />
          <QuickStat label="Unassigned" value={stats.data.queue.unassigned} onClick={() => setFilter("assignee", "unassigned")} />
        </section>
      )}

      <section className="filters">
        <div className="chips" role="group" aria-label="Status">
          <Chip active={filters.status === DEFAULT_STATUS} onClick={() => setFilter("status", DEFAULT_STATUS)}>
            Unresolved
          </Chip>
          {STATUSES.map((s) => (
            <Chip key={s} active={filters.status === s} onClick={() => setFilter("status", s)}>
              {STATUS_LABELS[s]}
            </Chip>
          ))}
          <Chip active={filters.status === "all"} onClick={() => setFilter("status", "all")}>
            All
          </Chip>
        </div>
        <div className="filter-row">
          <input className="search" placeholder="Search subject, author, BL-123…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={filters.category} onChange={(e) => setFilter("category", e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <select value={filters.priority} onChange={(e) => setFilter("priority", e.target.value)} aria-label="Priority">
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
          <select value={filters.assignee} onChange={(e) => setFilter("assignee", e.target.value)} aria-label="Assignee">
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <label className="date-filter">
            From <input type="date" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} />
          </label>
          <label className="date-filter">
            To <input type="date" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} />
          </label>
          <select value={filters.sort} onChange={(e) => setFilter("sort", e.target.value)} aria-label="Sort">
            <option value="urgency">Most urgent first</option>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
        </div>
      </section>

      {tickets.isLoading ? (
        <Spinner />
      ) : tickets.error ? (
        <ErrorState error={tickets.error} onRetry={() => void tickets.refetch()} />
      ) : !tickets.data?.items.length ? (
        <EmptyState title="Nothing here">No tickets match these filters.</EmptyState>
      ) : (
        <>
          <table className="queue">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Ticket</th>
                <th>Category</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {tickets.data.items.map((t) => (
                <tr
                  key={t.id}
                  className={t.sla.breached ? "breached" : undefined}
                  onClick={() => navigate(`/admin/tickets/${t.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && navigate(`/admin/tickets/${t.id}`)}
                >
                  <td>
                    <PriorityBadge priority={t.priority} />
                    <SourceTag source={t.prioritySource} />
                  </td>
                  <td>
                    <div className="ticket-subject">
                      {t.subject}
                      {t.awaitingReply && <span className="pill">Awaiting reply</span>}
                    </div>
                    <div className="muted small">
                      {t.reference} · {t.author.name} · {t.book?.title ?? "General / Account"}
                    </div>
                  </td>
                  <td>
                    <CategoryTag category={t.category} />
                    <SourceTag source={t.categorySource} />
                  </td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                  <td className={t.assignee ? undefined : "muted"}>{t.assignee?.name ?? "Unassigned"}</td>
                  <td>
                    <div>{timeAgo(t.createdAt)}</div>
                    {t.sla.met === null && ["OPEN", "IN_PROGRESS"].includes(t.status) && (
                      <div className={`small ${t.sla.breached ? "danger" : "muted"}`}>{dueLabel(t.sla.dueAt)}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pager">
            <span className="muted small">
              {tickets.data.total} ticket{tickets.data.total === 1 ? "" : "s"}
            </span>
            {totalPages > 1 && (
              <span>
                <button className="btn small" disabled={filters.page <= 1} onClick={() => setFilter("page", String(filters.page - 1))}>
                  Previous
                </button>
                <span className="small">
                  {" "}
                  Page {filters.page} of {totalPages}{" "}
                </span>
                <button
                  className="btn small"
                  disabled={filters.page >= totalPages}
                  onClick={() => setFilter("page", String(filters.page + 1))}
                >
                  Next
                </button>
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`chip${active ? " active" : ""}`} onClick={onClick} aria-pressed={active}>
      {children}
    </button>
  );
}

function QuickStat({ label, value, tone, onClick }: { label: string; value: number; tone?: "critical"; onClick?: () => void }) {
  return (
    <button className={`stat clickable${tone ? ` tone-${tone}` : ""}`} onClick={onClick} disabled={!onClick}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </button>
  );
}
